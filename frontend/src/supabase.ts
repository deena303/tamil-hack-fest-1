// supabase.ts — Centralized Supabase client and persistence layer for TamilVault AI
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { PageData } from './App';
import type { PageResult } from './api';

// Environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cxuvnzwzacdinifulnjc.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_FRCfum7b8elSUHHpGh2I_w_v_QK_n13';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

// Centralized client
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Unique stable client ID stored in localStorage to correlate anonymous sessions & preferences
export function getClientId(): string {
  try {
    let cid = localStorage.getItem('tamilvault_client_id');
    if (!cid) {
      cid = 'client_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('tamilvault_client_id', cid);
    }
    return cid;
  } catch {
    return 'client_session';
  }
}

export interface SavedDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  total_pages: number;
  status: string;
  ocr_language: string;
  created_at: string;
  updated_at: string;
}

// ── Document Operations ───────────────────────────────────────────────────────

/**
 * Creates or registers a new document record in Supabase.
 * Returns the document UUID.
 */
export async function createDocumentRecord(doc: {
  filename: string;
  file_type: string;
  file_size: number;
  total_pages: number;
  status?: string;
  ocr_language?: string;
}): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        filename: doc.filename,
        file_type: doc.file_type,
        file_size: doc.file_size,
        total_pages: doc.total_pages,
        status: doc.status || 'pending',
        ocr_language: doc.ocr_language || 'tam+eng',
      })
      .select('id')
      .single();

    if (error) {
      console.warn('Supabase createDocumentRecord error:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn('Supabase createDocumentRecord exception:', err);
    return null;
  }
}

/**
 * Updates document-level status (e.g. 'completed', 'partial', 'failed')
 */
export async function updateDocumentStatus(
  documentId: string,
  status: string,
): Promise<void> {
  if (!supabase || !documentId) return;
  try {
    await supabase
      .from('documents')
      .update({ status })
      .eq('id', documentId);
  } catch (err) {
    console.warn('Supabase updateDocumentStatus exception:', err);
  }
}

/**
 * Updates document total_pages once PDF page count is determined
 */
export async function updateDocumentTotalPages(
  documentId: string,
  totalPages: number,
): Promise<void> {
  if (!supabase || !documentId || totalPages <= 0) return;
  try {
    await supabase
      .from('documents')
      .update({ total_pages: totalPages })
      .eq('id', documentId);
  } catch (err) {
    console.warn('Supabase updateDocumentTotalPages exception:', err);
  }
}

/**
 * Upserts a page record into document_pages.
 * Automatically updates existing page records on retries without duplicating.
 */
export async function upsertDocumentPage(
  documentId: string,
  page: PageResult | PageData,
): Promise<boolean> {
  if (!supabase || !documentId) return false;
  try {
    const pageNum = page.page_number;
    const rawText = page.raw_text || '';
    const cleanedText = page.cleaned_text || ('tamil_text' in page ? page.tamil_text : '') || '';
    const tamilText = ('tamil_text' in page ? page.tamil_text : cleanedText) || '';
    const translation = page.english_translation || null;
    const hindiTranslation = ('hindi_translation' in page ? page.hindi_translation : null) || null;
    const status = page.status || (page.success ? 'completed' : 'failed');
    const needsReview = Boolean(page.needs_review || status === 'needs_review');
    const source = page.source || 'ocr';
    const model = page.engine_model || ('final_model' in page ? page.final_model : '') || 'gemini';
    const errorDetails = page.error || null;
    const confidence = 'confidence_score' in page && page.confidence_score != null
      ? page.confidence_score
      : null;
    const corrections = 'suggested_corrections' in page && page.suggested_corrections != null
      ? page.suggested_corrections
      : null;

    const { error } = await supabase
      .from('document_pages')
      .upsert(
        {
          document_id: documentId,
          page_number: pageNum,
          status,
          raw_tamil_text: rawText,
          cleaned_tamil_text: tamilText,
          english_translation: translation,
          hindi_translation: hindiTranslation,
          suggested_corrections: corrections,
          confidence_score: confidence,
          needs_review: needsReview,
          source,
          engine_model: model,
          error_details: errorDetails,
        },
        { onConflict: 'document_id, page_number' },
      );

    if (error) {
      console.warn(`Supabase upsert page ${pageNum} error:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Supabase upsertDocumentPage exception:', err);
    return false;
  }
}

/**
 * Fetches recent documents saved in Supabase.
 */
export async function fetchRecentDocuments(limit = 15): Promise<SavedDocument[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Supabase fetchRecentDocuments error:', error.message);
      return [];
    }
    return (data as SavedDocument[]) ?? [];
  } catch (err) {
    console.warn('Supabase fetchRecentDocuments exception:', err);
    return [];
  }
}

/**
 * Loads all saved pages for a document and reconstructs the pagesMap.
 */
export async function loadDocumentPagesMap(
  documentId: string,
): Promise<Record<number, PageData>> {
  if (!supabase || !documentId) return {};
  try {
    const { data, error } = await supabase
      .from('document_pages')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });

    if (error) {
      console.warn('Supabase loadDocumentPagesMap error:', error.message);
      return {};
    }

    const map: Record<number, PageData> = {};
    (data || []).forEach(row => {
      map[row.page_number] = {
        page_number: row.page_number,
        status: row.status,
        raw_text: row.raw_tamil_text || '',
        cleaned_text: row.cleaned_tamil_text || '',
        tamil_text: row.cleaned_tamil_text || '',
        english_translation: row.english_translation || null,
        hindi_translation: row.hindi_translation || null,
        engine: 'gemini',
        engine_model: row.engine_model || '',
        language: 'tam+eng',
        source: row.source || 'ocr',
        error: row.error_details || null,
        error_category: null,
        needs_review: row.needs_review || false,
        confidence_score: row.confidence_score,
        suggested_corrections: row.suggested_corrections,
      };
    });

    return map;
  } catch (err) {
    console.warn('Supabase loadDocumentPagesMap exception:', err);
    return {};
  }
}

// ── User Preferences ──────────────────────────────────────────────────────────

/**
 * Persists user preference (UI language, OCR default language) in Supabase.
 */
export async function saveUserPreference(prefs: {
  ui_language?: string;
  preferred_ocr_lang?: string;
  enhance_scans?: boolean;
  use_digital_text?: boolean;
}): Promise<void> {
  if (!supabase) return;
  try {
    const clientId = getClientId();
    await supabase
      .from('user_preferences')
      .upsert(
        {
          client_id: clientId,
          ...prefs,
        },
        { onConflict: 'client_id' },
      );
  } catch (err) {
    console.warn('Supabase saveUserPreference exception:', err);
  }
}

/**
 * Loads user preference from Supabase.
 */
export async function loadUserPreference(): Promise<{
  ui_language?: string;
  preferred_ocr_lang?: string;
  enhance_scans?: boolean;
  use_digital_text?: boolean;
} | null> {
  if (!supabase) return null;
  try {
    const clientId = getClientId();
    const { data, error } = await supabase
      .from('user_preferences')
      .select('ui_language, preferred_ocr_lang, enhance_scans, use_digital_text')
      .eq('client_id', clientId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}
