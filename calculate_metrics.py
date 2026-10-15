"""
Calculate Character Error Rate (CER), Word Error Rate (WER),
and Recognition Accuracy (%) between:
1. Ground Truth (manual.txt)
2. Baseline Online OCR (ocr_out.txt)
3. Proposed Tesseract OCR (from notebook evaluation)
4. TamilVault AI (Gemini Vision)
"""
import json
import re
import sys
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

def clean_tamil(s: str) -> str:
    if not s:
        return ""
    # Strip invisible Unicode control markers
    s = s.replace("\ufeff", "").replace("\u200c", "").replace("\u200d", "").replace("\u200e", "")
    # Normalize punctuation and spacing
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n", "\n", s)
    return s.strip()

def levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            ins = prev[j + 1] + 1
            dele = curr[j] + 1
            sub = prev[j] + (c1 != c2)
            curr.append(min(ins, dele, sub))
        prev = curr
    return prev[-1]

def calculate_cer_wer(ref: str, hyp: str):
    ref_clean = clean_tamil(ref)
    hyp_clean = clean_tamil(hyp)

    # Character-level Levenshtein
    char_dist = levenshtein(ref_clean, hyp_clean)
    ref_char_len = max(len(ref_clean), 1)
    cer = (char_dist / ref_char_len) * 100.0
    char_acc = max(0.0, 100.0 - cer)

    # Word-level Levenshtein
    ref_words = ref_clean.split()
    hyp_words = hyp_clean.split()

    # Levenshtein on words
    def word_dist(w1, w2):
        if len(w1) < len(w2):
            return word_dist(w2, w1)
        if len(w2) == 0:
            return len(w1)
        prev = range(len(w2) + 1)
        for i, word1 in enumerate(w1):
            curr = [i + 1]
            for j, word2 in enumerate(w2):
                ins = prev[j + 1] + 1
                dele = curr[j] + 1
                sub = prev[j] + (word1 != word2)
                curr.append(min(ins, dele, sub))
            prev = curr
        return prev[-1]

    w_dist = word_dist(ref_words, hyp_words)
    ref_w_len = max(len(ref_words), 1)
    wer = (w_dist / ref_w_len) * 100.0
    word_acc = max(0.0, 100.0 - wer)

    return {
        "char_distance": char_dist,
        "ref_chars": ref_char_len,
        "hyp_chars": len(hyp_clean),
        "cer": round(cer, 2),
        "char_accuracy": round(char_acc, 2),
        "word_distance": w_dist,
        "ref_words": ref_w_len,
        "hyp_words": len(hyp_words),
        "wer": round(wer, 2),
        "word_accuracy": round(word_acc, 2),
    }

def main():
    print("==================================================================")
    print("TAMILVAULT AI — ACCURACY AND CER BENCHMARK REPORT")
    print("==================================================================\n")

    with open("manual.txt", "r", encoding="utf-8") as f:
        manual_gt = f.read()

    with open("ocr_out.txt", "r", encoding="utf-8") as f:
        baseline_ocr = f.read()

    # 1. Baseline Online OCR
    m_base = calculate_cer_wer(manual_gt, baseline_ocr)
    print("1. BASELINE ONLINE OCR (Tesseract / Online OCR):")
    print(f"   - Character Error Rate (CER) : {m_base['cer']}%")
    print(f"   - Character Accuracy         : {m_base['char_accuracy']}%")
    print(f"   - Word Error Rate (WER)      : {m_base['wer']}%")
    print(f"   - Word Accuracy              : {m_base['word_accuracy']}%")
    print(f"   - Total Characters (GT / OCR): {m_base['ref_chars']} / {m_base['hyp_chars']}")
    print(f"   - Levenshtein Distance       : {m_base['char_distance']} chars\n")

    # 2. Previous Notebook Proposed Tesseract OCR
    # Recorded in tesseract_ocr_final-review.ipynb:
    # CER = 1.90%, Accuracy = 98.10%, Levenshtein Distance = 79, Cosine Similarity = 98.6%
    print("2. PREVIOUS REPOSITORY TESSERACT MODEL (from project evaluation):")
    print(f"   - Character Error Rate (CER) : 1.90%")
    print(f"   - Character Accuracy         : 98.10%")
    print(f"   - Cosine Similarity          : 98.60%")
    print(f"   - Levenshtein Distance       : 79 chars\n")

    # 3. Current TamilVault AI (Gemini Vision)
    print("3. CURRENT TAMILVAULT AI (Gemini Vision Engine):")
    # Call backend
    r = requests.post(
        "http://127.0.0.1:8001/ocr",
        files={"file": ("Scan 17.tiff", open("Scan 17.tiff", "rb"), "image/tiff")},
        data={"language": "tam", "enhance": "true"}
    )
    res = r.json()
    gemini_tamil = res.get("tamil_text", "")

    # Save to file for comparison
    with open("gemini_scan17_out.txt", "w", encoding="utf-8") as f_out:
        f_out.write(gemini_tamil)

    m_gemini = calculate_cer_wer(manual_gt, gemini_tamil)
    print(f"   - Character Error Rate (CER) : {m_gemini['cer']}%")
    print(f"   - Character Accuracy         : {m_gemini['char_accuracy']}%")
    print(f"   - Word Error Rate (WER)      : {m_gemini['wer']}%")
    print(f"   - Word Accuracy              : {m_gemini['word_accuracy']}%")
    print(f"   - Total Characters (GT / OCR): {m_gemini['ref_chars']} / {m_gemini['hyp_chars']}")
    print(f"   - Model Confidence Score     : {res.get('confidence_score')}%")
    print(f"   - Model Used                 : {res.get('engine_model')}\n")

    # Save metrics JSON
    summary = {
        "benchmark_sample": "Scan 17.tiff (Abithana Chintamani historical book page)",
        "ground_truth_file": "manual.txt",
        "ground_truth_characters": m_base["ref_chars"],
        "baseline_online_ocr": m_base,
        "previous_tesseract_ocr": {
            "cer": 1.90,
            "char_accuracy": 98.10,
            "cosine_similarity": 98.60,
            "levenshtein_distance": 79
        },
        "tamilvault_ai_gemini": m_gemini,
    }
    with open("accuracy_benchmark.json", "w", encoding="utf-8") as f_json:
        json.dump(summary, f_json, indent=2, ensure_ascii=False)
    print("Benchmark saved to accuracy_benchmark.json")

if __name__ == "__main__":
    main()
