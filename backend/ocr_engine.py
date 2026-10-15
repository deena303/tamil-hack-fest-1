"""
OCR Engine — Gemini Vision backend (v5)

Error categories returned in every result dict:
  RATE_LIMIT      — HTTP 429 per-minute limit       → retried with backoff on same model
  QUOTA_EXHAUSTED — daily/monthly free-tier gone    → NOT retried; tells user to check billing
  INVALID_KEY     — API key rejected                → NOT retried
  MODEL_NOT_FOUND — model unavailable for this key  → automatically falls back to next model
  SERVER_ERROR    — 503 / UNAVAILABLE               → retried with backoff; then next model
  UNKNOWN         — anything else                   → retried conservatively

Model fallback:
  MODEL_NOT_FOUND  → try next model in queue immediately (no backoff)
  SERVER_ERROR     → retry same model with backoff, then try next model
  Other permanent  → raise immediately, do not waste quota

Modes:
  tam      → extract Tamil text only (no translation)
  tam+eng  → extract Tamil + English translation
  eng      → translate Tamil to English (translation is primary output)
"""
from __future__ import annotations

import hashlib
import io
import os
import logging
import random
import re
import threading
import time
from typing import List, Optional, Tuple

from pathlib import Path

logger = logging.getLogger(__name__)

# ── Auto-load backend/.env ────────────────────────────────────────────────────
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    with open(_env_path, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _k = _k.strip()
                _v = _v.strip().strip('"').strip("'")
                if _k and _k not in os.environ:
                    os.environ[_k] = _v

# Mutex to ensure thread-safe PyMuPDF operations across concurrent worker threads
_fitz_lock = threading.Lock()

# ── PyMuPDF ───────────────────────────────────────────────────────────────────
try:
    import pymupdf as fitz
    FITZ_AVAILABLE = True
    logger.info("PyMuPDF loaded.")
except ImportError:
    try:
        import fitz                     # type: ignore
        FITZ_AVAILABLE = True
        logger.info("PyMuPDF (fitz) loaded.")
    except ImportError:
        FITZ_AVAILABLE = False
        logger.warning("PyMuPDF not installed — PDF support disabled. Run: pip install pymupdf")

# ── google-genai ──────────────────────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
    logger.info("google-genai SDK loaded successfully.")
except ImportError:
    GENAI_AVAILABLE = False
    genai = None          # type: ignore
    genai_types = None    # type: ignore
    logger.error("google-genai not installed. Run: pip install google-genai")

# ── PIL ───────────────────────────────────────────────────────────────────────
try:
    from PIL import Image, ImageEnhance
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.warning("Pillow not installed.")

# ── Gemini model queue (centralized config + live validation) ─────────────────
from gemini_models import (
    get_model_queue,
    mark_model_unavailable,
    invalidate_cache,
    CANDIDATE_MODELS,
)

# ── Lazy Gemini client ────────────────────────────────────────────────────────
_client = None
_client_key: Optional[str] = None


def _get_client():
    global _client, _client_key
    if not GENAI_AVAILABLE:
        return None
    key = os.environ.get("GEMINI_API_KEY", "").strip() or None
    if not key:
        return None
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
        invalidate_cache()      # new key → re-query available models
        logger.info("Gemini client initialised.")
    return _client


def _current_model() -> str:
    """Returns the env-configured model (or first candidate as default)."""
    return os.environ.get("GEMINI_MODEL", "").strip() or CANDIDATE_MODELS[0]


# ── Structured error class ────────────────────────────────────────────────────
class GeminiError(Exception):
    """Wraps a Gemini API failure with an explicit, actionable category."""

    RATE_LIMIT      = "RATE_LIMIT"
    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"
    INVALID_KEY     = "INVALID_KEY"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    SERVER_ERROR    = "SERVER_ERROR"
    UNKNOWN         = "UNKNOWN"

    def __init__(self, category: str, message: str,
                 retry_after: Optional[int] = None,
                 model: Optional[str] = None):
        super().__init__(message)
        self.category    = category
        self.retry_after = retry_after
        self.model       = model    # which model produced this error


# ── Error classifier ──────────────────────────────────────────────────────────
def _classify_error(exc: BaseException, model: str = "") -> GeminiError:
    """
    Parse a raw SDK exception into a GeminiError with an explicit category.
    Redacts any token >= 20 chars (catches API key values in error strings).
    Properly distinguishes transient per-minute 429 rate limits from daily quota exhaustion.
    """
    raw  = str(exc)
    safe = re.sub(r"[A-Za-z0-9_\-]{20,}", "[REDACTED]", raw)
    up   = raw.upper()

    # Extract retry_after if available
    retry_after: Optional[int] = None
    retry_patterns = [
        r"retry[_\-\s]?after[^0-9]*([0-9]+)",
        r"retryDelay':\s*'([0-9]+)s'",
        r"retry in ([0-9]+)\s*s",
        r"try again in ([0-9]+)\s*s",
        r"quota reset in ([0-9]+)\s*s",
        r"please wait ([0-9]+)\s*s",
    ]
    for pat in retry_patterns:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            try:
                retry_after = int(m.group(1))
                break
            except ValueError:
                pass

    # Check exception attributes if present (e.g. from google-genai ClientError or APIError)
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None) or getattr(exc, "http_status", None)

    # ── Invalid / unauthorised API key ────────────────────────────────────────
    if any(k in up for k in ("API_KEY_INVALID", "INVALID API KEY",
                              "INVALID_API_KEY", "UNAUTHENTICATED",
                              "PERMISSION_DENIED")):
        return GeminiError(
            GeminiError.INVALID_KEY,
            "Invalid or unauthorised API key. "
            "Verify GEMINI_API_KEY at https://aistudio.google.com/app/apikey -- " + safe,
            model=model,
        )

    # ── Model not found / not available for this key ──────────────────────────
    if any(k in up for k in ("MODEL_NOT_FOUND", "NOT_FOUND")) or (
        ("404" in raw or code == 404) and "model" in raw.lower()
    ) or ("NOT FOUND" in up and "model" in raw.lower()):
        return GeminiError(
            GeminiError.MODEL_NOT_FOUND,
            f"Model '{model}' is not available for this API key (404). "
            "Switching to next available model automatically.",
            model=model,
        )

    # ── Check if explicit daily quota exhaustion ──────────────────────────────
    is_explicit_daily = any(k in raw.lower() for k in ("per day", "daily", "per-day", "requests per day", "rpd"))
    if is_explicit_daily:
        return GeminiError(
            GeminiError.QUOTA_EXHAUSTED,
            "Daily free-tier quota exhausted. "
            "Check https://aistudio.google.com/app/usage — "
            "try again tomorrow or enable billing -- " + safe,
            model=model,
        )

    # ── Per-minute rate limit / resource exhausted (HTTP 429) ─────────────────
    if (code == 429) or ("RESOURCE_EXHAUSTED" in up) or ("429" in raw) or ("rate" in raw.lower()) or ("quota" in raw.lower()):
        ra = retry_after or 45
        return GeminiError(
            GeminiError.RATE_LIMIT,
            f"Per-minute rate limit (HTTP 429). Retry after {ra}s -- " + safe,
            retry_after=ra,
            model=model,
        )

    # ── Server overloaded / unavailable ──────────────────────────────────────
    if (code in (500, 502, 503, 504)) or any(k in up for k in ("503", "UNAVAILABLE", "OVERLOAD", "INTERNAL", "DEADLINE_EXCEEDED", "TIMEOUT")):
        return GeminiError(
            GeminiError.SERVER_ERROR,
            "Gemini server temporarily unavailable. Retrying -- " + safe,
            retry_after=retry_after or 5,
            model=model,
        )

    return GeminiError(GeminiError.UNKNOWN, "Gemini API error -- " + safe, model=model)


# ── Backoff / retry policy ────────────────────────────────────────────────────
_NON_RETRYABLE_PERMANENT = {
    GeminiError.QUOTA_EXHAUSTED,
    GeminiError.INVALID_KEY,
}

_BACKOFF_SECONDS = [4.0, 12.0, 25.0, 45.0]
_MAX_ATTEMPTS_PER_MODEL = 4    # retries on same model for transient errors


def _backoff_wait(attempt: int, err: GeminiError) -> float:
    if err.retry_after:
        return min(float(err.retry_after) + 1.0, 60.0)
    base   = float(_BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)])
    jitter = base * 0.15 * (random.random() * 2 - 1)
    return max(2.0, base + jitter)


# ── Image validation & enhancement ───────────────────────────────────────────
def validate_image_bytes(image_bytes: bytes) -> Tuple[bool, Optional[str], Optional[Tuple[int, int]]]:
    """
    Validates uploaded image bytes for readability, corruption, and dimension bounds.
    Returns (is_valid, error_message, (width, height)).
    """
    if not image_bytes or len(image_bytes) < 32:
        return False, "Image file is empty or too small.", None
    if not PIL_AVAILABLE:
        return True, None, None
    try:
        pil = Image.open(io.BytesIO(image_bytes))
        pil.verify()
        # Re-open after verify() because verify exhausts the stream
        pil = Image.open(io.BytesIO(image_bytes))
        w, h = pil.size
        if w < 10 or h < 10:
            return False, f"Image dimensions too small ({w}x{h} px). Minimum is 10x10 px.", (w, h)
        return True, None, (w, h)
    except Exception as exc:
        return False, f"Corrupted or unsupported image file: {exc}", None


def has_reliable_tamil_text(text: str) -> bool:
    """
    Check if the extracted text has genuine Tamil Unicode characters (\u0B80-\u0BFF).
    A text layer must contain at least 15 Tamil characters and at least 20%
    of non-whitespace characters must be Tamil to be considered genuine Tamil text.
    Otherwise, fall back to Gemini Vision OCR.
    """
    if not text:
        return False
    tamil_chars = sum(1 for ch in text if '\u0B80' <= ch <= '\u0BFF')
    non_ws = sum(1 for ch in text if not ch.isspace())
    if tamil_chars < 15 or non_ws == 0:
        return False
    return (tamil_chars / non_ws) >= 0.20


def _enhance_image(pil_img: "Image.Image", enhance: bool = True) -> "Image.Image":
    """
    Gentle contrast and sharpness boost specifically calibrated for historical Tamil print
    and weathered stone inscriptions. Avoids harsh over-saturation that fuses pulli (dots)
    or obliterates chiseled inscription strokes.
    """
    if not enhance or not PIL_AVAILABLE:
        return pil_img
    try:
        if pil_img.mode not in ("RGB", "L"):
            pil_img = pil_img.convert("RGB")
        # Balanced 1.2 contrast preserves delicate diacritics and dots (புள்ளி)
        pil_img = ImageEnhance.Contrast(pil_img).enhance(1.20)
        # Moderate sharpness boost clarifies weathered granite edges without generating halo noise
        pil_img = ImageEnhance.Sharpness(pil_img).enhance(1.25)
    except Exception as e:
        logger.warning(f"Image enhancement failed: {e}")
    return pil_img


# ── Image preparation ─────────────────────────────────────────────────────────
def _prepare_image(
    image_bytes: bytes,
    hint_mime: Optional[str] = None,
    enhance: bool = True,
    max_px: int = 2048,
    jpeg_quality: int = 88,
) -> Tuple[bytes, str]:
    """
    Prepare image for Gemini Vision API.
    Maintains up to 2048px resolution and 88 JPEG quality so fine Tamil characters,
    archaic Grantha ligatures, and weathered inscription strokes remain completely legible.
    """
    if not PIL_AVAILABLE:
        return image_bytes, hint_mime or "image/jpeg"
    try:
        pil = Image.open(io.BytesIO(image_bytes))
        fmt = (pil.format or "").upper()

        # Resize only if excessively large to avoid memory bottlenecks while preserving clarity
        if max(pil.size) > max_px:
            ratio    = max_px / max(pil.size)
            new_size = (int(pil.size[0] * ratio), int(pil.size[1] * ratio))
            pil      = pil.resize(new_size, Image.LANCZOS)
            logger.info(f"Resized image from {fmt} to {pil.size} (max_px={max_px})")

        if pil.mode not in ("RGB", "L", "RGBA"):
            pil = pil.convert("RGB")

        pil = _enhance_image(pil, enhance)

        if pil.mode == "RGBA":
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            data = buf.getvalue()
            logger.info(f"Prepared as PNG ({len(data)} B)")
            return data, "image/png"

        if pil.mode != "RGB":
            pil = pil.convert("RGB")

        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        data = buf.getvalue()
        logger.info(f"Prepared as JPEG from {fmt} ({len(data)} B, q={jpeg_quality})")
        return data, "image/jpeg"
    except Exception as exc:
        logger.warning(f"PIL preparation failed ({exc}); using raw bytes")
        return image_bytes, hint_mime or "image/jpeg"


# ── Anti-hallucination Prompts for Historical Tamil & Inscriptions ───────────
_BASE_EXTRACT_TAMIL = (
    "You are an expert Tamil epigraphist and historical document scholar specializing in:\n"
    "1. Century-old printed Tamil books and archival journals\n"
    "2. Ancient stone inscriptions (கல்வெட்டுகள்) and copper plates (செப்பேடுகள்)\n"
    "3. Palm-leaf manuscripts (ஓலைச்சுவடிகள்)\n\n"
    "TASK: Transcribe ALL Tamil text visible in this image with absolute fidelity.\n\n"
    "MANDATORY TRANSCRIPTION & ANTI-HALLUCINATION RULES:\n"
    "- Transcribe only the Tamil characters and words supported by the supplied source image or PDF page.\n"
    "- Preserve the original spelling, punctuation, word order, and paragraph structure as closely as the image permits.\n"
    "- Do not translate, summarize, modernize, complete sentences from context, or invent missing text during transcription.\n"
    "- If a character or word cannot be read confidently, mark it as [unclear] and record its approximate location.\n"
    "- Keep uncertain alternatives separate from the raw transcription under suggested corrections.\n"
    "- Never silently replace the original OCR output with an AI-generated guess.\n"
    "- Preserve archaic Tamil numerals (௧, ௨, ௩, etc.), Grantha letters (ஶ, ஜ, ஷ, ஸ, ஹ, க்ஷ), pulli conventions, and sandhi exactly as written.\n"
    "- If the page contains no legible Tamil text (e.g., blank scan, purely ornamental margin), output [EMPTY_PAGE].\n"
    "- Output the transcription directly. Do NOT include markdown fences, preambles, or conversational greetings.\n"
)

_PROMPT_TAM = (
    _BASE_EXTRACT_TAMIL
    + "\nOutput format:\n"
    "---TAMIL_ORIGINAL---\n"
    "<Exact raw Tamil transcription here with [unclear] for damaged portions>\n"
    "---SUGGESTED_CORRECTIONS---\n"
    "<List only if there are genuine epigraphical readings for [unclear] segments, e.g., 'Line 3: [unclear] likely corresponds to ...', otherwise leave blank>\n"
)

_PROMPT_TAM_ENG = (
    _BASE_EXTRACT_TAMIL
    + "\nOutput format — use these exact separator headers:\n"
    "---TAMIL_ORIGINAL---\n"
    "<Exact raw Tamil transcription with [unclear] for illegible portions>\n"
    "---SUGGESTED_CORRECTIONS---\n"
    "<List any scholarly notes or suggested readings for [unclear] segments, or leave blank>\n"
    "---ENGLISH_TRANSLATION---\n"
    "<Faithful English translation strictly translating ONLY the extracted Tamil text. Mark unreadable portions as [unclear]. Do NOT invent a narrative.>\n"
)

_PROMPT_TAM_HIN = (
    _BASE_EXTRACT_TAMIL
    + "\nOutput format — use these exact separator headers:\n"
    "---TAMIL_ORIGINAL---\n"
    "<Exact raw Tamil transcription with [unclear] for illegible portions>\n"
    "---SUGGESTED_CORRECTIONS---\n"
    "<List any scholarly notes or suggested readings for [unclear] segments, or leave blank>\n"
    "---HINDI_TRANSLATION---\n"
    "<Faithful Hindi (हिन्दी) translation strictly translating ONLY the extracted Tamil text. Mark unreadable portions as [unclear]. Do NOT invent extra narrative.>\n"
)

_PROMPT_TAM_ENG_HIN = (
    _BASE_EXTRACT_TAMIL
    + "\nOutput format — use these exact separator headers:\n"
    "---TAMIL_ORIGINAL---\n"
    "<Exact raw Tamil transcription with [unclear] for illegible portions>\n"
    "---SUGGESTED_CORRECTIONS---\n"
    "<List any scholarly notes or suggested readings for [unclear] segments, or leave blank>\n"
    "---ENGLISH_TRANSLATION---\n"
    "<Faithful English translation strictly translating ONLY the extracted Tamil text. Mark unreadable portions as [unclear]. Do NOT invent a narrative.>\n"
    "---HINDI_TRANSLATION---\n"
    "<Faithful Hindi (हिन्दी) translation strictly translating ONLY the extracted Tamil text. Mark unreadable portions as [unclear].>\n"
)

_PROMPT_ENG = (
    "You are an expert Tamil historical epigraphist and scholar.\n\n"
    "TASK:\n"
    "1. Faithfully extract the Tamil source text without hallucinating. Mark weathered/illegible portions as [unclear].\n"
    "2. Translate strictly what is present into accurate English.\n\n"
    "Output format — use these exact separators:\n"
    "---TAMIL_ORIGINAL---\n"
    "<Exact raw Tamil transcription with [unclear] for illegible portions>\n"
    "---SUGGESTED_CORRECTIONS---\n"
    "<Scholarly notes or alternative readings for [unclear] parts, or leave blank>\n"
    "---ENGLISH_TRANSLATION---\n"
    "<Faithful English translation of the extracted text. Use [unclear] for unreadable portions.>\n"
)


def _ocr_prompt(lang: str) -> str:
    if lang == "tam":
        return _PROMPT_TAM
    if lang == "eng":
        return _PROMPT_ENG
    if lang in ("tam+hin", "hin"):
        return _PROMPT_TAM_HIN
    if lang in ("tam+eng+hin", "all"):
        return _PROMPT_TAM_ENG_HIN
    return _PROMPT_TAM_ENG


# ── Text cleaning ─────────────────────────────────────────────────────────────
def clean_ocr_text(text: str) -> str:
    text = text.replace("\u200c", "").replace("\ufeff", "").strip()
    if text.startswith("```") and "```" in text[3:]:
        lines = text.split("\n")
        text  = "\n".join(lines[1:-1]).strip()
    return text


def _parse_ocr_response(raw: str) -> Tuple[str, Optional[str], Optional[str], Optional[str]]:
    """
    Parse raw model response into:
    (tamil_transcription, english_translation, suggested_corrections, hindi_translation).
    Supports all separator headers cleanly.
    """
    tamil = ""
    english = None
    corrections = None
    hindi = None

    headers = [
        "---TAMIL_ORIGINAL---",
        "---SUGGESTED_CORRECTIONS---",
        "---ENGLISH_TRANSLATION---",
        "---HINDI_TRANSLATION---",
    ]
    has_headers = any(h in raw for h in headers)

    if has_headers:
        pattern = r"(---TAMIL_ORIGINAL---|---SUGGESTED_CORRECTIONS---|---ENGLISH_TRANSLATION---|---HINDI_TRANSLATION---)"
        parts = re.split(pattern, raw)
        sections: dict[str, str] = {}
        current_header = None
        for p in parts:
            p_strip = p.strip()
            if p_strip in headers:
                current_header = p_strip
            elif current_header:
                sections[current_header] = clean_ocr_text(p)

        tamil = sections.get("---TAMIL_ORIGINAL---", "")
        corrections = sections.get("---SUGGESTED_CORRECTIONS---") or None
        english = sections.get("---ENGLISH_TRANSLATION---") or None
        hindi = sections.get("---HINDI_TRANSLATION---") or None

        if not tamil and len(parts) > 1 and parts[0].strip():
            tamil = clean_ocr_text(parts[0])
    else:
        tamil = clean_ocr_text(raw)

    # Clean up empty page markers
    if tamil.strip() == "[EMPTY_PAGE]":
        tamil = ""

    # Filter out prompt template placeholders if echoed by model
    if corrections:
        c_str = corrections.strip()
        if (c_str.startswith("<") and c_str.endswith(">")) or ("leave blank" in c_str.lower() and len(c_str) < 120):
            corrections = None

    if english:
        e_str = english.strip()
        if (e_str.startswith("<") and e_str.endswith(">")) or ("faithful english translation" in e_str.lower() and len(e_str) < 120):
            english = None

    if hindi:
        h_str = hindi.strip()
        if (h_str.startswith("<") and h_str.endswith(">")) or ("faithful hindi" in h_str.lower() and len(h_str) < 120):
            hindi = None

    return tamil, english, corrections, hindi


def _split_tamil_english(raw: str) -> Tuple[str, Optional[str], Optional[str]]:
    """Backwards-compatible wrapper returning (tamil, english, corrections)."""
    t, e, c, _ = _parse_ocr_response(raw)
    return t, e, c


# ── Core single-model call with per-model backoff ─────────────────────────────
def _call_single_model(
    client,
    model: str,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
) -> str:
    """
    Try one specific model with bounded retries for transient errors.
    Raises GeminiError on all failures (caller decides what to do next).
    """
    last_err: Optional[GeminiError] = None

    for attempt in range(_MAX_ATTEMPTS_PER_MODEL):
        try:
            resp = client.models.generate_content(
                model=model,
                contents=[
                    genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    genai_types.Part.from_text(text=prompt),
                ],
            )
            return resp.text or ""

        except GeminiError:
            raise

        except Exception as raw_exc:
            gerr     = _classify_error(raw_exc, model=model)
            last_err = gerr
            logger.warning(
                f"Model {model!r} attempt {attempt + 1}/{_MAX_ATTEMPTS_PER_MODEL} "
                f"[{gerr.category}]: {gerr}"
            )

            # Permanent errors — raise immediately
            if gerr.category in _NON_RETRYABLE_PERMANENT:
                raise gerr from raw_exc

            # MODEL_NOT_FOUND — caller should switch models, not retry
            if gerr.category == GeminiError.MODEL_NOT_FOUND:
                raise gerr from raw_exc

            # SERVER_ERROR (503/500/504) — retry once on same model before switching to next candidate
            if gerr.category == GeminiError.SERVER_ERROR and attempt >= 1:
                raise gerr from raw_exc

            # Last attempt for this model
            if attempt >= _MAX_ATTEMPTS_PER_MODEL - 1:
                raise gerr from raw_exc

            # Transient (RATE_LIMIT / SERVER_ERROR / UNKNOWN) — wait and retry
            wait = _backoff_wait(attempt, gerr)
            logger.info(f"Waiting {wait:.1f}s before retry {attempt + 2}/{_MAX_ATTEMPTS_PER_MODEL}...")
            time.sleep(wait)

    raise last_err or GeminiError(GeminiError.UNKNOWN, "No attempts made", model=model)


# ── Model-fallback orchestrator ────────────────────────────────────────────────
class ModelSwitchEvent:
    """Yielded during model fallback to notify callers (e.g. SSE stream)."""
    def __init__(self, from_model: str, to_model: str, reason: str):
        self.from_model = from_model
        self.to_model   = to_model
        self.reason     = reason


def _call_with_fallback(
    client,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    on_model_switch=None,   # optional callback(ModelSwitchEvent)
) -> Tuple[str, str]:
    """
    Try each model in the validated queue in order.
    - MODEL_NOT_FOUND      → mark model unavailable, try next immediately
    - SERVER_ERROR         → retry same model, then try next if still failing
    - RATE_LIMIT           → retry same model with backoff (per _call_single_model)
    - QUOTA_EXHAUSTED /
      INVALID_KEY          → raise immediately; caller propagates to user

    Returns (response_text, model_name_that_succeeded).
    """
    queue = get_model_queue(client)
    if not queue:
        raise GeminiError(
            GeminiError.MODEL_NOT_FOUND,
            "No Gemini models are available for this API key. "
            "Check https://aistudio.google.com/app/apikey and try a different key.",
        )

    last_err: Optional[GeminiError] = None

    for idx, model in enumerate(queue):
        try:
            logger.info(f"Calling model {model!r} (queue position {idx + 1}/{len(queue)})")
            text = _call_single_model(client, model, image_bytes, mime_type, prompt)
            return text, model

        except GeminiError as gerr:
            last_err = gerr

            # Permanent — do not try any further model
            if gerr.category in _NON_RETRYABLE_PERMANENT:
                raise

            # Model not available for this key — mark it, try next
            if gerr.category == GeminiError.MODEL_NOT_FOUND:
                logger.warning(f"Model {model!r} unavailable (404). Removing from queue.")
                mark_model_unavailable(model)
                if idx + 1 < len(queue):
                    next_model = queue[idx + 1]
                    logger.info(f"Switching to next model: {next_model!r}")
                    if on_model_switch:
                        on_model_switch(ModelSwitchEvent(
                            from_model=model,
                            to_model=next_model,
                            reason=f"Model unavailable (404) — switching to {next_model}",
                        ))
                continue   # loop to next model

            # Server error after all per-model retries — try next model
            if gerr.category == GeminiError.SERVER_ERROR:
                if idx + 1 < len(queue):
                    next_model = queue[idx + 1]
                    logger.warning(
                        f"Model {model!r} server errors exhausted. "
                        f"Switching to {next_model!r}."
                    )
                    if on_model_switch:
                        on_model_switch(ModelSwitchEvent(
                            from_model=model,
                            to_model=next_model,
                            reason=f"Server unavailable — switching to {next_model}",
                        ))
                    continue
                raise   # last model, give up

            # RATE_LIMIT / UNKNOWN — already retried in _call_single_model; raise
            raise

    # Exhausted all models
    raise last_err or GeminiError(
        GeminiError.MODEL_NOT_FOUND,
        "All available Gemini models failed. "
        "Check API key permissions and try again later.",
    )


# ── User-facing error messages ────────────────────────────────────────────────
def _err_msg(err: GeminiError, model: str) -> str:
    c = err.category
    if c == GeminiError.QUOTA_EXHAUSTED:
        return (
            "[QUOTA_EXHAUSTED] Gemini free-tier daily quota exhausted. "
            "Check https://aistudio.google.com/app/usage — "
            "try again tomorrow or enable billing. "
            "No mock text generated."
        )
    if c == GeminiError.RATE_LIMIT:
        ra = err.retry_after or 60
        return (
            f"[RATE_LIMIT] Per-minute rate limit hit on {model!r}. "
            f"Backed off {ra}s but still failed. "
            "Wait ~1 minute and use 'Retry Failed Pages'."
        )
    if c == GeminiError.INVALID_KEY:
        return (
            "[INVALID_KEY] API key rejected by Gemini. "
            "Verify GEMINI_API_KEY at https://aistudio.google.com/app/apikey "
            "and restart the backend."
        )
    if c == GeminiError.MODEL_NOT_FOUND:
        return (
            f"[MODEL_NOT_FOUND] No available Gemini model could process this page. "
            "All models in the fallback queue failed. "
            "Check your API key permissions at https://aistudio.google.com/app/apikey."
        )
    if c == GeminiError.SERVER_ERROR:
        return (
            f"[SERVER_ERROR] Gemini servers unavailable for all models after retries. "
            "Wait a few minutes and use 'Retry Failed Pages'."
        )
    return f"[UNKNOWN] {err}"


# ── Single-image OCR (public API) ─────────────────────────────────────────────
def process_image_bytes(
    image_bytes: bytes,
    lang: str = "tam+eng",
    content_type: Optional[str] = None,
    enhance: bool = True,
    on_model_switch=None,
) -> dict:
    """
    Process a single image for Tamil OCR / translation.
    lang: 'tam' | 'tam+eng' | 'eng'
    on_model_switch: optional callback(ModelSwitchEvent) — called when models are switched
    Returns a result dict — never raises.
    """
    api_key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    model       = _current_model()

    base: dict = {
        "success":              False,
        "raw_text":             "",
        "cleaned_text":         "",
        "tamil_text":           "",
        "english_translation":  None,
        "hindi_translation":    None,
        "suggested_corrections": None,
        "confidence_score":     0,
        "words_with_confidence": [],
        "regions_found":        0,
        "engine":               "gemini",
        "engine_model":         model,
        "api_key_configured":   api_key_set,
        "error":                None,
        "error_category":       None,
        "quota_exhausted":      False,
        "language":             lang,
        "model_switched":       False,
        "final_model":          model,
    }

    # 1. Image validation check
    is_valid, val_err, dims = validate_image_bytes(image_bytes)
    if not is_valid:
        base["error"] = val_err or "Invalid or corrupted image file."
        base["error_category"] = "INVALID_IMAGE"
        base["status"] = "failed"
        base["needs_review"] = True
        return base

    if not GENAI_AVAILABLE:
        base["error"] = "google-genai not installed. Run: pip install google-genai"
        return base

    client = _get_client()
    if client is None:
        base["error"] = (
            "GEMINI_API_KEY not configured. "
            "Add GEMINI_API_KEY=your_key to backend/.env and restart."
        )
        base["api_key_configured"] = False
        return base

    try:
        pb, mime = _prepare_image(image_bytes, content_type, enhance=enhance)
        prompt   = _ocr_prompt(lang)
        logger.info(
            f"Gemini OCR: preferred_model={model!r} lang={lang!r} "
            f"size={len(pb)} B mime={mime}"
        )

        switched: List[ModelSwitchEvent] = []

        def _on_switch(evt: ModelSwitchEvent) -> None:
            switched.append(evt)
            if on_model_switch:
                on_model_switch(evt)

        raw, used_model = _call_with_fallback(
            client, pb, mime, prompt, on_model_switch=_on_switch,
        )
        tamil, english, corrections, hindi = _parse_ocr_response(raw)
        display = hindi if lang == "hin" else (english if lang == "eng" else tamil)

        # Empty OCR / unreadable text detection
        is_empty = not bool(tamil.strip() or (english and english.strip()) or (hindi and hindi.strip()))
        has_unclear = "[unclear]" in raw.lower()
        needs_review = is_empty or has_unclear or bool(corrections)
        status = "needs_review" if needs_review else "completed"

        # Realistic confidence score based on word volume and presence of [unclear] markers
        # Avoids fabricated, misleading 100% scores on degraded or blank pages
        words = tamil.strip().split()
        total_w = len(words)
        if is_empty:
            confidence = 0
        elif total_w == 0:
            confidence = 10
        else:
            unclear_count = raw.lower().count("[unclear]")
            ratio = max(0.0, 1.0 - (unclear_count / max(1, total_w)))
            confidence = int(round(ratio * 96))
            if has_unclear:
                confidence = min(confidence, 72)
            confidence = max(15, min(98, confidence))

        base.update(
            success=True,
            status=status,
            needs_review=needs_review,
            raw_text=raw,
            cleaned_text=display,
            tamil_text=tamil,
            english_translation=english,
            hindi_translation=hindi,
            suggested_corrections=corrections,
            confidence_score=confidence,
            regions_found=1 if not is_empty else 0,
            engine_model=used_model,
            final_model=used_model,
            model_switched=len(switched) > 0,
        )
        logger.info(
            f"OCR ok via {used_model!r} — {len(tamil)} Tamil chars, "
            f"status={status}, confidence={confidence}%, translation={'yes' if english else 'no'}"
            + (f", switched from {switched[0].from_model!r}" if switched else "")
        )

    except GeminiError as gerr:
        used_model = getattr(gerr, "model", None) or model
        msg = _err_msg(gerr, used_model)
        logger.error(f"GeminiError [{gerr.category}] model={used_model!r}: {gerr}")
        base["error"]          = msg
        base["error_category"] = gerr.category
        base["quota_exhausted"] = (gerr.category == GeminiError.QUOTA_EXHAUSTED)
        base["status"]         = "failed"
        base["needs_review"]   = True
        base["engine_model"]   = used_model
        base["final_model"]    = used_model

    except Exception as exc:
        gerr = _classify_error(exc, model=model)
        msg  = _err_msg(gerr, model)
        logger.error(f"Unexpected error [{gerr.category}]: {exc}")
        base["error"]          = msg
        base["error_category"] = gerr.category
        base["quota_exhausted"] = (gerr.category == GeminiError.QUOTA_EXHAUSTED)
        base["status"]         = "failed"
        base["needs_review"]   = True

    return base


# ── PDF support ───────────────────────────────────────────────────────────────
def get_pdf_info(pdf_bytes: bytes) -> dict:
    if not FITZ_AVAILABLE:
        return {"error": "PyMuPDF not installed. Run: pip install pymupdf", "page_count": 0}
    with _fitz_lock:
        try:
            doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
            n    = len(doc)
            has_text = any(doc[i].get_text().strip() for i in range(min(3, n)))
            doc.close()
            return {"page_count": n, "has_digital_text": has_text, "error": None}
        except Exception as e:
            return {"error": f"PDF read error: {e}", "page_count": 0}


# ── In-session rendered-image cache ──────────────────────────────────────────
# Content-hashed key: (pdf_sha256, page_index, dpi) -> bytes
_image_cache: dict = {}


def _get_pdf_hash(pdf_bytes: bytes) -> str:
    """Generate a fast, stable fingerprint for pdf_bytes that persists across requests."""
    prefix = pdf_bytes[:65536] if len(pdf_bytes) >= 65536 else pdf_bytes
    return hashlib.sha256(prefix + str(len(pdf_bytes)).encode()).hexdigest()[:24]


def pdf_page_to_image(pdf_bytes: bytes, page_index: int, dpi: int = 180) -> bytes:
    """Render one PDF page to JPEG bytes. Thread-safe and uses stable content-hashed cache."""
    if not FITZ_AVAILABLE:
        raise RuntimeError("PyMuPDF not installed.")

    pdf_hash = _get_pdf_hash(pdf_bytes)
    cache_key = (pdf_hash, page_index, dpi)

    with _fitz_lock:
        if cache_key in _image_cache:
            logger.debug(f"Page {page_index + 1}: image cache hit (dpi={dpi})")
            return _image_cache[cache_key]

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            if page_index < 0 or page_index >= len(doc):
                raise ValueError(f"Page {page_index + 1} does not exist in PDF ({len(doc)} total pages)")
            page = doc[page_index]
            mat  = fitz.Matrix(dpi / 72, dpi / 72)
            pix  = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            img  = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf  = io.BytesIO()
            img.save(buf, format="JPEG", quality=88, optimize=True)
            data = buf.getvalue()
            _image_cache[cache_key] = data
            logger.info(f"Page {page_index + 1}: rendered {len(data)//1024}KB (dpi={dpi})")
            return data
        finally:
            doc.close()


def pre_render_pages(pdf_bytes: bytes, page_indices: list, dpi: int = 160) -> None:
    """Pre-render multiple pages into the cache safely."""
    for idx in page_indices:
        try:
            pdf_page_to_image(pdf_bytes, idx, dpi=dpi)
        except Exception as e:
            logger.warning(f"Pre-render page {idx + 1} failed: {e}")


def extract_digital_text_from_page(pdf_bytes: bytes, page_index: int) -> str:
    if not FITZ_AVAILABLE:
        return ""
    with _fitz_lock:
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            try:
                if 0 <= page_index < len(doc):
                    return doc[page_index].get_text().strip()
                return ""
            finally:
                doc.close()
        except Exception as e:
            logger.warning(f"Digital text extraction failed on page {page_index + 1}: {e}")
            return ""


def process_pdf_page(
    pdf_bytes: bytes,
    page_index: int,
    lang: str = "tam+eng",
    enhance: bool = True,
    use_digital_text: bool = False,
    on_model_switch=None,
    dpi: int = 160,
) -> dict:
    """
    Process a single PDF page.
    page_index is 0-based; page_number in result is 1-based.
    on_model_switch: optional callback(ModelSwitchEvent)
    Never raises — always returns a result dict with stable page_number.
    """
    page_num = page_index + 1
    pdf_id = _get_pdf_hash(pdf_bytes)
    logger.info(f"[PDF_PAGE] Job={pdf_id} Page={page_num} START lang={lang}")

    # Fast path: embedded digital text (ONLY if verified genuine Tamil Unicode text)
    if use_digital_text and FITZ_AVAILABLE:
        digital = extract_digital_text_from_page(pdf_bytes, page_index)
        if digital:
            if has_reliable_tamil_text(digital):
                logger.info(f"[PDF_PAGE] Job={pdf_id} Page={page_num} source=digital chars={len(digital)} (genuine Tamil text layer)")
                return {
                    "success":              True,
                    "status":               "completed",
                    "needs_review":         False,
                    "page_number":          page_num,
                    "raw_text":             digital,
                    "cleaned_text":         digital,
                    "tamil_text":           digital,
                    "english_translation":  None,
                    "hindi_translation":    None,
                    "suggested_corrections": None,
                    "confidence_score":     95,
                    "words_with_confidence": [],
                    "regions_found":        1,
                    "engine":               "digital_text",
                    "engine_model":         "pdf_text_layer",
                    "api_key_configured":   True,
                    "error":                None,
                    "error_category":       None,
                    "quota_exhausted":      False,
                    "language":             lang,
                    "source":               "digital",
                    "model_switched":       False,
                    "final_model":          "pdf_text_layer",
                }
            else:
                logger.info(
                    f"[PDF_PAGE] Job={pdf_id} Page={page_num} digital text present ({len(digital)} chars) "
                    f"but lacks genuine Tamil Unicode content. Falling back to Gemini Vision OCR."
                )

    # Render page to image
    t_render_start = time.monotonic()
    try:
        img_bytes = pdf_page_to_image(pdf_bytes, page_index, dpi=dpi)
        render_dur = round(time.monotonic() - t_render_start, 2)
        logger.info(f"[PDF_PAGE] Job={pdf_id} Page={page_num} Render=SUCCESS ({len(img_bytes)//1024}KB, {render_dur}s)")
    except Exception as e:
        logger.error(f"[PDF_PAGE] Job={pdf_id} Page={page_num} Render=FAILURE error={e}")
        return {
            "success":              False,
            "status":               "failed",
            "needs_review":         True,
            "page_number":          page_num,
            "raw_text":             "",
            "cleaned_text":         "",
            "tamil_text":           "",
            "english_translation":  None,
            "hindi_translation":    None,
            "words_with_confidence": [],
            "regions_found":        0,
            "engine":               "gemini",
            "engine_model":         _current_model(),
            "api_key_configured":   bool(os.environ.get("GEMINI_API_KEY", "").strip()),
            "error":                f"PDF page render failed: {e}",
            "error_category":       "RENDER_ERROR",
            "quota_exhausted":      False,
            "language":             lang,
            "source":               "ocr",
            "model_switched":       False,
            "final_model":          _current_model(),
        }

    t_ocr_start = time.monotonic()
    result = process_image_bytes(
        img_bytes, lang=lang, content_type="image/jpeg",
        enhance=enhance, on_model_switch=on_model_switch,
    )
    ocr_dur = round(time.monotonic() - t_ocr_start, 2)
    result["page_number"] = page_num
    result["source"]      = "ocr"

    logger.info(
        f"[PDF_PAGE] Job={pdf_id} Page={page_num} FINISH Success={result.get('success')} "
        f"Status={result.get('status')} Model={result.get('final_model')} Error={result.get('error_category')} ({ocr_dur}s)"
    )
    return result


# ── Engine info ───────────────────────────────────────────────────────────────
def get_engine_info() -> dict:
    key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    model   = _current_model()
    client  = _get_client() if key_set and GENAI_AVAILABLE else None

    # Build queue (with live validation if client is available)
    try:
        queue = get_model_queue(client)
    except Exception:
        queue = CANDIDATE_MODELS[:]

    return {
        "engine":              "gemini",
        "genai_available":     GENAI_AVAILABLE,
        "api_key_configured":  key_set,
        "model":               model,
        "model_queue":         queue,
        "pdf_support":         FITZ_AVAILABLE,
        "ready":               GENAI_AVAILABLE and key_set,
    }
