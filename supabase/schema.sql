-- ==============================================================================
-- TamilVault AI — Production Supabase Database Schema (Text-Only Persistence)
-- Compatible with PostgreSQL 15+ and Supabase SQL Editor
-- Architecture: Stores text data, translations, review notes & metadata ONLY.
-- Original image and PDF binaries remain in temporary session memory and are
-- NOT permanently stored in Supabase Storage or database binary columns.
-- ==============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- Table 1: documents
-- Stores uploaded document metadata and overall processing progress
-- (No image/PDF binaries or storage paths stored here)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,                  -- 'image/jpeg', 'image/png', 'application/pdf', etc.
    file_size BIGINT NOT NULL DEFAULT 0,      -- In bytes
    total_pages INT NOT NULL DEFAULT 1,       -- 1 for images, N for multi-page PDFs
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'processing', 'completed', 'partial', 'failed'
    ocr_language TEXT NOT NULL DEFAULT 'tam+eng', -- 'tam', 'tam+eng', 'eng'
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Reserved for future Auth integration
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Indexes for listing documents sorted by most recent
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents (status);

-- ------------------------------------------------------------------------------
-- Table 2: document_pages
-- Stores per-page raw OCR transcriptions, approved corrections, and translations.
-- (Strict separation between raw transcription and approved text)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    page_number INT NOT NULL,                 -- 1-based index (matches document/book numbering)
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'processing', 'completed', 'needs_review', 'failed'
    raw_tamil_text TEXT NOT NULL DEFAULT '',  -- Exact raw transcription with [unclear] markers intact
    cleaned_tamil_text TEXT NOT NULL DEFAULT '', -- User-verified / approved Tamil transcription
    english_translation TEXT,                -- English translation generated only from transcription
    hindi_translation TEXT,                  -- Hindi translation generated only from transcription
    suggested_corrections TEXT,              -- Epigraphical notes / scholarly suggested readings
    confidence_score NUMERIC(5,2),           -- Honest confidence percentage (or null if uncalibrated)
    needs_review BOOLEAN NOT NULL DEFAULT false, -- True if [unclear] present or low confidence
    source TEXT NOT NULL DEFAULT 'ocr',       -- 'ocr' | 'digital'
    engine_model TEXT,                        -- Model name (e.g. gemini-flash-latest)
    error_details TEXT,                       -- Error description if failed (secrets redacted)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_document_page UNIQUE (document_id, page_number)
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_document_pages_updated_at ON public.document_pages;
CREATE TRIGGER trg_document_pages_updated_at
BEFORE UPDATE ON public.document_pages
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Indexes for page lookups and status aggregation
CREATE INDEX IF NOT EXISTS idx_document_pages_doc_id ON public.document_pages (document_id);
CREATE INDEX IF NOT EXISTS idx_document_pages_lookup ON public.document_pages (document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_document_pages_status ON public.document_pages (status);

-- ------------------------------------------------------------------------------
-- Table 3: review_suggestions
-- Stores epigraphical annotations, corrections, and review decisions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.document_pages(id) ON DELETE CASCADE,
    original_text TEXT NOT NULL,              -- Ambiguous or [unclear] segment
    suggested_correction TEXT NOT NULL,      -- Suggested reading or emendation
    explanation TEXT,                         -- Justification / epigraphical reference
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'accepted', 'rejected'
    reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_review_suggestions_updated_at ON public.review_suggestions;
CREATE TRIGGER trg_review_suggestions_updated_at
BEFORE UPDATE ON public.review_suggestions
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE INDEX IF NOT EXISTS idx_review_suggestions_page_id ON public.review_suggestions (page_id);

-- ------------------------------------------------------------------------------
-- Table 4: user_preferences
-- Persists UI language (Tamil / English) and processing preferences per client
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL UNIQUE,           -- Unique client identifier (anonymous or authenticated)
    ui_language TEXT NOT NULL DEFAULT 'en',   -- 'en' (English) | 'ta' (தமிழ்)
    preferred_ocr_lang TEXT NOT NULL DEFAULT 'tam+eng',
    enhance_scans BOOLEAN NOT NULL DEFAULT true,
    use_digital_text BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE INDEX IF NOT EXISTS idx_user_preferences_client_id ON public.user_preferences (client_id);

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Policies for public / anonymous client access (Default Mode)
-- Allows frontend using the Publishable Key to store and restore OCR sessions
-- ------------------------------------------------------------------------------

-- Documents: allow anon read, insert, and update
DROP POLICY IF EXISTS "Anon documents read" ON public.documents;
CREATE POLICY "Anon documents read"
ON public.documents FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Anon documents insert" ON public.documents;
CREATE POLICY "Anon documents insert"
ON public.documents FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon documents update" ON public.documents;
CREATE POLICY "Anon documents update"
ON public.documents FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Document pages: allow anon read, insert, and update (upsert support)
DROP POLICY IF EXISTS "Anon document_pages read" ON public.document_pages;
CREATE POLICY "Anon document_pages read"
ON public.document_pages FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Anon document_pages insert" ON public.document_pages;
CREATE POLICY "Anon document_pages insert"
ON public.document_pages FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon document_pages update" ON public.document_pages;
CREATE POLICY "Anon document_pages update"
ON public.document_pages FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Review suggestions: allow anon read, insert, and update
DROP POLICY IF EXISTS "Anon review_suggestions read" ON public.review_suggestions;
CREATE POLICY "Anon review_suggestions read"
ON public.review_suggestions FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Anon review_suggestions insert" ON public.review_suggestions;
CREATE POLICY "Anon review_suggestions insert"
ON public.review_suggestions FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon review_suggestions update" ON public.review_suggestions;
CREATE POLICY "Anon review_suggestions update"
ON public.review_suggestions FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- User preferences: allow anon read, insert, and update by client_id
DROP POLICY IF EXISTS "Anon user_preferences read" ON public.user_preferences;
CREATE POLICY "Anon user_preferences read"
ON public.user_preferences FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Anon user_preferences insert" ON public.user_preferences;
CREATE POLICY "Anon user_preferences insert"
ON public.user_preferences FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon user_preferences update" ON public.user_preferences;
CREATE POLICY "Anon user_preferences update"
ON public.user_preferences FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- Safe Migrations / Alter Table Upgrades
-- Run these statements safely against existing databases without data loss
-- ------------------------------------------------------------------------------
ALTER TABLE public.document_pages ADD COLUMN IF NOT EXISTS hindi_translation TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS total_pages INT NOT NULL DEFAULT 1;
