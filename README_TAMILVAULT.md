# தரவு — TamilVault AI OCR Engine (Gemini Edition)

Tamil OCR powered by **Google Gemini Vision**. No Tesseract installation required.

**Frontend**: React + Vite (TypeScript) → http://localhost:5173  
**Backend**: FastAPI + Gemini Vision API → http://localhost:8000

---

## Quick Start

### Step 1 — Get a free Gemini API key

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key

### Step 2 — Add the key to the backend

Open `backend/.env` and paste your key:
```ini
GEMINI_API_KEY=AIzaSy...your_key_here...
GEMINI_MODEL=gemini-2.0-flash
```

### Step 3 — Install Python dependencies (first time only)

```powershell
# From the project root:
.venv\Scripts\pip install -r backend\requirements.txt
```

### Step 4 — Start the backend (Terminal 1)

```powershell
cd backend
..\. venv\Scripts\activate
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Or use the one-click script from the project root:
```powershell
.\start_backend.bat
```

### Step 5 — Start the frontend (Terminal 2)

```powershell
cd frontend
npm run dev
```

Or use the one-click script:
```powershell
.\start_frontend.bat
```

The app opens at **http://localhost:5173**.

---

## Using the application

1. The **status chip** in the top-right shows `✦ Gemini gemini-2.0-flash` when ready.  
   If it shows `API key not set`, check `backend/.env`.
2. **Upload** a JPEG, PNG, TIFF, or BMP image of Tamil text.
3. Select a **language**: Tamil + English / Tamil only / English only.
4. Click **✨ Extract Text**.
5. Review the result across the four tabs:

| Tab | What it shows |
|---|---|
| **OCR Text** | Editable transcription returned by Gemini |
| **Confidence** | Explains that per-word scores are unavailable; highlights `[unclear]` markers |
| **Review** | Lists every `[unclear]` section for manual correction |
| **Export** | Download as `.txt`, `.json`, or raw OCR output |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** | — | Your Google AI Studio key |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model to use |
| `HOST` | No | `0.0.0.0` | Backend bind address |
| `PORT` | No | `8000` | Backend port |

---

## Diagnostics

```powershell
# Check backend health
Invoke-RestMethod http://localhost:8000/status | ConvertTo-Json
```

### Common problems

| Symptom | Fix |
|---|---|
| Status chip: `API key not set` | Add `GEMINI_API_KEY=...` to `backend/.env` and restart the backend |
| Status chip: `Gemini SDK missing` | Run `.venv\Scripts\pip install google-genai` |
| Status chip: `Backend offline` | Start the backend (Step 4 above) |
| OCR error: "Invalid GEMINI_API_KEY" | Verify the key at https://aistudio.google.com — check for extra spaces |
| OCR error: "quota exceeded" | Free tier has per-minute limits; wait 60 s and retry |
| OCR error: "model not found" | Update `GEMINI_MODEL` in `backend/.env` to `gemini-2.0-flash` or `gemini-1.5-flash` |
| TIFF/BMP image not processed | These are auto-converted to PNG before sending to Gemini — should work transparently |

---

## Project structure

```
.
├── backend/
│   ├── main.py            # FastAPI app + routes
│   ├── ocr_engine.py      # Gemini Vision OCR pipeline
│   ├── requirements.txt   # Python dependencies
│   ├── .env               # Your secrets (never commit this)
│   └── .env.example       # Template
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Main UI (all four tabs)
│   │   ├── api.ts         # Backend API client
│   │   └── index.css      # Styles (dark theme)
│   └── .env               # VITE_API_URL=http://localhost:8000
├── start_backend.bat      # One-click backend start
├── start_frontend.bat     # One-click frontend start
├── .gitignore             # Excludes backend/.env and node_modules
└── Scan 16-19.tiff        # Sample Tamil scans for testing
```

---

## How OCR works

1. User uploads image → frontend sends it as `multipart/form-data` to `POST /ocr`
2. Backend validates format and size (max 20 MB)
3. TIFF/BMP images are converted to PNG via PIL (Gemini requires JPEG/PNG/WebP)
4. The image + the Tamil transcription prompt is sent to Gemini Vision
5. Gemini returns the transcription; unreadable sections are marked `[unclear]`
6. Raw transcription is stored separately; no automatic AI rewriting is applied
7. User can edit, correct `[unclear]` sections, and export the final text

**Hallucination prevention**: The OCR prompt explicitly forbids translation, paraphrasing, context-completion, and invention. The raw response is preserved unchanged so reviewers can verify it against the original image.
