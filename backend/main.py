"""
Tharavu (Data) — FastAPI Backend v3
Tamil OCR + Translation + PDF processing, powered by Google Gemini Vision.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import AsyncGenerator, List, Optional

# ── Load backend/.env ─────────────────────────────────────────────────────────
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    with open(_env_file, encoding="utf-8") as _f:
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
from fastapi.responses import PlainTextResponse, StreamingResponse, Response
from pydantic import BaseModel

from pdf_exporter import generate_document_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Tharavu OCR API v3",
    description="Tamil OCR + Translation + PDF, powered by Google Gemini Vision",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OCR engine import ─────────────────────────────────────────────────────────
try:
    from ocr_engine import (
        get_engine_info,
        get_pdf_info,
        process_image_bytes,
        process_pdf_page,
        pre_render_pages,
        validate_image_bytes,
        ModelSwitchEvent,
    )
    ENGINE_LOADED = True
except ImportError as exc:
    logger.error(f"OCR engine import failed: {exc}")
    ENGINE_LOADED = False

    class ModelSwitchEvent:  # type: ignore
        def __init__(self, from_model="", to_model="", reason=""):
            self.from_model = from_model
            self.to_model   = to_model
            self.reason     = reason

    def pre_render_pages(pdf_bytes, page_indices, dpi=160):  # type: ignore
        pass

    def validate_image_bytes(image_bytes):  # type: ignore
        return True, None, None

    def process_image_bytes(image_bytes, lang="tam+eng", content_type=None, enhance=True, on_model_switch=None):  # type: ignore
        return {"success": False, "error": "OCR engine not loaded.", "api_key_configured": False}

    def get_engine_info():  # type: ignore
        return {"engine": "gemini", "genai_available": False, "api_key_configured": False,
                "model": "", "model_queue": [], "pdf_support": False, "ready": False}

    def get_pdf_info(pdf_bytes):  # type: ignore
        return {"error": "OCR engine not loaded.", "page_count": 0}

    def process_pdf_page(pdf_bytes, page_index, lang, enhance, use_digital_text, on_model_switch=None):  # type: ignore
        return {"success": False, "error": "OCR engine not loaded.", "page_number": page_index + 1}


# ── Schemas ───────────────────────────────────────────────────────────────────
class WordConfidence(BaseModel):
    word: str
    confidence: int


class OCRResult(BaseModel):
    success: bool
    raw_text: str
    cleaned_text: str
    tamil_text: str
    english_translation: Optional[str]
    hindi_translation: Optional[str] = None
    suggested_corrections: Optional[str] = None
    confidence_score: Optional[int] = None
    words_with_confidence: List[WordConfidence]
    regions_found: int
    engine: str
    engine_model: str
    api_key_configured: bool
    language: str
    error: Optional[str]


class PageResult(BaseModel):
    success: bool
    page_number: int
    raw_text: str
    cleaned_text: str
    tamil_text: str
    english_translation: Optional[str]
    hindi_translation: Optional[str] = None
    suggested_corrections: Optional[str] = None
    confidence_score: Optional[int] = None
    engine: str
    engine_model: str
    language: str
    source: str                    # "ocr" | "digital"
    status: str = "completed"      # "completed" | "needs_review" | "failed" | "pending"
    needs_review: bool = False
    error: Optional[str]
    error_category: Optional[str]  # RATE_LIMIT | QUOTA_EXHAUSTED | INVALID_KEY | etc.
    quota_exhausted: bool = False  # True only if daily/monthly quota is exhausted
    model_switched: bool  = False  # True if a model fallback occurred for this page
    final_model: Optional[str] = None  # actual model that produced the result


class PDFInfo(BaseModel):
    page_count: int
    has_digital_text: bool
    error: Optional[str]


class SystemStatus(BaseModel):
    ocr_engine: str
    ocr_engine_loaded: bool
    api_key_configured: bool
    gemini_model: str
    gemini_model_queue: List[str] = []  # validated fallback queue
    pdf_support: bool
    ready: bool
    diagnostic_message: Optional[str]


# ── Helpers ───────────────────────────────────────────────────────────────────
_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/tiff",
    "image/bmp", "image/x-tiff", "image/tif", "image/x-bmp",
    "application/octet-stream",
}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp"}
_VALID_LANG = re.compile(r"^[a-z+]+$")

MAX_IMAGE_BYTES = 20 * 1024 * 1024   # 20 MB
MAX_PDF_BYTES   = 100 * 1024 * 1024  # 100 MB
MAX_PDF_PAGES   = 500


def _make_ocr_result(result: dict, info: dict) -> OCRResult:
    return OCRResult(
        success=result["success"],
        raw_text=result.get("raw_text", ""),
        cleaned_text=result.get("cleaned_text", ""),
        tamil_text=result.get("tamil_text", ""),
        english_translation=result.get("english_translation"),
        hindi_translation=result.get("hindi_translation"),
        suggested_corrections=result.get("suggested_corrections"),
        confidence_score=result.get("confidence_score"),
        words_with_confidence=[
            WordConfidence(**w) for w in result.get("words_with_confidence", [])
        ],
        regions_found=result.get("regions_found", 0),
        engine=result.get("engine", "gemini"),
        engine_model=result.get("engine_model", info["model"]),
        api_key_configured=result.get("api_key_configured", False),
        language=result.get("language", ""),
        error=result.get("error"),
    )


def _make_page_result(result: dict) -> PageResult:
    status = result.get("status")
    if not status:
        if not result.get("success", False):
            status = "failed"
        elif result.get("needs_review"):
            status = "needs_review"
        else:
            status = "completed"

    return PageResult(
        success=result.get("success", False),
        page_number=result.get("page_number", 0),
        raw_text=result.get("raw_text", ""),
        cleaned_text=result.get("cleaned_text", ""),
        tamil_text=result.get("tamil_text", ""),
        english_translation=result.get("english_translation"),
        hindi_translation=result.get("hindi_translation"),
        suggested_corrections=result.get("suggested_corrections"),
        confidence_score=result.get("confidence_score"),
        engine=result.get("engine", "gemini"),
        engine_model=result.get("engine_model", _current_model()),
        language=result.get("language", ""),
        source=result.get("source", "ocr"),
        status=status,
        needs_review=result.get("needs_review", False),
        error=result.get("error"),
        error_category=result.get("error_category"),
        quota_exhausted=result.get("quota_exhausted", False),
        model_switched=result.get("model_switched", False),
        final_model=result.get("final_model"),
    )


def _current_model() -> str:
    return os.environ.get("GEMINI_MODEL", "").strip() or "gemini-flash-lite-latest"


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/", response_class=PlainTextResponse)
def root():
    return "Tharavu OCR API v3 (Gemini + PDF) — visit /docs"


@app.get("/status", response_model=SystemStatus)
def system_status():
    info = get_engine_info()
    ready = info["ready"] and ENGINE_LOADED

    diag: Optional[str] = None
    if not ENGINE_LOADED:
        diag = "OCR engine failed to load. Run: pip install -r backend/requirements.txt"
    elif not info["genai_available"]:
        diag = "google-genai package not installed. Run: pip install google-genai"
    elif not info["api_key_configured"]:
        diag = (
            "GEMINI_API_KEY is not set. "
            "Add GEMINI_API_KEY=your_key to backend/.env and restart. "
            "Get a free key at https://aistudio.google.com"
        )

    return SystemStatus(
        ocr_engine=info["engine"],
        ocr_engine_loaded=ENGINE_LOADED and info["genai_available"],
        api_key_configured=info["api_key_configured"],
        gemini_model=info["model"],
        gemini_model_queue=info.get("model_queue", []),
        pdf_support=info.get("pdf_support", False),
        ready=ready,
        diagnostic_message=diag,
    )


@app.post("/ocr", response_model=OCRResult)
async def ocr_image(
    file: UploadFile = File(...),
    lang: str = Form("tam+eng"),
    enhance: bool = Form(True),
):
    """
    Extract text (and optionally translate) from an uploaded image.
    lang: 'tam' | 'tam+eng' | 'eng'
    enhance: apply contrast/sharpness boost for aged scans
    """
    content_type = file.content_type or ""
    ext = Path(file.filename or "").suffix.lower()

    if content_type not in _IMAGE_TYPES and ext not in _IMAGE_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}' / '{ext}'. Use JPEG, PNG, TIFF, or BMP.",
        )
    if not _VALID_LANG.match(lang):
        raise HTTPException(status_code=400, detail="Invalid lang. Use: tam, tam+eng, eng, tam+hin, tam+eng+hin")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Max 20 MB per image.")

    # Image validation
    is_valid, err_msg, _ = validate_image_bytes(image_bytes)
    if not is_valid:
        raise HTTPException(status_code=400, detail=err_msg or "Corrupted or unreadable image file.")

    logger.info(
        f"OCR image: {file.filename!r} {len(image_bytes)//1024}KB  lang={lang}  enhance={enhance}"
    )

    result = process_image_bytes(image_bytes, lang=lang, content_type=content_type, enhance=enhance)

    if not result.get("success") and not result.get("api_key_configured"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", "Gemini OCR engine is not configured."),
        )

    return _make_ocr_result(result, get_engine_info())


@app.post("/pdf/info", response_model=PDFInfo)
async def pdf_info(file: UploadFile = File(...)):
    """Return page count and metadata for an uploaded PDF (no OCR performed)."""
    ext = Path(file.filename or "").suffix.lower()
    ct = file.content_type or ""
    if ext != ".pdf" and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large. Max 100 MB.")

    info = get_pdf_info(pdf_bytes)
    if info.get("error") and info.get("page_count", 0) == 0:
        raise HTTPException(status_code=422, detail=info["error"])

    return PDFInfo(
        page_count=info.get("page_count", 0),
        has_digital_text=info.get("has_digital_text", False),
        error=info.get("error"),
    )


@app.post("/pdf/page", response_model=PageResult)
async def ocr_pdf_page(
    file: UploadFile = File(...),
    page: int = Form(1),         # 1-based page number
    lang: str = Form("tam+eng"),
    enhance: bool = Form(True),
    use_digital_text: bool = Form(True),
):
    """Process a single page of an uploaded PDF."""
    ext = Path(file.filename or "").suffix.lower()
    ct = file.content_type or ""
    if ext != ".pdf" and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")
    if not _VALID_LANG.match(lang):
        raise HTTPException(status_code=400, detail="Invalid lang.")
    if page < 1:
        raise HTTPException(status_code=400, detail="Page number must be ≥ 1.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large. Max 100 MB.")

    # Validate page count
    info = get_pdf_info(pdf_bytes)
    page_count = info.get("page_count", 0)
    if page > page_count:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page} doesn't exist. PDF has {page_count} pages."
        )

    logger.info(f"PDF page OCR: page={page}/{page_count}  lang={lang}  enhance={enhance}")

    result = process_pdf_page(
        pdf_bytes,
        page_index=page - 1,
        lang=lang,
        enhance=enhance,
        use_digital_text=use_digital_text,
    )
    return _make_page_result(result)


@app.post("/pdf/pages", response_model=List[PageResult])
async def ocr_pdf_pages(
    file: UploadFile = File(...),
    pages: str = Form("all"),
    lang: str = Form("tam+eng"),
    enhance: bool = Form(True),
    use_digital_text: bool = Form(True),
):
    """
    Process up to 50 PDF pages synchronously (for small batches / single page).
    For larger selections use /pdf/stream which streams results page-by-page.
    """
    ext = Path(file.filename or "").suffix.lower()
    ct = file.content_type or ""
    if ext != ".pdf" and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")
    if not _VALID_LANG.match(lang):
        raise HTTPException(status_code=400, detail="Invalid lang.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large. Max 100 MB.")

    info = get_pdf_info(pdf_bytes)
    if info.get("error") and info.get("page_count", 0) == 0:
        raise HTTPException(status_code=422, detail=f"Invalid PDF: {info['error']}")

    total_pages = info["page_count"]
    page_indices = _parse_pages(pages, total_pages)
    if not page_indices:
        raise HTTPException(status_code=400, detail="No valid pages selected.")
    # Hard cap for synchronous endpoint — use /pdf/stream for larger selections
    if len(page_indices) > 50:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This endpoint supports up to 50 pages. "
                f"You selected {len(page_indices)} pages. "
                "Use /pdf/stream for large selections."
            ),
        )

    logger.info(f"PDF batch OCR: {len(page_indices)}/{total_pages}  lang={lang}")

    results: List[PageResult] = []
    for idx in sorted(set(page_indices)):
        try:
            r = process_pdf_page(
                pdf_bytes, page_index=idx,
                lang=lang, enhance=enhance, use_digital_text=use_digital_text,
            )
        except Exception as e:
            logger.error(f"Page {idx+1} failed: {e}")
            r = {
                "success": False, "page_number": idx + 1,
                "raw_text": "", "cleaned_text": "", "tamil_text": "",
                "english_translation": None, "engine": "gemini",
                "engine_model": _current_model(), "language": lang,
                "source": "ocr", "error": str(e),
            }
        results.append(_make_page_result(r))
        if len(page_indices) > 1:
            await asyncio.sleep(1.0)

    return results


# ── SSE streaming endpoint (handles any number of pages) ─────────────────────
@app.post("/pdf/stream")
async def ocr_pdf_stream(
    file: UploadFile = File(...),
    pages: str = Form("all"),
    lang: str = Form("tam+eng"),
    enhance: bool = Form(True),
    use_digital_text: bool = Form(True),
    batch_size: int = Form(1),          # default 1: sequential processing prevents rate limits
    concurrency: int = Form(1),         # default 1: sequential calls to stay under 15 RPM
    delay: float = Form(2.5),           # inter-page delay in seconds (default 2.5s)
    skip_pages: str = Form(""),         # comma-separated page numbers to skip (already completed)
):
    """
    Stream PDF OCR results page-by-page using Server-Sent Events.

    Response is text/event-stream. Each event is a JSON object:
      {"type": "start",    "total": N, "pages": [...]}
      {"type": "progress", "page": P, "done": D, "total": N, "pct": X}
      {"type": "page",     "result": PageResult}
      {"type": "done",     "total": N, "failed": F, "completed": C}
      {"type": "error",    "message": "..."}

    Processes pages sequentially with a safe configurable delay between calls
    to reliably prevent Gemini free-tier 429 quota/rate-limit errors.
    Failures on individual pages do not interrupt processing of remaining pages.
    """
    ext = Path(file.filename or "").suffix.lower()
    ct  = file.content_type or ""
    if ext != ".pdf" and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")
    if not _VALID_LANG.match(lang):
        raise HTTPException(status_code=400, detail="Invalid lang.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large. Max 100 MB.")

    info = get_pdf_info(pdf_bytes)
    if info.get("error") and info.get("page_count", 0) == 0:
        raise HTTPException(status_code=422, detail=f"Invalid PDF: {info['error']}")

    total_pages = info["page_count"]
    page_indices = _parse_pages(pages, total_pages)
    if not page_indices:
        raise HTTPException(status_code=400, detail="No valid pages selected.")

    # Parse already completed pages to skip if resuming
    skip_set = set()
    if skip_pages.strip():
        for sp in skip_pages.split(","):
            try:
                n = int(sp.strip())
                if 1 <= n <= total_pages:
                    skip_set.add(n - 1)
            except ValueError:
                pass

    active_indices = [idx for idx in page_indices if idx not in skip_set]
    logger.info(
        f"PDF stream OCR: {len(active_indices)}/{total_pages} pages to process "
        f"({len(skip_set)} already completed/skipped) lang={lang} delay={delay}s"
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        import time as _time

        def _sse(obj: dict) -> str:
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

        total = len(page_indices)
        all_page_nums = [i + 1 for i in page_indices]
        yield _sse({
            "type": "start",
            "total": total,
            "pages": all_page_nums,
            "to_process": [i + 1 for i in active_indices],
        })

        current_delay = max(0.5, float(delay))
        done = len(skip_set)
        failed = 0
        _start_ts = _time.monotonic()
        _page_times: list = []

        def _timing_stats() -> dict:
            if not _page_times:
                return {"pages_per_min": None, "eta_secs": None}
            recent = _page_times[-5:]
            avg_s = sum(recent) / len(recent)
            ppm = round(60.0 / avg_s, 1) if avg_s > 0 else None
            remaining = total - done
            eta = round(remaining * avg_s) if avg_s > 0 else None
            return {"pages_per_min": ppm, "eta_secs": eta}

        loop = asyncio.get_event_loop()

        for step_i, idx in enumerate(active_indices):
            page_num = idx + 1
            pct = round(done / total * 100) if total else 0
            stats = _timing_stats()

            # Emit progress for current page
            yield _sse({
                "type": "progress",
                "page": page_num,
                "done": done,
                "total": total,
                "pct": pct,
                "pages_per_min": stats["pages_per_min"],
                "eta_secs": stats["eta_secs"],
                "delay_s": round(current_delay, 2),
            })

            page_switch_events = []

            def _on_switch(evt, _store=page_switch_events):
                _store.append(evt)

            page_ts = _time.monotonic()
            try:
                r = await loop.run_in_executor(
                    None,
                    lambda i=idx: process_pdf_page(
                        pdf_bytes, i, lang, enhance, use_digital_text,
                        on_model_switch=_on_switch,
                    ),
                )
            except Exception as exc:
                logger.error(f"[PDF_STREAM] Page {page_num} unexpected exception: {exc}")
                r = {
                    "success": False,
                    "status": "failed",
                    "needs_review": True,
                    "page_number": page_num,
                    "raw_text": "",
                    "cleaned_text": "",
                    "tamil_text": "",
                    "english_translation": None,
                    "engine": "gemini",
                    "engine_model": _current_model(),
                    "language": lang,
                    "source": "ocr",
                    "error": str(exc),
                    "error_category": "UNKNOWN",
                    "quota_exhausted": False,
                    "model_switched": False,
                    "final_model": _current_model(),
                }

            elapsed = _time.monotonic() - page_ts
            _page_times.append(elapsed)

            # Emit any model switch events
            for sw in page_switch_events:
                yield _sse({
                    "type": "model_switch",
                    "page": page_num,
                    "from_model": sw.from_model,
                    "to_model": sw.to_model,
                    "reason": sw.reason,
                })

            page_result = _make_page_result(r)
            if page_result.success:
                done += 1
                # Recover delay gradually towards base delay
                current_delay = max(float(delay), current_delay * 0.9)
            else:
                failed += 1
                if page_result.error_category == "RATE_LIMIT":
                    current_delay = min(current_delay * 1.5, 12.0)
                    logger.warning(f"Rate limit on page {page_num}; increased delay to {current_delay:.1f}s")

            stats = _timing_stats()
            result_dump = page_result.model_dump()
            result_dump["elapsed_ms"] = round(elapsed * 1000)

            # Yield page result immediately
            yield _sse({
                "type": "page",
                "result": result_dump,
                "pages_per_min": stats["pages_per_min"],
                "eta_secs": stats["eta_secs"],
            })

            # Permanent failure: only stop if API key is invalid
            if page_result.error_category == "INVALID_KEY":
                logger.error(f"Stopping stream due to INVALID_KEY on page {page_num}")
                yield _sse({
                    "type": "error",
                    "message": "API key rejected. Stopping PDF processing.",
                })
                break

            # Safe inter-page pause to maintain safe request pacing
            if step_i + 1 < len(active_indices):
                await asyncio.sleep(current_delay)

        total_elapsed = round(_time.monotonic() - _start_ts, 1)
        stats = _timing_stats()
        yield _sse({
            "type": "done",
            "total": total,
            "failed": failed,
            "completed": done,
            "elapsed_s": total_elapsed,
            "pages_per_min": stats["pages_per_min"],
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Retry specific failed pages ───────────────────────────────────────────────
@app.post("/pdf/retry")
async def ocr_pdf_retry(
    file: UploadFile = File(...),
    failed_pages: str = Form(...),   # comma-separated page numbers, e.g. "3,7,12"
    lang: str = Form("tam+eng"),
    enhance: bool = Form(True),
    use_digital_text: bool = Form(True),
    delay: float = Form(2.5),
):
    """
    Stream retries for specific failed pages with paced requests.
    failed_pages: comma-separated 1-based page numbers.
    """
    ext = Path(file.filename or "").suffix.lower()
    ct  = file.content_type or ""
    if ext != ".pdf" and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    info = get_pdf_info(pdf_bytes)
    total_pages = info.get("page_count", 0)

    # Parse failed_pages (1-based, comma separated or JSON array)
    retry_indices = []
    clean_str = failed_pages.strip().lstrip("[").rstrip("]")
    for p in clean_str.split(","):
        try:
            p_clean = p.strip().strip("\"'")
            if not p_clean:
                continue
            n = int(p_clean)
            if 1 <= n <= total_pages:
                retry_indices.append(n - 1)
        except ValueError:
            pass

    retry_indices = sorted(set(retry_indices))
    if not retry_indices:
        raise HTTPException(status_code=400, detail="No valid page numbers to retry.")

    logger.info(f"PDF retry: {len(retry_indices)} pages  lang={lang}")

    async def retry_stream() -> AsyncGenerator[str, None]:
        def _sse(obj: dict) -> str:
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

        total = len(retry_indices)
        yield _sse({
            "type": "start",
            "total": total,
            "pages": [i + 1 for i in retry_indices],
        })

        done = 0
        failed = 0
        loop = asyncio.get_event_loop()

        for step_i, idx in enumerate(retry_indices):
            page_num = idx + 1
            pct = round(done / total * 100) if total else 0
            yield _sse({
                "type": "progress",
                "page": page_num,
                "done": done,
                "total": total,
                "pct": pct,
            })

            try:
                r = await loop.run_in_executor(
                    None,
                    lambda i=idx: process_pdf_page(
                        pdf_bytes, i, lang, enhance, use_digital_text,
                    ),
                )
            except Exception as exc:
                r = {
                    "success": False,
                    "status": "failed",
                    "needs_review": True,
                    "page_number": page_num,
                    "raw_text": "",
                    "cleaned_text": "",
                    "tamil_text": "",
                    "english_translation": None,
                    "engine": "gemini",
                    "engine_model": _current_model(),
                    "language": lang,
                    "source": "ocr",
                    "error": str(exc),
                    "error_category": "UNKNOWN",
                }

            pr = _make_page_result(r)
            if pr.success:
                done += 1
            else:
                failed += 1

            yield _sse({"type": "page", "result": pr.model_dump()})

            if step_i + 1 < len(retry_indices):
                await asyncio.sleep(max(1.0, float(delay)))

        yield _sse({"type": "done", "total": total, "failed": failed, "completed": done})

    return StreamingResponse(
        retry_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/languages")
def available_languages():
    return {
        "engine": "gemini",
        "languages": [
            {"code": "tam+eng",     "label": "Tamil + English",          "description": "Extract Tamil text and provide English translation"},
            {"code": "tam",         "label": "Tamil only",               "description": "Extract Tamil text faithfully, no translation"},
            {"code": "eng",         "label": "English only",             "description": "Translate Tamil text to English"},
            {"code": "tam+eng+hin", "label": "Tamil + English + Hindi",  "description": "Extract Tamil text and provide English and Hindi translations"},
            {"code": "tam+hin",     "label": "Tamil + Hindi",            "description": "Extract Tamil text and provide Hindi translation"},
        ],
    }


# ── Page range parser ─────────────────────────────────────────────────────────
def _parse_pages(pages_str: str, total: int) -> list[int]:
    """Parse 'all', '1,3,5-8' into list of 0-based indices."""
    if pages_str.strip().lower() == "all":
        return list(range(total))
    indices = []
    for part in pages_str.split(","):
        part = part.strip()
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                start = max(1, int(a.strip()))
                end = min(total, int(b.strip()))
                indices.extend(range(start - 1, end))
            except ValueError:
                pass
        else:
            try:
                n = int(part)
                if 1 <= n <= total:
                    indices.append(n - 1)
            except ValueError:
                pass
    return sorted(set(indices))


# ── PDF Export Endpoint ──────────────────────────────────────────────────────
class ExportPageItem(BaseModel):
    page_number: int
    tamil_text: Optional[str] = ""
    english_translation: Optional[str] = None
    hindi_translation: Optional[str] = None
    suggested_corrections: Optional[str] = None
    status: Optional[str] = "completed"
    confidence_score: Optional[int] = None
    source: Optional[str] = "ocr"


class PDFExportRequest(BaseModel):
    title: Optional[str] = "TamilVault AI Export"
    pages: List[ExportPageItem]
    include_tamil: bool = True
    include_translation: bool = True
    include_hindi: bool = False
    include_notes: bool = True


@app.post("/export/pdf")
async def export_document_pdf(req: PDFExportRequest):
    """
    Export OCR document pages as an archival PDF with native Tamil and Hindi Unicode font support.
    """
    if not req.pages:
        raise HTTPException(status_code=400, detail="No pages provided for PDF export.")

    try:
        pages_dict = [p.model_dump() for p in req.pages]
        # Sort pages strictly by page_number
        pages_dict.sort(key=lambda x: x.get("page_number", 0))

        pdf_bytes = generate_document_pdf(
            title=req.title or "TamilVault AI Export",
            pages=pages_dict,
            include_tamil=req.include_tamil,
            include_translation=req.include_translation,
            include_hindi=req.include_hindi,
            include_notes=req.include_notes,
        )

        safe_title = re.sub(r"[^\w\-_\. ]", "_", req.title or "tamilvault_export").strip()
        filename = f"{safe_title}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    except Exception as exc:
        logger.error(f"PDF export failed: {exc}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}")


# ── Dev entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("main:app", host=host, port=port, reload=True)
