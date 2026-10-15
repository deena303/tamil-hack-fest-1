# TamilVault AI — Supabase Database Integration & Setup Guide (Text-Only Persistence)

This document describes the database schema, security rules, environment configuration, and file lifecycle for TamilVault AI.

---

## 1. Architecture: Text-Only Persistence

In accordance with data efficiency and privacy best practices:
- **No Permanent File Uploads:** Uploaded images and PDFs are **never** stored in Supabase Storage buckets or database binary rows.
- **Session-Scoped File Lifecycle:** The uploaded file is held only in memory / temporary local session state during processing.
- **What is Persisted in Supabase:**
  1. **Document Metadata:** File name, file size, total page count, creation timestamp, and completion status.
  2. **Page-by-Page Text:** Raw Tamil OCR transcription, user-approved/corrected transcription, English translation, and Hindi translation.
  3. **Quality & Review Metadata:** Page status (`completed`, `needs_review`, `failed`), honest confidence rating, error logs, and epigraphical suggestion notes.
  4. **User Preferences:** Client-selected interface language (`ta`, `en`, or `hi`) and default OCR mode.
- **Session Refresh Behavior:** When users refresh the browser or start a new session, their transcriptions and translations are immediately restored from Supabase. If the user wishes to run additional OCR passes on unprocessed pages, they are prompted to provide the original file again.

---

## 2. Step-by-Step SQL Execution in Supabase

1. Open your browser and navigate to your project dashboard:
   [https://supabase.com/dashboard/project/cxuvnzwzacdinifulnjc](https://supabase.com/dashboard/project/cxuvnzwzacdinifulnjc)
2. In the left navigation bar, click on **SQL Editor** (`>_`).
3. Click **+ New query**.
4. Open [supabase/schema.sql](file:///c:/Users/deena/Downloads/Optical-Character-Recognition-main/Optical-Character-Recognition-main/supabase/schema.sql), copy the entire SQL content, and paste it into the editor.
5. Click **Run** (or press `Ctrl+Enter`).
6. Confirm the four tables appear in the **Table Editor**:
   - `documents`
   - `document_pages` (with `hindi_translation` column)
   - `review_suggestions`
   - `user_preferences`

---

## 3. Database Schema Overview

| Table | Purpose | Primary Key & Constraints |
| :--- | :--- | :--- |
| `documents` | Stores document metadata and overall status (no binaries) | UUID `id`, indexed by `created_at DESC` |
| `document_pages` | Stores page-level Tamil source, English translation, Hindi translation, and review state | UUID `id`, `UNIQUE (document_id, page_number)` |
| `review_suggestions` | Stores epigraphical annotations and scholarly review decisions | UUID `id`, FK to `document_pages(id)` |
| `user_preferences` | Persists user interface language (`en`, `ta`, or `hi`) | UUID `id`, `UNIQUE (client_id)` |

---

## 4. Row Level Security (RLS) & Access Model

- **Row Level Security (RLS)** is enabled on all four tables.
- **Current Access Model:** The schema defines policies allowing anonymous (`anon`) and `authenticated` roles to read, insert, and update document and page records using the Supabase Publishable Key.
- **Privacy Implications:** In this open-access mode, anyone possessing the publishable key can query document records. If your application requires multi-tenant user isolation, enable Supabase Auth (e.g. Email/Google) and restrict policies so `USING (auth.uid() = owner_id)`.
- **Credential Safety:** The frontend bundle only contains the browser-safe `VITE_SUPABASE_PUBLISHABLE_KEY`. Backend Gemini API keys and Supabase service-role keys are strictly kept on the server.

---

## 5. Environment Variables Configuration

In `frontend/.env`:
```env
VITE_API_URL=http://localhost:8001
VITE_SUPABASE_URL=https://cxuvnzwzacdinifulnjc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_FRCfum7b8elSUHHpGh2I_w_v_QK_n13
```

In `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-latest
HOST=127.0.0.1
PORT=8001
```
