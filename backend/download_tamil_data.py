"""
Download Tamil trained data for Tesseract directly from tessdata_best.
Run this AFTER Tesseract is installed.
"""
import urllib.request
import os
import sys

TESSDATA_DIRS = [
    r"C:\Program Files\Tesseract-OCR\tessdata",
    r"C:\Program Files (x86)\Tesseract-OCR\tessdata",
]

TAM_URL = "https://github.com/tesseract-ocr/tessdata_best/raw/main/tam.traineddata"

def find_tessdata():
    for d in TESSDATA_DIRS:
        if os.path.isdir(d):
            return d
    return None

def download_tamil_data(tessdata_dir):
    out_path = os.path.join(tessdata_dir, "tam.traineddata")
    if os.path.exists(out_path):
        print(f"Tamil data already present: {out_path}")
        return True
    print(f"Downloading Tamil trained data to {out_path} ...")
    try:
        urllib.request.urlretrieve(TAM_URL, out_path)
        print("Download complete!")
        return True
    except Exception as e:
        print(f"ERROR downloading Tamil data: {e}")
        print(f"Please manually download from:\n  {TAM_URL}")
        print(f"And place it in: {tessdata_dir}")
        return False

if __name__ == "__main__":
    tessdata = find_tessdata()
    if not tessdata:
        print("ERROR: Could not find Tesseract tessdata directory.")
        print("Make sure Tesseract is installed first.")
        sys.exit(1)
    print(f"Found tessdata at: {tessdata}")
    download_tamil_data(tessdata)
    
    # List available languages
    print("\nInstalled languages:")
    for f in os.listdir(tessdata):
        if f.endswith(".traineddata"):
            print(f"  {f.replace('.traineddata','')}")
