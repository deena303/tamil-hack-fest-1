"""
OCR Engine — Gemini Vision backend
Replaces Tesseract with Google Gemini for Tamil text extraction.

Pipeline: image bytes → PIL conversion → Gemini vision API → cleaned text
"""

from __future__ import annotations

import io
import os
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ── tenacity for retry logic ──────────────────────────────────────────────────
try:
    from tenacity import (
        retry,
        stop_after_attempt,
        wait_exponential,
        retry_if_exception,
    )
    TENACITY_AVAILABLE = True
except ImportError:
    TENACITY_AVAILABLE = False
    logger.warning("tenacity not installed — retries disabled.")

# ── MIME types Gemini vision accepts natively ─────────────────────────────────
_GEMINI_NATIVE_MIME = frozenset(
    {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
)

# ── google-genai SDK import ───────────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
    logger.info("google-genai SDK loaded successfully.")
except ImportError:
    GENAI_AVAILABLE = False
    genai = None  # type: ignore
    genai_types = None  # type: ignore
    logger.error(
        "google-genai package not installed. "
        "Run: .venv\\Scripts\\pip install google-genai"
    )

# ── Lazy client & config  ─────────────────────────────────────────────────────
_client: Optional[object] = None
_client_key: Optional[str] = None   # key used to build _client


def _get_client():
    """Return a Gemini client, rebuilding if the API key changed."""
    global _client, _client_key
    if not GENAI_AVAILABLE:
        return None
    key = os.environ.get("GEMINI_API_KEY", "").strip() or None
    if not key:
        return None
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
        logger.info("Gemini client initialised.")
    return _client


def _current_model() -> str:
    return (os.environ.get("GEMINI_MODEL", "").strip() or "gemini-3.5-flash")


# ── Image preparation ─────────────────────────────────────────────────────────
def _prepare_image(image_bytes: bytes, hint_mime: Optional[str] = None) -> tuple[bytes, str]:
    """
    Convert the image to a Gemini-compatible format.
    TIFF and BMP are re-encoded as PNG via PIL.
    Returns (bytes, mime_type).
    """
    from PIL import Image

    try:
        pil = Image.open(io.BytesIO(image_bytes))
        fmt = (pil.format or "").upper()
        detected_mime = f"image/{fmt.lower()}" if fmt else (hint_mime or "image/jpeg")

        # Already in a Gemini-native format?
        if detected_mime in _GEMINI_NATIVE_MIME and hint_mime in _GEMINI_NATIVE_MIME:
            return image_bytes, detected_mime

        # Normalise mode for PNG export
        if pil.mode not in ("RGB", "RGBA", "L"):
            pil = pil.convert("RGB")

        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        logger.info(f"Image converted from {fmt} to PNG ({len(buf.getvalue())} bytes).")
        return buf.getvalue(), "image/png"

    except Exception as exc:
        logger.warning(f"PIL image conversion failed ({exc}); using raw bytes.")
        return image_bytes, hint_mime or "image/jpeg"


# ── OCR prompts ───────────────────────────────────────────────────────────────
_PROMPT_TAMIL = (
    "You are a Tamil historical-document transcription engine. "
    "Transcribe the Tamil text visible in the supplied image as faithfully as possible. "
    "Preserve the original wording, spelling, punctuation, line order, and historical spelling. "
    "Do not translate, paraphrase, modernize, summarize, or complete missing words using context. "
    "Do not invent characters or words. "
    "If a portion is genuinely unreadable, mark it as [unclear]. "
    "Return only the transcription, without explanations or Markdown."
)

_PROMPT_ENGLISH = (
    "You are a document transcription engine. "
    "Transcribe the English text visible in the supplied image as faithfully as possible. "
    "Preserve the original wording, spelling, punctuation, and line order. "
    "Do not translate, paraphrase, summarize, or complete missing words. "
    "Do not invent characters or words. "
    "If a portion is genuinely unreadable, mark it as [unclear]. "
    "Return only the transcription, without explanations or Markdown."
)

_PROMPT_BILINGUAL = (
    "You are a Tamil and English historical-document transcription engine. "
    "Transcribe all Tamil and English text visible in the supplied image as faithfully as possible. "
    "Preserve the original wording, spelling, punctuation, line order, and historical spelling. "
    "Do not translate, paraphrase, modernize, summarize, or complete missing words using context. "
    "Do not invent characters or words. "
    "If a portion is genuinely unreadable, mark it as [unclear]. "
    "Return only the transcription, without explanations or Markdown."
)


def _ocr_prompt(lang: str) -> str:
    if lang == "tam":
        return _PROMPT_TAMIL
    if lang == "eng":
        return _PROMPT_ENGLISH
    return _PROMPT_BILINGUAL   # tam+eng or anything else


# ── Text cleaning ─────────────────────────────────────────────────────────────
def clean_ocr_text(text: str) -> str:
    """Light cleaning that does not alter the historical transcription content."""
    text = text.replace("\u200c", "")   # zero-width non-joiner
    text = text.replace("\ufeff", "")   # BOM
    text = text.strip()

    # Strip accidental Markdown fences the model may add despite the instruction
    if text.startswith("```") and text.endswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]).strip()

    return text


# ── Retry predicate ──────────────────────────────────────────────────────────
def _is_retryable(exc: BaseException) -> bool:
    """Return True for transient Gemini errors that should be retried."""
    msg = str(exc)
    return any(kw in msg for kw in (
        "503", "UNAVAILABLE", "RESOURCE_EXHAUSTED",
        "rate", "quota", "overload", "temporarily",
    ))


# ── Main entry point ──────────────────────────────────────────────────────────
def process_image_bytes(
    image_bytes: bytes,
    lang: str = "tam+eng",
    content_type: Optional[str] = None,
) -> dict:
    """
    Send the uploaded image to Gemini and return a structured OCR result.
    Compatible with the existing OCRResult response schema.
    """
    api_key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    model = _current_model()

    result: dict = {
        "success": False,
        "raw_text": "",
        "cleaned_text": "",
        "words_with_confidence": [],   # Gemini does not expose per-word confidence
        "regions_found": 0,
        "engine": "gemini",
        "engine_model": model,
        "api_key_configured": api_key_set,
        "error": None,
        "language": lang,
    }

    if not GENAI_AVAILABLE:
        result["error"] = (
            "google-genai package is not installed. "
            "Run:  .venv\\Scripts\\pip install google-genai"
        )
        return result

    client = _get_client()
    if client is None:
        result["error"] = (
            "GEMINI_API_KEY is not configured. "
            "Add  GEMINI_API_KEY=your_key  to backend/.env and restart the backend."
        )
        result["api_key_configured"] = False
        return result

    try:
        prepared_bytes, mime_type = _prepare_image(image_bytes, content_type)
        prompt = _ocr_prompt(lang)

        logger.info(
            f"Calling Gemini model={model!r}  lang={lang!r}  "
            f"image={len(prepared_bytes)}B  mime={mime_type}"
        )

        # ── Call Gemini with automatic retry on transient errors ─────────────
        def _call_gemini():
            return client.models.generate_content(
                model=model,
                contents=[
                    genai_types.Part.from_bytes(data=prepared_bytes, mime_type=mime_type),
                    genai_types.Part.from_text(text=prompt),
                ],
            )

        if TENACITY_AVAILABLE:
            _call_with_retry = retry(
                retry=retry_if_exception(_is_retryable),
                stop=stop_after_attempt(4),
                wait=wait_exponential(multiplier=2, min=3, max=30),
                reraise=True,
                before_sleep=lambda rs: logger.warning(
                    f"Gemini transient error — retry {rs.attempt_number}/4 "
                    f"in {rs.next_action.sleep:.0f}s..."
                ),
            )(_call_gemini)
            response = _call_with_retry()
        else:
            # Simple manual retry fallback
            last_exc = None
            for attempt in range(1, 4):
                try:
                    response = _call_gemini()
                    last_exc = None
                    break
                except Exception as e:
                    last_exc = e
                    if _is_retryable(e) and attempt < 3:
                        wait = 2 ** attempt * 3
                        logger.warning(f"Gemini transient error, retrying in {wait}s... ({attempt}/3)")
                        time.sleep(wait)
                    else:
                        raise
            if last_exc:
                raise last_exc

        raw_text: str = response.text or ""
        cleaned_text = clean_ocr_text(raw_text)

        result.update(
            success=True,
            raw_text=raw_text,
            cleaned_text=cleaned_text,
            regions_found=1,   # Gemini processes the image as a single unit
        )
        logger.info(f"Gemini OCR complete — {len(cleaned_text)} chars extracted.")

    except Exception as exc:
        err = str(exc)
        logger.exception("Gemini API error during OCR")

        if "API_KEY_INVALID" in err or "invalid api key" in err.lower():
            result["error"] = (
                "Invalid GEMINI_API_KEY. "
                "Verify the key at https://aistudio.google.com and update backend/.env."
            )
        elif "QUOTA_EXCEEDED" in err or "quota" in err.lower():
            result["error"] = (
                "Gemini API quota exceeded. "
                "Check your usage limits at https://aistudio.google.com"
            )
        elif "RESOURCE_EXHAUSTED" in err or "rate" in err.lower():
            result["error"] = "Gemini API rate limit reached. Wait a moment and try again."
        elif "MODEL_NOT_FOUND" in err or "not found" in err.lower():
            result["error"] = (
                f"Gemini model '{model}' not found. "
                "Update GEMINI_MODEL in backend/.env to a supported model name."
            )
        else:
            result["error"] = f"Gemini API error: {err}"

    return result


# ── Engine info (used by /status endpoint) ────────────────────────────────────
def get_engine_info() -> dict:
    api_key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    model = _current_model()
    return {
        "engine": "gemini",
        "genai_available": GENAI_AVAILABLE,
        "api_key_configured": api_key_set,
        "model": model,
        "ready": GENAI_AVAILABLE and api_key_set,
    }
