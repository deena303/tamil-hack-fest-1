"""
gemini_models.py — Centralized Gemini model configuration and availability check.

Priority-ordered fallback list of models that support multimodal (vision) input.
Only models that the google-genai SDK can call with image bytes are listed.

Model validation:
- On first OCR call, queries the Gemini API model-list endpoint to confirm which
  models exist for the configured API key.
- The result is cached for CACHE_TTL seconds so we don't make an extra API call
  on every page.
- If the model-list endpoint fails (network issue, etc.), we fall back to the
  static CANDIDATE_MODELS list and let individual calls discover unavailability.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Priority-ordered multimodal model candidates ──────────────────────────────
# These are the vision-capable models available in the Gemini API family.
# Order: fastest/cheapest first, most capable last as ultimate fallback.
# Only include models that are confirmed to accept image inline data.
CANDIDATE_MODELS: List[str] = [
    "gemini-flash-lite-latest",  # Primary: fast, light, lowest latency, vision-capable
    "gemini-flash-latest",       # Latest standard flash
    "gemini-2.5-flash",          # Available 2.5 flash
    "gemini-2.5-flash-lite",     # Available 2.5 flash-lite
    "gemini-2.0-flash",          # Fallback
    "gemini-1.5-flash",          # Fallback
]

# Substrings that identify non-vision models — exclude these from the queue.
# Any model whose name contains one of these cannot process image input.
_EXCLUDE_SUFFIXES = (
    "tts",        # text-to-speech  (e.g. gemini-2.5-flash-preview-tts)
    "embedding",  # embedding-only
    "aqa",        # attributed question answering (text-only)
)

# ── Cache of confirmed-available models for this API key ─────────────────────
_available_cache: Optional[List[str]] = None
_cache_ts: float = 0.0
CACHE_TTL: float = 300.0   # 5 minutes



def _env_preferred() -> str:
    """Return the model from GEMINI_MODEL env var, or first candidate."""
    return os.environ.get("GEMINI_MODEL", "").strip() or CANDIDATE_MODELS[0]


def _build_queue_from_cache(preferred: str) -> List[str]:
    """
    Build a de-duplicated ordered list starting with `preferred`,
    then the rest of CANDIDATE_MODELS (skipping duplicates).
    """
    seen: set = set()
    queue: List[str] = []
    for m in [preferred] + CANDIDATE_MODELS:
        if m not in seen:
            seen.add(m)
            queue.append(m)
    return queue


def _is_vision_capable(model_name: str) -> bool:
    """
    Return True only for models that accept image/bytes inline data.
    Excludes TTS, embedding, AQA, and other text-only models.
    """
    name_lower = model_name.lower()
    # Must start with gemini-
    if not name_lower.startswith("gemini-"):
        return False
    # Exclude known non-vision suffixes/substrings
    for excl in _EXCLUDE_SUFFIXES:
        if excl in name_lower:
            return False
    return True


def query_available_models(client) -> List[str]:
    """
    Query the Gemini API for models available to this API key.
    Filters to only vision-capable models (image input supported).
    Caches the result for CACHE_TTL seconds.
    Returns empty list on failure (caller falls back to static list).
    """
    global _available_cache, _cache_ts

    now = time.monotonic()
    if _available_cache is not None and (now - _cache_ts) < CACHE_TTL:
        return _available_cache

    try:
        found: List[str] = []
        for m in client.models.list():
            name = getattr(m, "name", "") or ""
            bare = name.removeprefix("models/")

            # Only keep vision-capable Gemini models
            if not _is_vision_capable(bare):
                continue

            # Check supported actions — generateContent must be present
            actions = getattr(m, "supported_actions", None) or []
            if actions and "generateContent" not in actions:
                continue

            found.append(bare)

        if found:
            _available_cache = found
            _cache_ts = now
            logger.info(f"Available vision models: {found}")
            return found

    except Exception as exc:
        import re
        safe = re.sub(r"[A-Za-z0-9_\-]{20,}", "[REDACTED]", str(exc))
        logger.warning(f"Could not query Gemini model list: {safe}")

    return []


def get_model_queue(client=None) -> List[str]:
    """
    Return an ordered list of models to try, starting with the configured
    or preferred model.

    If a live model list is available (from the API), intersect CANDIDATE_MODELS
    with the confirmed-available set (preserving priority order) and put the
    env-preferred model first.

    Falls back to the full CANDIDATE_MODELS static list if the API query fails.
    """
    preferred = _env_preferred()

    if client is not None:
        live = query_available_models(client)
        if live:
            # Build queue: preferred first, then candidates that exist in the live list
            live_set = set(live)
            queue: List[str] = []
            seen: set = set()
            for m in [preferred] + CANDIDATE_MODELS:
                if m not in seen and m in live_set:
                    seen.add(m)
                    queue.append(m)
            if queue:
                logger.info(f"Model queue (validated): {queue}")
                return queue
            # If none of our candidates appear in the live list, return all live
            # gemini models as fallback (they might be newer names)
            logger.warning(
                "None of our candidate models appear in the API model list. "
                "Returning raw API list as fallback."
            )
            return [m for m in live if m.startswith("gemini-")]

    queue = _build_queue_from_cache(preferred)
    logger.info(f"Model queue (static): {queue}")
    return queue


def invalidate_cache() -> None:
    """Force re-query of available models on next call."""
    global _available_cache, _cache_ts
    _available_cache = None
    _cache_ts = 0.0


def mark_model_unavailable(model: str) -> None:
    """
    Remove `model` from the cached available list so it won't be tried again
    this session. Called when a MODEL_NOT_FOUND error is confirmed.
    """
    global _available_cache
    if _available_cache is not None and model in _available_cache:
        _available_cache = [m for m in _available_cache if m != model]
        logger.info(f"Removed unavailable model from cache: {model!r}")
