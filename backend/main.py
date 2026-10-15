"""
Tharavu (Data) — FastAPI Backend
OCR powered by Google Gemini Vision API.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Optional

# ── Load backend/.env before any other imports ────────────────────────────────
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    with open(_env_file) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _k = _k.strip()
                _v = _v.strip().strip('"').strip("'")
                if _k and _k not in os.environ:
                    os.environ[_k] = _v

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Tharavu (Data) OCR API — Gemini Edition",
    description="Tamil OCR pipeline powered by Google Gemini Vision",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OCR engine ────────────────────────────────────────────────────────────────
try:
    from ocr_engine import get_engine_info, process_image_bytes
    ENGINE_LOADED = True
except ImportError as exc:
    logger.error(f"OCR engine import failed: {exc}")
    ENGINE_LOADED = False

    def process_image_bytes(image_bytes, lang="tam+eng", content_type=None):  # type: ignore
        return {
            "success": False,
            "error": "OCR engine could not be loaded (import error).",
            "api_key_configured": False,
        }

    def get_engine_info():  # type: ignore
        return {
            "engine": "gemini",
            "genai_available": False,
            "api_key_configured": False,
            "model": "",
            "ready": False,
        }


# ── Response schemas ──────────────────────────────────────────────────────────
class WordConfidence(BaseModel):
    word: str
    confidence: int


class OCRResult(BaseModel):
    success: bool
    raw_text: str
    cleaned_text: str
    words_with_confidence: list[WordConfidence]
    regions_found: int
    engine: str
    engine_model: str
    api_key_configured: bool
    language: str
    error: Optional[str]


class SystemStatus(BaseModel):
    ocr_engine: str               # "gemini"
    ocr_engine_loaded: bool       # google-genai SDK importable
    api_key_configured: bool      # GEMINI_API_KEY is set
    gemini_model: str             # model name in use
    ready: bool                   # SDK loaded AND key set
    diagnostic_message: Optional[str]


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/", response_class=PlainTextResponse)
def root():
    return "Tharavu (Data) OCR API v2 (Gemini) — visit /docs"


@app.get("/status", response_model=SystemStatus)
def system_status():
    """Returns Gemini API readiness information."""
    info = get_engine_info()
    ready = info["ready"] and ENGINE_LOADED

    diag: Optional[str] = None
    if not ENGINE_LOADED:
        diag = (
            "OCR engine failed to load. "
            "Run:  .venv\\Scripts\\pip install -r backend/requirements.txt"
        )
    elif not info["genai_available"]:
        diag = (
            "google-genai package is not installed. "
            "Run:  .venv\\Scripts\\pip install google-genai"
        )
    elif not info["api_key_configured"]:
        diag = (
            "GEMINI_API_KEY is not set. "
            "Create backend/.env with:  GEMINI_API_KEY=your_key_here  "
            "then restart the backend. Get a free key at https://aistudio.google.com"
        )

    return SystemStatus(
        ocr_engine=info["engine"],
        ocr_engine_loaded=ENGINE_LOADED and info["genai_available"],
        api_key_configured=info["api_key_configured"],
        gemini_model=info["model"],
        ready=ready,
        diagnostic_message=diag,
    )


@app.post("/ocr", response_model=OCRResult)
async def ocr_image(
    file: UploadFile = File(..., description="Image file (JPEG/PNG/TIFF/BMP)"),
    lang: str = Form("tam+eng", description="Language code: tam+eng | tam | eng"),
):
    """
    Extract text from the uploaded image using Gemini Vision.
    Supports JPEG, PNG, TIFF, BMP (TIFF/BMP are auto-converted to PNG).
    """
    # ── Validate file type ────────────────────────────────────────────────────
    allowed_types = {
        "image/jpeg", "image/jpg", "image/png", "image/tiff",
        "image/bmp", "image/x-tiff", "image/tif", "image/x-bmp",
        "application/octet-stream",
    }
    allowed_exts = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp"}

    content_type = file.content_type or ""
    ext = Path(file.filename or "").suffix.lower()

    if content_type not in allowed_types and ext not in allowed_exts:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{content_type}' / extension '{ext}'. "
                "Use JPEG, PNG, TIFF, or BMP."
            ),
        )

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(image_bytes) > 20 * 1024 * 1024:   # 20 MB cap for Gemini inline upload
        raise HTTPException(
            status_code=413,
            detail="File too large. Maximum size is 20 MB.",
        )

    if not re.match(r"^[a-z+]+$", lang):
        raise HTTPException(
            status_code=400,
            detail="Invalid language code. Use one of: tam+eng, tam, eng.",
        )

    logger.info(
        f"OCR request: file={file.filename!r}  size={len(image_bytes)}B  "
        f"type={content_type}  lang={lang}"
    )

    result = process_image_bytes(image_bytes, lang=lang, content_type=content_type)

    # Return 503 when the engine itself is misconfigured so the frontend shows
    # the diagnostic message rather than an empty result.
    if not result.get("success") and not result.get("api_key_configured"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", "Gemini OCR engine is not configured."),
        )

    info = get_engine_info()
    return OCRResult(
        success=result["success"],
        raw_text=result.get("raw_text", ""),
        cleaned_text=result.get("cleaned_text", ""),
        words_with_confidence=[WordConfidence(**w) for w in result.get("words_with_confidence", [])],
        regions_found=result.get("regions_found", 0),
        engine=result.get("engine", "gemini"),
        engine_model=result.get("engine_model", info["model"]),
        api_key_configured=result.get("api_key_configured", False),
        language=result.get("language", lang),
        error=result.get("error"),
    )


@app.get("/languages")
def available_languages():
    """Gemini supports all languages — returns the three configured options."""
    return {
        "engine": "gemini",
        "languages": [
            {"code": "tam+eng", "label": "Tamil + English"},
            {"code": "tam",     "label": "Tamil only"},
            {"code": "eng",     "label": "English only"},
        ],
    }


# ── Dev entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
