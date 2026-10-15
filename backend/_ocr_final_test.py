import sys, io, requests
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

tiff = r"c:\Users\deena\Downloads\Optical-Character-Recognition-main\Optical-Character-Recognition-main\Scan 16.tiff"
out  = r"c:\Users\deena\Downloads\Optical-Character-Recognition-main\Optical-Character-Recognition-main\ocr_result.txt"

with open(tiff, "rb") as f:
    resp = requests.post(
        "http://localhost:8000/ocr",
        files={"file": ("Scan 16.tiff", f, "image/tiff")},
        data={"lang": "tam+eng"},
        timeout=120,
    )

print(f"HTTP {resp.status_code}")
r = resp.json()
success = r.get("success")
model   = r.get("engine_model")
error   = r.get("error")
print(f"success      : {success}")
print(f"engine_model : {model}")
print(f"error        : {error}")

txt = r.get("cleaned_text") or r.get("raw_text") or ""
print(f"chars        : {len(txt)}")

with open(out, "w", encoding="utf-8") as wf:
    wf.write(txt)
print(f"Saved to     : {out}")
print()
print("=== First 300 chars of extracted text ===")
print(txt[:300])
