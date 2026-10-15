// API client — TamilVault v3 (Gemini OCR + Translation + PDF)

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8001';

const OCR_TIMEOUT_MS  = 120_000;
const PDF_TIMEOUT_MS  = 600_000;  // 10 min for large books

// -- Types
export interface WordConfidence { word: string; confidence: number; }

export interface OCRResult {
  success: boolean;
  raw_text: string;
  cleaned_text: string;
  tamil_text: string;
  english_translation: string | null;
  hindi_translation?: string | null;
  suggested_corrections?: string | null;
  confidence_score?: number | null;
  words_with_confidence: WordConfidence[];
  regions_found: number;
  engine: string;
  engine_model: string;
  api_key_configured: boolean;
  language: string;
  error: string | null;
}

export type PageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'needs_review';

export interface PageResult {
  success: boolean;
  page_number: number;
  raw_text: string;
  cleaned_text: string;
  tamil_text: string;
  english_translation: string | null;
  hindi_translation?: string | null;
  suggested_corrections?: string | null;
  confidence_score?: number | null;
  engine: string;
  engine_model: string;
  language: string;
  source: string;
  status?: PageStatus;
  needs_review?: boolean;
  error: string | null;
  error_category: string | null;   // RATE_LIMIT | QUOTA_EXHAUSTED | INVALID_KEY | MODEL_NOT_FOUND | SERVER_ERROR
  quota_exhausted: boolean;        // true if quota is exhausted
  model_switched: boolean;         // true if automatic model fallback occurred for this page
  final_model: string | null;      // the model that actually produced the result
}

export interface PDFInfo {
  page_count: number;
  has_digital_text: boolean;
  error: string | null;
}

export interface SystemStatus {
  ocr_engine: string;
  ocr_engine_loaded: boolean;
  api_key_configured: boolean;
  gemini_model: string;
  gemini_model_queue: string[];    // validated fallback queue
  pdf_support: boolean;
  ready: boolean;
  diagnostic_message: string | null;
}

// -- SSE stream event types
export interface SSEStart       { type: 'start';        total: number; pages: number[]; }
export interface SSEProgress    { type: 'progress';     page: number; done: number; total: number; pct: number; pages_per_min: number | null; eta_secs: number | null; delay_s?: number; }
export interface SSEPage        { type: 'page';         result: PageResult; pages_per_min?: number | null; eta_secs?: number | null; }
export interface SSEDone        { type: 'done';         total: number; failed: number; elapsed_s?: number; pages_per_min?: number | null; }
export interface SSEError       { type: 'error';        message: string; quota_exhausted?: boolean; }
export interface SSEModelSwitch { type: 'model_switch'; page: number; from_model: string; to_model: string; reason: string; }
export type SSEEvent = SSEStart | SSEProgress | SSEPage | SSEDone | SSEError | SSEModelSwitch;

export interface StreamCallbacks {
  onStart?:       (e: SSEStart)       => void;
  onProgress?:    (e: SSEProgress)    => void;
  onPage?:        (e: SSEPage)        => void;
  onDone?:        (e: SSEDone)        => void;
  onError?:       (e: SSEError | Error) => void;
  onModelSwitch?: (e: SSEModelSwitch) => void;
}

// -- Fetch helpers
async function _fetchJSON<T>(url: string, options: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      let detail: string;
      try { detail = (await res.json())?.detail ?? `Server error ${res.status}`; }
      catch { detail = `Server error ${res.status}`; }
      throw new Error(detail);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// -- Status
export async function fetchStatus(): Promise<SystemStatus> {
  return _fetchJSON<SystemStatus>(`${API_BASE}/status`, {}, 5_000);
}

// -- Image OCR
export async function runOCR(
  file: File,
  lang: string,
  enhance: boolean,
  onProgress?: (pct: number) => void,
): Promise<OCRResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('lang', lang);
  form.append('enhance', String(enhance));

  let tick = 0;
  const interval = onProgress
    ? setInterval(() => { tick = Math.min(tick + 4, 88); onProgress(tick); }, 600)
    : null;

  try {
    const result = await _fetchJSON<OCRResult>(
      `${API_BASE}/ocr`,
      { method: 'POST', body: form },
      OCR_TIMEOUT_MS,
    );
    onProgress?.(100);
    return result;
  } finally {
    if (interval) clearInterval(interval);
  }
}

// -- PDF info
export async function fetchPDFInfo(file: File): Promise<PDFInfo> {
  const form = new FormData();
  form.append('file', file);
  return _fetchJSON<PDFInfo>(`${API_BASE}/pdf/info`, { method: 'POST', body: form }, 15_000);
}

// -- PDF single page
export async function runPDFPage(
  file: File,
  page: number,
  lang: string,
  enhance: boolean,
  useDigitalText: boolean,
  onProgress?: (pct: number) => void,
): Promise<PageResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('page', String(page));
  form.append('lang', lang);
  form.append('enhance', String(enhance));
  form.append('use_digital_text', String(useDigitalText));

  let tick = 0;
  const interval = onProgress
    ? setInterval(() => { tick = Math.min(tick + 3, 88); onProgress(tick); }, 700)
    : null;

  try {
    const result = await _fetchJSON<PageResult>(
      `${API_BASE}/pdf/page`,
      { method: 'POST', body: form },
      OCR_TIMEOUT_MS,
    );
    onProgress?.(100);
    return result;
  } finally {
    if (interval) clearInterval(interval);
  }
}

// -- PDF batch pages (sync, up to 50)
export async function runPDFPages(
  file: File,
  pages: string,
  lang: string,
  enhance: boolean,
  useDigitalText: boolean,
  onProgress?: (pct: number) => void,
): Promise<PageResult[]> {
  const form = new FormData();
  form.append('file', file);
  form.append('pages', pages);
  form.append('lang', lang);
  form.append('enhance', String(enhance));
  form.append('use_digital_text', String(useDigitalText));

  let tick = 0;
  const interval = onProgress
    ? setInterval(() => { tick = Math.min(tick + 1, 90); onProgress(tick); }, 1000)
    : null;

  try {
    const result = await _fetchJSON<PageResult[]>(
      `${API_BASE}/pdf/pages`,
      { method: 'POST', body: form },
      PDF_TIMEOUT_MS,
    );
    onProgress?.(100);
    return result;
  } finally {
    if (interval) clearInterval(interval);
  }
}

// -- SSE reader helper
async function _readSSEStream(
  res: Response,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) { callbacks.onError?.(new Error('No response body')); return; }
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          const evt = JSON.parse(json) as SSEEvent;
          switch (evt.type) {
            case 'start':        callbacks.onStart?.(evt);        break;
            case 'progress':     callbacks.onProgress?.(evt);     break;
            case 'page':         callbacks.onPage?.(evt);         break;
            case 'done':         callbacks.onDone?.(evt);         break;
            case 'error':        callbacks.onError?.(evt);        break;
            case 'model_switch': callbacks.onModelSwitch?.(evt);  break;
          }
        } catch { /* skip malformed JSON */ }
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    reader.releaseLock();
  }
}

// -- PDF stream (SSE, unlimited pages)
export function streamPDFPages(
  file: File,
  pages: string,
  lang: string,
  enhance: boolean,
  useDigitalText: boolean,
  batchSize: number,
  callbacks: StreamCallbacks,
  concurrency = 1,
  delay = 2.5,
  skipPages: number[] = [],
): AbortController {
  const ctrl = new AbortController();
  (async () => {
    const form = new FormData();
    form.append('file', file);
    form.append('pages', pages);
    form.append('lang', lang);
    form.append('enhance', String(enhance));
    form.append('use_digital_text', String(useDigitalText));
    form.append('batch_size', String(batchSize));
    form.append('concurrency', String(concurrency));
    form.append('delay', String(delay));
    if (skipPages.length > 0) {
      form.append('skip_pages', skipPages.join(','));
    }
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/pdf/stream`, {
        method: 'POST', body: form, signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!res.ok) {
      let detail = `Server error ${res.status}`;
      try { detail = (await res.json())?.detail ?? detail; } catch { /* ignore */ }
      callbacks.onError?.(new Error(detail));
      return;
    }
    await _readSSEStream(res, callbacks, ctrl.signal);
  })();
  return ctrl;
}

// -- PDF retry failed pages (SSE)
export function retryPDFPages(
  file: File,
  failedPages: number[],
  lang: string,
  enhance: boolean,
  useDigitalText: boolean,
  callbacks: StreamCallbacks,
  delay = 2.5,
): AbortController {
  const ctrl = new AbortController();
  (async () => {
    const form = new FormData();
    form.append('file', file);
    form.append('failed_pages', failedPages.join(','));
    form.append('lang', lang);
    form.append('enhance', String(enhance));
    form.append('use_digital_text', String(useDigitalText));
    form.append('delay', String(delay));
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/pdf/retry`, {
        method: 'POST', body: form, signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!res.ok) {
      let detail = `Server error ${res.status}`;
      try { detail = (await res.json())?.detail ?? detail; } catch { /* ignore */ }
      callbacks.onError?.(new Error(detail));
      return;
    }
    await _readSSEStream(res, callbacks, ctrl.signal);
  })();
  return ctrl;
}

// -- Dedicated PDF Export API
export interface PDFExportPageItem {
  page_number: number;
  tamil_text?: string;
  english_translation?: string | null;
  hindi_translation?: string | null;
  suggested_corrections?: string | null;
  status?: string;
  confidence_score?: number | null;
  source?: string;
}

export interface PDFExportRequest {
  title?: string;
  pages: PDFExportPageItem[];
  include_tamil?: boolean;
  include_translation?: boolean;
  include_hindi?: boolean;
  include_notes?: boolean;
}

export async function exportDocumentPDF(req: PDFExportRequest): Promise<Blob> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${API_BASE}/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = `PDF export failed (${res.status})`;
      try { detail = (await res.json())?.detail ?? detail; } catch { /* ignore */ }
      throw new Error(detail);
    }
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}