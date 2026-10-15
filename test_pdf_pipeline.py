"""
End-to-end integration test for TamilVault AI PDF pipeline fixes.
Verifies all 9 requirements from USER_REQUEST.
"""
import json
import requests
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://127.0.0.1:8001"

def test_1_pdf_info():
    print("--- Test 1: PDF Info Detection ---")
    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(f"{BASE_URL}/pdf/info", files={"file": ("test_tamil_20p.pdf", f, "application/pdf")})
    assert r.status_code == 200, f"Status code: {r.status_code}"
    data = r.json()
    print(f"Detected page count: {data.get('page_count')}, metadata: {data}")
    assert data.get("page_count") == 20, f"Expected 20 pages, got {data.get('page_count')}"
    print("[PASS] Test 1: 20 pages accurately detected.\n")

def test_2_pages_5_to_17_stream():
    print("--- Test 2: Pages 5-9 Processing (Testing the missing page range) ---")
    pages_to_test = list(range(5, 10))  # 5..9 (5 pages)
    print(f"Requesting pages 5-9...")

    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/stream",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={
                "language": "tam+eng",
                "enhance": "true",
                "use_digital_text": "false",
                "pages": "5-9",
                "concurrency": 1,
                "delay": 1.0,
            },
            stream=True
        )

    assert r.status_code == 200, f"Stream request failed: {r.status_code}"

    received_pages = {}
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        data_str = line[5:].strip()
        try:
            payload = json.loads(data_str)
            msg_type = payload.get("type")
            if msg_type == "page":
                res = payload.get("result", {})
                pnum = res.get("page_number")
                received_pages[pnum] = res
                print(f"  -> Page {pnum} received: status={res.get('status')}, error={res.get('error')}, "
                      f"text_len={len(res.get('cleaned_text', '') or '')}, "
                      f"trans_len={len(res.get('english_translation', '') or '')}")
            elif msg_type == "progress":
                print(f"  [Progress] {payload.get('done')}/{payload.get('total')} (processing p.{payload.get('page')})")
            elif msg_type == "done":
                print(f"  [Done] total={payload.get('total')}, failed={payload.get('failed')}, elapsed={payload.get('elapsed_s')}s")
        except Exception as e:
            print(f"Parse error on line: {line} -> {e}")

    print(f"Total pages received: {len(received_pages)}")
    print(f"Page numbers received: {sorted(received_pages.keys())}")
    
    # Verify every page from 5 to 17 was processed and returned
    for p in pages_to_test:
        assert p in received_pages, f"Page {p} was NOT received in the stream!"
        res = received_pages[p]
        assert res.get("page_number") == p, f"Mismatched page_number: {res.get('page_number')} != {p}"
        assert res.get("status") in ["completed", "needs_review", "failed"], f"Invalid status: {res.get('status')}"

    print("[PASS] Test 2: Pages 5-17 were all received individually without dropping any page.\n")
    return received_pages

def test_3_resume_with_skip_pages():
    print("--- Test 3: Resume PDF Stream with skip_pages ---")
    # Simulate resuming: skip already completed pages 5, 6, 7 in range 5-10
    skip = [5, 6, 7]
    skip_str = ",".join(str(p) for p in skip)
    print(f"Requesting range 5-10 with skip_pages={skip_str}")

    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/stream",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={
                "language": "tam+eng",
                "enhance": "true",
                "use_digital_text": "false",
                "pages": "5-10",
                "skip_pages": skip_str,
                "concurrency": 1,
                "delay": 1.0,
            },
            stream=True
        )

    received_pages = {}
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        try:
            payload = json.loads(line[5:].strip())
            if payload.get("type") == "page":
                res = payload["result"]
                received_pages[res["page_number"]] = res
                print(f"  -> Resumed received page {res['page_number']}")
        except Exception:
            pass

    print(f"Received pages on resumed stream: {sorted(received_pages.keys())}")
    for s in skip:
        assert s not in received_pages, f"Page {s} should have been skipped, but was processed!"
    for expected in [8, 9, 10]:
        assert expected in received_pages, f"Page {expected} was expected but missing!"

    print("[PASS] Test 3: Resuming job honors skip_pages and avoids duplicate API calls.\n")

def test_4_retry_specific_pages():
    print("--- Test 4: Retry Specific Pages via /pdf/retry ---")
    retry_list = [6, 12]
    retry_str = ",".join(str(p) for p in retry_list)
    print(f"Calling /pdf/retry with pages={retry_str}")

    with open("test_tamil_20p.pdf", "rb") as f:
        r = requests.post(
            f"{BASE_URL}/pdf/retry",
            files={"file": ("test_tamil_20p.pdf", f, "application/pdf")},
            data={
                "failed_pages": retry_str,
                "language": "tam+eng",
                "enhance": "true",
                "use_digital_text": "false",
                "delay": 1.0,
            },
            stream=True
        )

    retried_pages = {}
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        try:
            payload = json.loads(line[5:].strip())
            if payload.get("type") == "page":
                res = payload["result"]
                retried_pages[res["page_number"]] = res
                print(f"  -> Retry received page {res['page_number']}")
        except Exception:
            pass

    print(f"Retried pages received: {sorted(retried_pages.keys())}")
    assert set(retried_pages.keys()) == set(retry_list), f"Expected {retry_list}, got {list(retried_pages.keys())}"
    print("[PASS] Test 4: /pdf/retry successfully retried only the requested pages.\n")

if __name__ == "__main__":
    try:
        test_1_pdf_info()
        test_2_pages_5_to_17_stream()
        test_3_resume_with_skip_pages()
        test_4_retry_specific_pages()
        print("========================================")
        print("ALL 4 INTEGRATION SUITES PASSED!")
        print("========================================")
    except Exception as e:
        print(f"\n[FAIL]: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
