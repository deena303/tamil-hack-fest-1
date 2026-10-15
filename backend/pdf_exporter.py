"""
PDF Exporter for TamilVault AI.
Renders OCR extractions, English translations, and scholarly notes
into an archival-grade PDF with native Tamil Unicode font support.
"""
from __future__ import annotations

import datetime
import io
import logging
import os
from typing import List, Optional

logger = logging.getLogger(__name__)

try:
    import pymupdf
    FITZ_AVAILABLE = True
except ImportError:
    try:
        import fitz as pymupdf
        FITZ_AVAILABLE = True
    except ImportError:
        FITZ_AVAILABLE = False


def find_tamil_font_path() -> Optional[str]:
    """Find the best available TrueType/OpenType font supporting Tamil Unicode."""
    candidates = [
        # Windows standard fonts
        "C:/Windows/Fonts/latha.ttf",
        "C:/Windows/Fonts/lathab.ttf",
        "C:/Windows/Fonts/Nirmala.ttc",
        "C:/Windows/Fonts/vijaya.ttf",
        # Linux standard fonts
        "/usr/share/fonts/truetype/lohit-tamil/Lohit-Tamil.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansTamil-Regular.otf",
        "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
        # Mac standard fonts
        "/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc",
        "/Library/Fonts/NotoSansTamil-Regular.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            logger.info(f"Selected Tamil font: {c}")
            return c
    return None


def find_hindi_font_path() -> Optional[str]:
    """Find the best available TrueType/OpenType font supporting Devanagari/Hindi Unicode."""
    candidates = [
        # Windows standard fonts
        "C:/Windows/Fonts/mangal.ttf",
        "C:/Windows/Fonts/mangalb.ttf",
        "C:/Windows/Fonts/aparaj.ttf",
        "C:/Windows/Fonts/Nirmala.ttc",
        # Linux standard fonts
        "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
        # Mac standard fonts
        "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
        "/Library/Fonts/NotoSansDevanagari-Regular.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            logger.info(f"Selected Hindi font: {c}")
            return c
    return None


def generate_document_pdf(
    title: str,
    pages: List[dict],
    include_tamil: bool = True,
    include_translation: bool = True,
    include_notes: bool = True,
    include_hindi: bool = False,
) -> bytes:
    """
    Generate an archival PDF document from OCR page results.
    Preserves page order, Tamil Unicode text, status markers, and translations.
    """
    if not FITZ_AVAILABLE:
        raise RuntimeError("PyMuPDF is not installed. PDF generation unavailable.")

    font_path = find_tamil_font_path()
    font_name = "tamil_font" if font_path else "helv"

    hindi_font_path = find_hindi_font_path()
    hindi_font_name = "hindi_font" if hindi_font_path else font_name

    doc = pymupdf.open()
    total_pages = len(pages)
    current_time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    for idx, p in enumerate(pages):
        page_num = p.get("page_number", idx + 1)
        status = (p.get("status") or "completed").upper()
        confidence = p.get("confidence_score")
        source = p.get("source") or "ocr"
        tamil_text = (p.get("tamil_text") or p.get("cleaned_text") or "").strip()
        english_trans = (p.get("english_translation") or "").strip()
        hindi_trans = (p.get("hindi_translation") or "").strip()
        notes = (p.get("suggested_corrections") or "").strip()

        pdf_page = doc.new_page(width=595, height=842)  # Standard A4 (points)

        # Register Tamil font if available
        if font_path:
            try:
                pdf_page.insert_font(fontname="tamil_font", fontfile=font_path)
            except Exception as e:
                logger.warning(f"Could not register font {font_path}: {e}")

        # Register Hindi font if available and distinct
        if hindi_font_path and hindi_font_path != font_path:
            try:
                pdf_page.insert_font(fontname="hindi_font", fontfile=hindi_font_path)
            except Exception as e:
                logger.warning(f"Could not register hindi font {hindi_font_path}: {e}")

        # Page margins
        margin_x = 45
        content_width = 505
        y = 45

        # ── Header ──
        # Document Title
        pdf_page.draw_rect(
            pymupdf.Rect(margin_x, y, margin_x + content_width, y + 24),
            color=None,
            fill=(0.95, 0.95, 0.97),
        )
        pdf_page.insert_text(
            (margin_x + 8, y + 16),
            f"TamilVault AI — {title}",
            fontsize=11,
            color=(0.15, 0.15, 0.25),
        )
        pdf_page.insert_text(
            (margin_x + content_width - 120, y + 16),
            current_time_str,
            fontsize=8,
            color=(0.4, 0.4, 0.5),
        )
        y += 34

        # ── Page Section Banner ──
        # Status color
        if status == "COMPLETED":
            badge_color = (0.06, 0.65, 0.45)  # green
        elif status == "NEEDS_REVIEW":
            badge_color = (0.85, 0.55, 0.05)  # amber
        else:
            badge_color = (0.85, 0.25, 0.25)  # red

        banner_text = f"PAGE {page_num} of {total_pages}   ·   STATUS: {status}"
        if confidence is not None:
            banner_text += f"   ·   CONFIDENCE: {confidence}%"
        if source == "digital":
            banner_text += "   ·   SOURCE: Digital Text Layer"
        else:
            banner_text += "   ·   SOURCE: Gemini Vision OCR"

        pdf_page.draw_line(
            (margin_x, y),
            (margin_x + content_width, y),
            color=badge_color,
            width=2,
        )
        y += 14

        pdf_page.insert_text(
            (margin_x, y),
            banner_text,
            fontsize=9,
            color=(0.2, 0.2, 0.3),
        )
        y += 18

        # ── Content Blocks ──
        # 1. Original Tamil Text
        if include_tamil and tamil_text:
            pdf_page.insert_text(
                (margin_x, y),
                "ORIGINAL TAMIL TRANSCRIPTION (தமிழ் மூல உரை):",
                fontname=font_name,
                fontsize=9.5,
                color=(0.1, 0.2, 0.5),
            )
            y += 14

            rect_tamil = pymupdf.Rect(margin_x, y, margin_x + content_width, min(y + 240, 770))
            rem = pdf_page.insert_textbox(
                rect_tamil,
                tamil_text,
                fontname=font_name,
                fontsize=10,
                color=(0.1, 0.1, 0.1),
                lineheight=1.35,
            )
            if rem >= 0:
                used_h = rect_tamil.height - rem
                y += used_h + 14
            else:
                y += rect_tamil.height + 14

        # 2. Suggested Corrections / Scholarly Notes
        if include_notes and notes and y < 650:
            pdf_page.insert_text(
                (margin_x, y),
                "SCHOLARLY NOTES & SUGGESTED READINGS (ஆய்வுக் குறிப்புகள்):",
                fontname=font_name,
                fontsize=9,
                color=(0.6, 0.35, 0.05),
            )
            y += 12
            rect_notes = pymupdf.Rect(margin_x, y, margin_x + content_width, min(y + 100, 770))
            rem = pdf_page.insert_textbox(
                rect_notes,
                notes,
                fontname=font_name,
                fontsize=8.5,
                color=(0.2, 0.2, 0.2),
            )
            if rem >= 0:
                y += (rect_notes.height - rem) + 12
            else:
                y += rect_notes.height + 12

        # 3. English Translation
        if include_translation and english_trans and y < 700:
            pdf_page.insert_text(
                (margin_x, y),
                "FAITHFUL ENGLISH TRANSLATION:",
                fontsize=9.5,
                color=(0.1, 0.45, 0.25),
            )
            y += 14
            rect_trans = pymupdf.Rect(margin_x, y, margin_x + content_width, min(y + (120 if (include_hindi and hindi_trans) else 200), 770))
            rem = pdf_page.insert_textbox(
                rect_trans,
                english_trans,
                fontname="helv",
                fontsize=9,
                color=(0.1, 0.1, 0.1),
                lineheight=1.3,
            )
            if rem >= 0:
                y += (rect_trans.height - rem) + 12
            else:
                y += rect_trans.height + 12

        # 4. Hindi Translation
        if include_hindi and hindi_trans and y < 740:
            pdf_page.insert_text(
                (margin_x, y),
                "FAITHFUL HINDI TRANSLATION (हिन्दी अनुवाद):",
                fontname=hindi_font_name,
                fontsize=9.5,
                color=(0.65, 0.25, 0.05),
            )
            y += 14
            rect_hin = pymupdf.Rect(margin_x, y, margin_x + content_width, 770)
            pdf_page.insert_textbox(
                rect_hin,
                hindi_trans,
                fontname=hindi_font_name,
                fontsize=9,
                color=(0.1, 0.1, 0.1),
                lineheight=1.3,
            )

        # ── Footer ──
        pdf_page.draw_line(
            (margin_x, 795),
            (margin_x + content_width, 795),
            color=(0.85, 0.85, 0.85),
            width=0.75,
        )
        pdf_page.insert_text(
            (margin_x, 808),
            "TamilVault AI — Historical Tamil OCR & Epigraphical Transcription Engine",
            fontsize=7.5,
            color=(0.5, 0.5, 0.5),
        )
        pdf_page.insert_text(
            (margin_x + content_width - 70, 808),
            f"Page {page_num} / {total_pages}",
            fontsize=8,
            color=(0.4, 0.4, 0.4),
        )

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes
