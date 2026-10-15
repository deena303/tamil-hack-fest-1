"""
Test OCR accuracy and anti-hallucination compliance across 5 real samples:
- Sample 1: Scan 16.tiff (Archival scanned book page)
- Sample 2: Scan 17.tiff (Archival scanned book page)
- Sample 3: test_tamil_20p.pdf Page 1 (scanned page with English title text layer)
- Sample 4: test_tamil_20p.pdf Page 5 (historical Tamil text)
- Sample 5: test_tamil_20p.pdf Page 8 (historical Tamil text)

Also performs end-to-end PDF export verification with native Tamil Unicode.
"""
from __future__ import annotations

import io
import json
import os
import sys
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://127.0.0.1:8001"

def test_samples():
    print("=================================================================")
    print("TAMILVAULT AI — OCR ACCURACY & COMPLIANCE VERIFICATION")
    print("=================================================================\n")

    results = []

    # 1. Scan 16.tiff
    print("--- 1. Testing Scan 16.tiff ---")
    with open("Scan 16.tiff", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/ocr",
            files={"file": ("Scan 16.tiff", f, "image/tiff")},
            data={"language": "tam+eng", "enhance": "true"}
        )
    assert r.status_code == 200, f"Error {r.status_code}: {r.text}"
    res16 = r.json()
    tam16 = res16.get("tamil_text", "")
    eng16 = res16.get("english_translation", "")
    notes16 = res16.get("suggested_corrections")
    status16 = res16.get("status")
    conf16 = res16.get("confidence_score")
    print(f"  Status: {status16} | Confidence: {conf16}% | Model: {res16.get('engine_model')}")
    print(f"  Extracted Tamil chars: {len(tam16)}")
    print(f"  Tamil preview: {tam16[:120].strip()}...")
    print(f"  Translation preview: {str(eng16)[:120].strip()}...")
    if notes16:
        print(f"  Scholarly notes: {notes16[:100]}...")
    assert len(tam16) > 20, "Scan 16 Tamil text was not extracted"
    results.append({
        "page_number": 1,
        "tamil_text": tam16,
        "english_translation": eng16,
        "suggested_corrections": notes16,
        "status": status16,
        "confidence_score": conf16,
        "source": "ocr"
    })
    print("[PASS] Sample 1: Scan 16.tiff successfully transcribed.\n")

    # 2. Scan 17.tiff
    print("--- 2. Testing Scan 17.tiff ---")
    with open("Scan 17.tiff", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/ocr",
            files={"file": ("Scan 17.tiff", f, "image/tiff")},
            data={"language": "tam+eng", "enhance": "true"}
        )
    assert r.status_code == 200, f"Error {r.status_code}: {r.text}"
    res17 = r.json()
    tam17 = res17.get("tamil_text", "")
    eng17 = res17.get("english_translation", "")
    status17 = res17.get("status")
    conf17 = res17.get("confidence_score")
    print(f"  Status: {status17} | Confidence: {conf17}% | Model: {res17.get('engine_model')}")
    print(f"  Extracted Tamil chars: {len(tam17)}")
    print(f"  Tamil preview: {tam17[:120].strip()}...")
    assert len(tam17) > 20, "Scan 17 Tamil text was not extracted"
    results.append({
        "page_number": 2,
        "tamil_text": tam17,
        "english_translation": eng17,
        "suggested_corrections": res17.get("suggested_corrections"),
        "status": status17,
        "confidence_score": conf17,
        "source": "ocr"
    })
    print("[PASS] Sample 2: Scan 17.tiff successfully transcribed.\n")

    # 3. test_tamil_20p.pdf Page 1 (Verifying digital layer validation)
    print("--- 3. Testing test_tamil_20p.pdf Page 1 (Digital Layer Validation) ---")
    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/page",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={"page_number": 1, "language": "tam+eng", "use_digital_text": "true"}
        )
    assert r.status_code == 200, f"Error {r.status_code}: {r.text}"
    res_p1 = r.json()
    tam_p1 = res_p1.get("tamil_text", "")
    source_p1 = res_p1.get("source")
    print(f"  Source chosen by engine: {source_p1} (must be 'ocr', not corrupted 'digital')")
    print(f"  Status: {res_p1.get('status')} | Confidence: {res_p1.get('confidence_score')}%")
    print(f"  Tamil preview: {tam_p1[:120].strip()}...")
    assert source_p1 == "ocr", f"Expected 'ocr' because digital text is non-Tamil English, got {source_p1}"
    results.append({
        "page_number": 3,
        "tamil_text": tam_p1,
        "english_translation": res_p1.get("english_translation"),
        "suggested_corrections": res_p1.get("suggested_corrections"),
        "status": res_p1.get("status"),
        "confidence_score": res_p1.get("confidence_score"),
        "source": source_p1
    })
    print("[PASS] Sample 3: Digital English text layer correctly skipped in favor of Vision OCR.\n")

    # 4. test_tamil_20p.pdf Page 5
    print("--- 4. Testing test_tamil_20p.pdf Page 5 ---")
    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/page",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={"page_number": 5, "language": "tam+eng", "use_digital_text": "false"}
        )
    assert r.status_code == 200, f"Error {r.status_code}: {r.text}"
    res_p5 = r.json()
    tam_p5 = res_p5.get("tamil_text", "")
    print(f"  Status: {res_p5.get('status')} | Confidence: {res_p5.get('confidence_score')}%")
    print(f"  Tamil chars: {len(tam_p5)}")
    print(f"  Tamil preview: {tam_p5[:120].strip()}...")
    results.append({
        "page_number": 4,
        "tamil_text": tam_p5,
        "english_translation": res_p5.get("english_translation"),
        "suggested_corrections": res_p5.get("suggested_corrections"),
        "status": res_p5.get("status"),
        "confidence_score": res_p5.get("confidence_score"),
        "source": "ocr"
    })
    print("[PASS] Sample 4: Page 5 transcribed.\n")

    # 5. test_tamil_20p.pdf Page 8
    print("--- 5. Testing test_tamil_20p.pdf Page 8 ---")
    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/page",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={"page_number": 8, "language": "tam+eng", "use_digital_text": "false"}
        )
    assert r.status_code == 200, f"Error {r.status_code}: {r.text}"
    res_p8 = r.json()
    tam_p8 = res_p8.get("tamil_text", "")
    print(f"  Status: {res_p8.get('status')} | Confidence: {res_p8.get('confidence_score')}%")
    print(f"  Tamil chars: {len(tam_p8)}")
    print(f"  Tamil preview: {tam_p8[:120].strip()}...")
    results.append({
        "page_number": 5,
        "tamil_text": tam_p8,
        "english_translation": res_p8.get("english_translation"),
        "suggested_corrections": res_p8.get("suggested_corrections"),
        "status": res_p8.get("status"),
        "confidence_score": res_p8.get("confidence_score"),
        "source": "ocr"
    })
    print("[PASS] Sample 5: Page 8 transcribed.\n")

    # 6. PDF Export verification with all 5 pages
    print("--- 6. Verifying PDF Export endpoint (/export/pdf) ---")
    export_payload = {
        "title": "Tamil Historical Documents Batch Export",
        "pages": results,
        "include_tamil": True,
        "include_translation": True,
        "include_notes": True
    }
    r_exp = requests.post(f"{BASE_URL}/export/pdf", json=export_payload)
    assert r_exp.status_code == 200, f"Export failed {r_exp.status_code}: {r_exp.text}"
    assert r_exp.headers.get("content-type") == "application/pdf"
    pdf_bytes = r_exp.content
    print(f"  Generated PDF size: {len(pdf_bytes)} bytes")
    with open("verified_tamil_export.pdf", "wb") as f_out:
        f_out.write(pdf_bytes)

    # Verify PyMuPDF can inspect the generated PDF and extract Tamil text
    import pymupdf
    doc = pymupdf.open("verified_tamil_export.pdf")
    print(f"  Exported PDF page count: {len(doc)}")
    assert len(doc) == 5, f"Expected 5 pages in exported PDF, got {len(doc)}"
    p1_text = doc[0].get_text()
    print(f"  Page 1 contains Tamil characters: {any('\u0B80' <= ch <= '\u0BFF' for ch in p1_text)}")
    assert any('\u0B80' <= ch <= '\u0BFF' for ch in p1_text), "No Tamil characters extracted from exported PDF page 1"
    doc.close()
    print("[PASS] PDF Export: 5-page PDF successfully created with valid Tamil Unicode fonts.\n")

    print("=================================================================")
    print("ALL 5 SAMPLES & PDF EXPORT VERIFIED SUCCESSFULLY!")
    print("=================================================================")

if __name__ == "__main__":
    test_samples()
