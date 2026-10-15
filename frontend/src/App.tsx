import { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import {
  fetchStatus, runOCR, fetchPDFInfo, runPDFPage,
  streamPDFPages, retryPDFPages, exportDocumentPDF,
} from './api';
import type { OCRResult, PageResult, PageStatus, PDFInfo, SystemStatus, PDFExportPageItem } from './api';
import { useI18n } from './i18n.tsx';
import {
  createDocumentRecord,
  upsertDocumentPage,
  updateDocumentStatus,
  updateDocumentTotalPages,
  fetchRecentDocuments,
  loadDocumentPagesMap,
  saveUserPreference,
  isSupabaseConfigured,
  type SavedDocument,
} from './supabase';

export interface PageData {
  page_number: number;
  status: PageStatus;
  raw_text: string;
  cleaned_text: string;
  tamil_text: string;
  english_translation: string | null;
  hindi_translation?: string | null;
  engine: string;
  engine_model: string;
  language: string;
  source: string;
  error: string | null;
  error_category: string | null;
  needs_review: boolean;
  confidence_score?: number | null;
  suggested_corrections?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function downloadText(text: string, filename: string) {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmtBytes(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function stripBasename(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function parsePageRangeList(rangeStr: string, total: number): number[] {
  const result = new Set<number>();
  const parts = rangeStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(total, end); i++) {
          result.add(i);
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= total) {
        result.add(num);
      }
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

// ── Stream progress state ─────────────────────────────────────────────────────
interface StreamProgress {
  total: number;
  done: number;
  failed: number;
  currentPage: number | null;
  pct: number;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { lang: uiLang, setLang: setUiLang, t } = useI18n();

  // Status
  const [status, setStatus]       = useState<SystemStatus | null>(null);
  const [statusErr, setStatusErr] = useState(false);

  // File & Document
  const [file, setFile]           = useState<File | null>(null);
  const [isPDF, setIsPDF]         = useState(false);
  const [preview, setPreview]     = useState<string | null>(null);
  const [pdfInfo, setPdfInfo]     = useState<PDFInfo | null>(null);
  const [pdfInfoLoading, setPdfInfoLoading] = useState(false);
  const [currentDocId, setCurrentDocId]   = useState<string | null>(null);
  const [supabaseSyncMsg, setSupabaseSyncMsg] = useState<string | null>(null);
  const [isRestoredSession, setIsRestoredSession] = useState(false);
  const [restoredDocName, setRestoredDocName] = useState('');
  const currentDocIdRef = useRef<string | null>(null);

  // Saved Documents Modal (Supabase)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentDocs, setRecentDocs]   = useState<SavedDocument[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Dedicated PDF Export state
  const [showPdfExportModal, setShowPdfExportModal] = useState(false);
  const [pdfExportScope, setPdfExportScope] = useState<'all' | 'current' | 'range'>('all');
  const [pdfExportRangeStr, setPdfExportRangeStr] = useState('1-5');
  const [pdfExportIncludeTamil, setPdfExportIncludeTamil] = useState(true);
  const [pdfExportIncludeTranslation, setPdfExportIncludeTranslation] = useState(true);
  const [pdfExportIncludeHindi, setPdfExportIncludeHindi] = useState(true);
  const [pdfExportIncludeNotes, setPdfExportIncludeNotes] = useState(true);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);

  // Options
  const [lang, setLang]           = useState('tam+eng');
  const [enhance, setEnhance]     = useState(true);
  const [useDigital, setUseDigital] = useState(true);

  // PDF page selection
  const [pdfPageMode, setPdfPageMode] = useState<'single' | 'range' | 'all'>('all');
  const [pdfSinglePage, setPdfSinglePage] = useState(1);
  const [pdfRangeStr, setPdfRangeStr]     = useState('1-5');

  // Processing
  const [processing, setProcessing] = useState(false);
  const [singlePageLoading, setSinglePageLoading] = useState<number | null>(null);
  const [streamProgress, setStreamProgress] = useState<StreamProgress | null>(null);
  const [processingMsg, setProcessingMsg]   = useState('');
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [activeModel, setActiveModel]       = useState<string | null>(null);
  const [modelSwitchMsg, setModelSwitchMsg] = useState<string | null>(null);
  const [speedInfo, setSpeedInfo]           = useState<{ ppm: number | null; eta: number | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Results: Single image result OR keyed map for all PDF pages
  const [result, setResult]           = useState<OCRResult | null>(null);
  const [pagesMap, setPagesMap]       = useState<Record<number, PageData>>({});
  const [activePage, setActivePage]   = useState(1);
  const [activeTab, setActiveTab]     = useState<'result' | 'translation' | 'hindi' | 'export'>('result');
  const [editedText, setEditedText]   = useState('');
  const [editedTranslation, setEditedTranslation] = useState('');
  const [editedHindiTranslation, setEditedHindiTranslation] = useState('');

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Status poll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStatus()
      .then(s => setStatus(s))
      .catch(() => setStatusErr(true));
  }, []);

  // ── Helper to initialize or get default page data ───────────────────────────
  const createDefaultPage = (num: number, l = lang): PageData => ({
    page_number: num,
    status: 'pending',
    raw_text: '',
    cleaned_text: '',
    tamil_text: '',
    english_translation: null,
    hindi_translation: null,
    engine: 'gemini',
    engine_model: status?.gemini_model ?? '',
    language: l,
    source: 'ocr',
    error: null,
    error_category: null,
    needs_review: false,
    confidence_score: null,
    suggested_corrections: null,
  });

  // ── Language switcher handler ───────────────────────────────────────────────
  const handleLanguageChange = (newLang: 'en' | 'ta' | 'hi') => {
    setUiLang(newLang);
    saveUserPreference({ ui_language: newLang });
  };

  // ── File selection ───────────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    setFile(f);
    setIsRestoredSession(false);
    setRestoredDocName('');
    setResult(null);
    setPagesMap({});
    setEditedText('');
    setEditedTranslation('');
    setEditedHindiTranslation('');
    setActivePage(1);
    setPdfInfo(null);
    setPreview(null);
    setStreamProgress(null);
    setProcessingMsg('');
    setQuotaExhausted(false);
    setActiveModel(null);
    setModelSwitchMsg(null);
    setSpeedInfo(null);
    setCurrentDocId(null);
    currentDocIdRef.current = null;
    setSupabaseSyncMsg(null);

    const pdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
    setIsPDF(pdf);

    // Register document in Supabase
    createDocumentRecord({
      filename: f.name,
      file_type: f.type || (pdf ? 'application/pdf' : 'image/jpeg'),
      file_size: f.size,
      total_pages: 1,
      status: 'pending',
      ocr_language: lang,
    }).then(docId => {
      if (docId) {
        setCurrentDocId(docId);
        currentDocIdRef.current = docId;
        setSupabaseSyncMsg('✓ Document registered in Supabase');
      }
    });

    if (!pdf) {
      const url = URL.createObjectURL(f);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPdfInfoLoading(true);
      fetchPDFInfo(f)
        .then(info => {
          setPdfInfo(info);
          setPdfInfoLoading(false);

          // Update total_pages in Supabase
          if (info.page_count > 0) {
            if (currentDocIdRef.current) {
              updateDocumentTotalPages(currentDocIdRef.current, info.page_count);
            }
            const initialMap: Record<number, PageData> = {};
            for (let i = 1; i <= info.page_count; i++) {
              initialMap[i] = {
                page_number: i,
                status: 'pending',
                raw_text: '',
                cleaned_text: '',
                tamil_text: '',
                english_translation: null,
                hindi_translation: null,
                engine: 'gemini',
                engine_model: '',
                language: lang,
                source: 'ocr',
                error: null,
                error_category: null,
                needs_review: false,
                confidence_score: null,
                suggested_corrections: null,
              };
            }
            setPagesMap(initialMap);
          }
        })
        .catch(err => {
          setPdfInfo({ page_count: 0, has_digital_text: false, error: String(err) });
          setPdfInfoLoading(false);
        });
    }
  }, [lang]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  // ── Open History Modal ───────────────────────────────────────────────────────
  const openHistory = async () => {
    setHistoryOpen(true);
    setLoadingHistory(true);
    const docs = await fetchRecentDocuments(20);
    setRecentDocs(docs);
    setLoadingHistory(false);
  };

  // ── Restore a Document from Supabase ─────────────────────────────────────────
  const restoreDocument = async (doc: SavedDocument) => {
    setHistoryOpen(false);
    setProcessing(false);
    setIsRestoredSession(true);
    setRestoredDocName(doc.filename);
    setFile(null); // Keep original scan strictly session-scoped / not in storage
    setIsPDF(doc.file_type.includes('pdf'));
    setCurrentDocId(doc.id);
    currentDocIdRef.current = doc.id;
    setSupabaseSyncMsg(`✓ Restored "${doc.filename}" from Supabase`);

    const pages = await loadDocumentPagesMap(doc.id);
    // Stale async response guard
    if (currentDocIdRef.current !== doc.id) return;

    const pageNums = Object.keys(pages).map(Number);
    const maxPage = Math.max(doc.total_pages || 1, pageNums.length ? Math.max(...pageNums) : 1);

    // Self-heal total_pages in database if previously recorded as 1
    if ((doc.total_pages || 1) < maxPage) {
      updateDocumentTotalPages(doc.id, maxPage);
    }

    // Build complete contiguous page map 1..maxPage
    const fullPagesMap: Record<number, PageData> = {};
    for (let i = 1; i <= maxPage; i++) {
      if (pages[i]) {
        fullPagesMap[i] = pages[i];
      } else {
        fullPagesMap[i] = createDefaultPage(i, doc.ocr_language || lang);
      }
    }
    setPagesMap(fullPagesMap);
    setActivePage(1);

    const firstPage = fullPagesMap[1];
    if (firstPage) {
      setEditedText(firstPage.tamil_text || firstPage.cleaned_text || '');
      setEditedTranslation(firstPage.english_translation ?? '');
      setEditedHindiTranslation(firstPage.hindi_translation ?? '');
    } else {
      setEditedText('');
      setEditedTranslation('');
      setEditedHindiTranslation('');
    }

    if (doc.file_type.includes('pdf')) {
      setPdfInfo({
        page_count: maxPage,
        has_digital_text: false,
        error: null,
      });
    } else {
      setResult({
        success: doc.status === 'completed',
        raw_text: firstPage?.raw_text || '',
        cleaned_text: firstPage?.cleaned_text || '',
        tamil_text: firstPage?.tamil_text || '',
        english_translation: firstPage?.english_translation || null,
        hindi_translation: firstPage?.hindi_translation || null,
        words_with_confidence: [],
        regions_found: 1,
        engine: 'gemini',
        engine_model: firstPage?.engine_model || '',
        api_key_configured: true,
        language: doc.ocr_language || 'tam+eng',
        error: firstPage?.error || null,
        confidence_score: firstPage?.confidence_score,
        suggested_corrections: firstPage?.suggested_corrections,
      });
    }
  };

  // ── Cancel stream ────────────────────────────────────────────────────────────
  const cancelProcessing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProcessing(false);
    setProcessingMsg(uiLang === 'ta' ? 'பயனரால் ரத்து செய்யப்பட்டது. முடிந்த பக்கங்கள் சேமிக்கப்பட்டுள்ளன.' : 'Cancelled by user. Completed pages are saved.');
  };

  // ── Page navigation ──────────────────────────────────────────────────────────
  const goToPage = (pageNum: number) => {
    setActivePage(pageNum);
    const pd = pagesMap[pageNum];
    if (pd) {
      setEditedText(pd.tamil_text || pd.cleaned_text || '');
      setEditedTranslation(pd.english_translation ?? '');
      setEditedHindiTranslation(pd.hindi_translation ?? '');
    } else {
      setEditedText('');
      setEditedTranslation('');
      setEditedHindiTranslation('');
    }
  };

  // ── User text editing (saved directly into pagesMap & Supabase) ──────────────
  const handleTamilTextChange = (text: string) => {
    setEditedText(text);
    if (isPDF) {
      setPagesMap(prev => {
        const cur = prev[activePage] ?? createDefaultPage(activePage);
        const updated: PageData = {
          ...cur,
          tamil_text: text,
          cleaned_text: text,
          needs_review: !text.trim() || text.includes('[unclear]'),
        };
        if (currentDocId) {
          upsertDocumentPage(currentDocId, updated);
        }
        return {
          ...prev,
          [activePage]: updated,
        };
      });
    } else if (result && currentDocId) {
      upsertDocumentPage(currentDocId, {
        page_number: 1,
        status: 'completed',
        raw_text: result.raw_text,
        cleaned_text: text,
        tamil_text: text,
        english_translation: editedTranslation || result.english_translation,
        hindi_translation: editedHindiTranslation || result.hindi_translation,
        engine: result.engine,
        engine_model: result.engine_model,
        language: result.language,
        source: 'ocr',
        error: null,
        error_category: null,
        needs_review: false,
        confidence_score: result.confidence_score,
        suggested_corrections: result.suggested_corrections,
        success: true,
        quota_exhausted: false,
        model_switched: false,
        final_model: result.engine_model,
      });
    }
  };

  const handleTranslationChange = (text: string) => {
    setEditedTranslation(text);
    if (isPDF) {
      setPagesMap(prev => {
        const cur = prev[activePage] ?? createDefaultPage(activePage);
        const updated: PageData = {
          ...cur,
          english_translation: text,
        };
        if (currentDocId) {
          upsertDocumentPage(currentDocId, updated);
        }
        return {
          ...prev,
          [activePage]: updated,
        };
      });
    } else if (result && currentDocId) {
      upsertDocumentPage(currentDocId, {
        page_number: 1,
        status: 'completed',
        raw_text: result.raw_text,
        cleaned_text: editedText || result.cleaned_text,
        tamil_text: editedText || result.tamil_text,
        english_translation: text,
        hindi_translation: editedHindiTranslation || result.hindi_translation,
        engine: result.engine,
        engine_model: result.engine_model,
        language: result.language,
        source: 'ocr',
        error: null,
        error_category: null,
        needs_review: false,
        confidence_score: result.confidence_score,
        suggested_corrections: result.suggested_corrections,
        success: true,
        quota_exhausted: false,
        model_switched: false,
        final_model: result.engine_model,
      });
    }
  };

  const handleHindiTranslationChange = (text: string) => {
    setEditedHindiTranslation(text);
    if (isPDF) {
      setPagesMap(prev => {
        const cur = prev[activePage] ?? createDefaultPage(activePage);
        const updated: PageData = {
          ...cur,
          hindi_translation: text,
        };
        if (currentDocId) {
          upsertDocumentPage(currentDocId, updated);
        }
        return {
          ...prev,
          [activePage]: updated,
        };
      });
    } else if (result && currentDocId) {
      upsertDocumentPage(currentDocId, {
        page_number: 1,
        status: 'completed',
        raw_text: result.raw_text,
        cleaned_text: editedText || result.cleaned_text,
        tamil_text: editedText || result.tamil_text,
        english_translation: editedTranslation || result.english_translation,
        hindi_translation: text,
        engine: result.engine,
        engine_model: result.engine_model,
        language: result.language,
        source: 'ocr',
        error: null,
        error_category: null,
        needs_review: false,
        confidence_score: result.confidence_score,
        suggested_corrections: result.suggested_corrections,
        success: true,
        quota_exhausted: false,
        model_switched: false,
        final_model: result.engine_model,
      });
    }
  };

  // ── Save a PageResult into the pagesMap & Supabase ───────────────────────────
  const savePageResult = useCallback((pr: PageResult) => {
    setPagesMap(prev => {
      const cur = prev[pr.page_number] ?? createDefaultPage(pr.page_number);
      const isBlank = !pr.tamil_text?.trim() && !pr.raw_text?.trim();
      const hasUnclear = (pr.raw_text || '').toLowerCase().includes('[unclear]');
      let computedStatus: PageStatus = pr.status ?? (pr.success ? 'completed' : 'failed');
      if (pr.success && (isBlank || hasUnclear || pr.needs_review || Boolean(pr.suggested_corrections))) {
        computedStatus = 'needs_review';
      }

      const updated: PageData = {
        ...cur,
        page_number: pr.page_number,
        status: computedStatus,
        raw_text: pr.raw_text,
        cleaned_text: pr.cleaned_text,
        tamil_text: pr.tamil_text || pr.cleaned_text,
        english_translation: pr.english_translation,
        hindi_translation: pr.hindi_translation || null,
        engine: pr.engine,
        engine_model: pr.engine_model,
        language: pr.language,
        source: pr.source,
        error: pr.error,
        error_category: pr.error_category,
        needs_review: computedStatus === 'needs_review',
        confidence_score: pr.confidence_score,
        suggested_corrections: pr.suggested_corrections,
      };

      // Persist to Supabase
      if (currentDocId) {
        upsertDocumentPage(currentDocId, updated).catch(err =>
          console.warn('Supabase page sync error:', err),
        );
      }

      return { ...prev, [pr.page_number]: updated };
    });

    // Sync editor if viewing this page
    setActivePage(curPage => {
      if (curPage === pr.page_number) {
        setEditedText(pr.tamil_text || pr.cleaned_text || '');
        setEditedTranslation(pr.english_translation ?? '');
        setEditedHindiTranslation(pr.hindi_translation ?? '');
      }
      return curPage;
    });
  }, [currentDocId]);

  // ── Single-page processing / retry ───────────────────────────────────────────
  const processSinglePage = async (pageNum: number) => {
    if (!file) return;
    setSinglePageLoading(pageNum);
    // Mark as processing
    setPagesMap(prev => ({
      ...prev,
      [pageNum]: {
        ...(prev[pageNum] ?? createDefaultPage(pageNum)),
        status: 'processing',
        error: null,
      },
    }));

    try {
      const r = await runPDFPage(file, pageNum, lang, enhance, useDigital);
      savePageResult(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      savePageResult({
        success: false,
        status: 'failed',
        needs_review: true,
        page_number: pageNum,
        raw_text: '',
        cleaned_text: '',
        tamil_text: '',
        english_translation: null,
        hindi_translation: null,
        engine: 'gemini',
        engine_model: '',
        language: lang,
        source: 'ocr',
        error: msg,
        error_category: 'UNKNOWN',
        quota_exhausted: false,
        model_switched: false,
        final_model: null,
        confidence_score: 0,
        suggested_corrections: null,
      });
    } finally {
      setSinglePageLoading(null);
    }
  };

  // ── Run OCR (Full / Range / Resume) ──────────────────────────────────────────
  const runOcr = async (resumeOnly = false) => {
    if (!file) return;
    setQuotaExhausted(false);
    setActiveModel(status?.gemini_model ?? null);
    setModelSwitchMsg(null);
    setSpeedInfo(null);
    setProcessing(true);

    // ── Image mode ──────────────────────────────────────────────────────────
    if (!isPDF) {
      setProcessingMsg(uiLang === 'ta' ? 'ஜெமினிக்கு படம் அனுப்பப்படுகிறது…' : 'Sending image to Gemini…');
      try {
        const res = await runOCR(file, lang, enhance, pct =>
          setStreamProgress({ total: 1, done: 0, failed: 0, currentPage: null, pct }),
        );
        setResult(res);
        const tamilT = res.tamil_text || res.cleaned_text || res.raw_text;
        setEditedText(tamilT);
        setEditedTranslation(res.english_translation ?? '');
        setEditedHindiTranslation(res.hindi_translation ?? '');
        if (res.hindi_translation && !res.english_translation) setActiveTab('hindi');
        else if (res.english_translation) setActiveTab('translation');

        // Persist image result to Supabase
        if (currentDocId) {
          upsertDocumentPage(currentDocId, {
            page_number: 1,
            status: res.success ? 'completed' : 'failed',
            raw_text: res.raw_text,
            cleaned_text: res.cleaned_text,
            tamil_text: tamilT,
            english_translation: res.english_translation,
            hindi_translation: res.hindi_translation,
            engine: res.engine,
            engine_model: res.engine_model,
            language: res.language,
            source: 'ocr',
            error: res.error,
            error_category: null,
            needs_review: false,
            confidence_score: res.confidence_score,
            suggested_corrections: res.suggested_corrections,
            success: res.success,
            quota_exhausted: false,
            model_switched: false,
            final_model: res.engine_model,
          });
          updateDocumentStatus(currentDocId, res.success ? 'completed' : 'failed');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setResult({
          success: false, raw_text: '', cleaned_text: '', tamil_text: '',
          english_translation: null, words_with_confidence: [],
          regions_found: 0, engine: 'gemini', engine_model: '',
          api_key_configured: true, language: lang,
          error: msg,
          confidence_score: 0,
          suggested_corrections: null,
        });
      } finally {
        setProcessing(false);
        setStreamProgress(null);
        setProcessingMsg('');
      }
      return;
    }

    // ── Single page mode ─────────────────────────────────────────────────────
    if (pdfPageMode === 'single') {
      await processSinglePage(pdfSinglePage);
      setProcessing(false);
      return;
    }

    // ── Multi-page: Sequential & Paced SSE streaming ─────────────────────────
    const pagesStr = pdfPageMode === 'range' ? pdfRangeStr : 'all';
    setProcessingMsg(uiLang === 'ta' ? 'பக்கங்கள் துவக்கப்படுகின்றன…' : 'Initializing pages…');

    // Calculate completed pages to skip if resuming
    const completedPagesToSkip: number[] = [];
    if (resumeOnly) {
      Object.values(pagesMap).forEach(p => {
        if (p.status === 'completed') {
          completedPagesToSkip.push(p.page_number);
        }
      });
    }

    const ctrl = streamPDFPages(
      file,
      pagesStr,
      lang,
      enhance,
      useDigital,
      1,     // batch_size: 1 (sequential)
      {
        onStart: (e) => {
          setStreamProgress({
            total: e.total,
            done: completedPagesToSkip.length,
            failed: 0,
            currentPage: null,
            pct: e.total ? Math.round((completedPagesToSkip.length / e.total) * 100) : 0,
          });
          setProcessingMsg(
            uiLang === 'ta'
              ? `பகுப்பாய்வு செய்யப்பட்டது: ${completedPagesToSkip.length} / ${e.total} பக்கங்கள்`
              : `Processed: ${completedPagesToSkip.length} / ${e.total} pages`,
          );
        },
        onProgress: (e) => {
          setPagesMap(prev => {
            const cur = prev[e.page] ?? createDefaultPage(e.page);
            if (cur.status !== 'completed') {
              return { ...prev, [e.page]: { ...cur, status: 'processing' } };
            }
            return prev;
          });

          setStreamProgress(prev => ({
            total: e.total,
            done: e.done,
            failed: prev?.failed ?? 0,
            currentPage: e.page,
            pct: e.pct,
          }));

          if (e.pages_per_min != null || e.eta_secs != null) {
            setSpeedInfo({ ppm: e.pages_per_min ?? null, eta: e.eta_secs ?? null });
          }

          const speedPart = e.pages_per_min != null ? ` • ${e.pages_per_min} ${t.pagesPerMin}` : '';
          const etaPart = e.eta_secs != null
            ? ` • ${t.etaLabel} ${e.eta_secs < 60 ? e.eta_secs + 's' : Math.round(e.eta_secs / 60) + 'm'}`
            : '';
          setProcessingMsg(
            uiLang === 'ta'
              ? `பகுப்பாய்வு செய்யப்பட்டது: ${e.done} / ${e.total} (பக்கம் ${e.page})${speedPart}${etaPart}`
              : `Processed: ${e.done} / ${e.total} pages (processing p.${e.page})${speedPart}${etaPart}`,
          );
        },
        onPage: (e) => {
          const pr = e.result;
          savePageResult(pr);

          setStreamProgress(prev => {
            if (!prev) return null;
            const newDone = prev.done + (pr.success ? 1 : 0);
            const newFailed = prev.failed + (pr.success ? 0 : 1);
            return {
              ...prev,
              done: newDone,
              failed: newFailed,
              pct: Math.round(((newDone + newFailed) / prev.total) * 100),
            };
          });

          if (e.pages_per_min != null || e.eta_secs != null) {
            setSpeedInfo({ ppm: e.pages_per_min ?? null, eta: e.eta_secs ?? null });
          }
        },
        onDone: (e) => {
          setStreamProgress(prev =>
            prev ? { ...prev, pct: 100, done: (e as any).completed ?? (e.total - e.failed), failed: e.failed, currentPage: null } : null,
          );
          const elapsedPart = e.elapsed_s != null ? ` in ${e.elapsed_s}s` : '';
          const speedPart   = e.pages_per_min != null ? ` • ${e.pages_per_min} ${t.pagesPerMin}` : '';
          setProcessingMsg(
            uiLang === 'ta'
              ? `நிறைவடைந்தது — ${e.total} பக்கங்கள்${elapsedPart}, ${e.failed} தோல்விகள்${speedPart}`
              : `Complete — ${e.total} pages${elapsedPart}, ${e.failed} failure(s)${speedPart}`,
          );
          setModelSwitchMsg(null);
          setProcessing(false);
          abortRef.current = null;

          if (currentDocId) {
            updateDocumentStatus(currentDocId, e.failed > 0 ? 'partial' : 'completed');
          }
        },
        onError: (e) => {
          const msg = e instanceof Error
            ? e.message
            : (e as { message?: string; quota_exhausted?: boolean }).message ?? String(e);
          const isQuota = msg.includes('QUOTA_EXHAUSTED') ||
            (e as { quota_exhausted?: boolean }).quota_exhausted === true;
          if (isQuota) setQuotaExhausted(true);
          setProcessingMsg((uiLang === 'ta' ? 'பிழை: ' : 'Error: ') + msg);
          setModelSwitchMsg(null);
          setProcessing(false);
          abortRef.current = null;
        },
        onModelSwitch: (e) => {
          setActiveModel(e.to_model);
          setModelSwitchMsg(`Model switched (${e.from_model} → ${e.to_model}): ${e.reason}`);
        },
      },
      1,     // concurrency: 1 (sequential)
      2.5,   // delay: 2.5s inter-page
      completedPagesToSkip,
    );

    abortRef.current = ctrl;
  };

  // ── Retry all failed pages ───────────────────────────────────────────────────
  const retryFailed = () => {
    if (!file) return;
    const failed = Object.values(pagesMap)
      .filter(p => p.status === 'failed')
      .map(p => p.page_number)
      .sort((a, b) => a - b);

    if (!failed.length) return;

    setProcessing(true);
    setProcessingMsg(
      uiLang === 'ta'
        ? `${failed.length} தோல்வியுற்ற பக்கங்கள் மீண்டும் முயற்சிக்கப்படுகின்றன…`
        : `Retrying ${failed.length} failed page(s)…`,
    );
    setStreamProgress({ total: failed.length, done: 0, failed: 0, currentPage: null, pct: 0 });

    // Mark as pending retry
    setPagesMap(prev => {
      const next = { ...prev };
      failed.forEach(p => {
        if (next[p]) next[p] = { ...next[p], status: 'pending', error: null };
      });
      return next;
    });

    const ctrl = retryPDFPages(file, failed, lang, enhance, useDigital, {
      onStart: (e) => {
        setStreamProgress({ total: e.total, done: 0, failed: 0, currentPage: null, pct: 0 });
      },
      onProgress: (e) => {
        setPagesMap(prev => {
          const cur = prev[e.page] ?? createDefaultPage(e.page);
          return { ...prev, [e.page]: { ...cur, status: 'processing' } };
        });
        setStreamProgress(prev => ({
          total: e.total, done: e.done,
          failed: prev?.failed ?? 0,
          currentPage: e.page, pct: e.pct,
        }));
        setProcessingMsg(
          uiLang === 'ta'
            ? `மீண்டும் செய்தல்: ${e.done} / ${e.total} (பக்கம் ${e.page})`
            : `Retrying: ${e.done} / ${e.total} pages (p.${e.page})`,
        );
      },
      onPage: (e) => {
        const pr = e.result;
        savePageResult(pr);
      },
      onDone: (e) => {
        setStreamProgress(prev => prev ? { ...prev, pct: 100, currentPage: null } : null);
        setProcessingMsg(
          uiLang === 'ta'
            ? `முடிந்தது — ${(e as any).completed ?? (e.total - e.failed)} பக்கங்கள் வெற்றி, ${e.failed} தோல்வி`
            : `Retry complete — ${(e as any).completed ?? (e.total - e.failed)} succeeded, ${e.failed} still failed`,
        );
        setProcessing(false);
        abortRef.current = null;
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : (e as any).message ?? String(e);
        setProcessingMsg((uiLang === 'ta' ? 'மீள்முயற்சி பிழை: ' : 'Retry error: ') + msg);
        setProcessing(false);
        abortRef.current = null;
      },
    }, 2.5);

    abortRef.current = ctrl;
  };

  // ── Derived counts & stats ───────────────────────────────────────────────────
  const pageList = Object.values(pagesMap).sort((a, b) => a.page_number - b.page_number);
  const totalCount = isPDF ? Math.max(pdfInfo?.page_count ?? 0, pageList.length) : (result ? 1 : 0);
  const completedCount = pageList.filter(p => p.status === 'completed').length;
  const reviewCount    = pageList.filter(p => p.status === 'needs_review').length;
  const failedCount    = pageList.filter(p => p.status === 'failed').length;
  const pendingCount   = pageList.filter(p => p.status === 'pending').length;
  const processedCount = completedCount + reviewCount + failedCount;

  const activePR = isPDF ? pagesMap[activePage] : null;
  const hasTranslation = isPDF ? !!(activePR?.english_translation) : !!(result?.english_translation);
  const hasHindiTranslation = isPDF ? !!(activePR?.hindi_translation) : !!(result?.hindi_translation);
  const baseName = stripBasename(file?.name ?? (restoredDocName ? stripBasename(restoredDocName) : 'output'));
  const hasResult = isPDF ? pageList.length > 0 : !!result;

  const chipVariant = statusErr ? 'error' : !status ? 'warn' : status.ready ? 'ok' : 'warn';
  const chipLabel   = statusErr
    ? t.statusOffline
    : !status ? t.statusConnecting
    : status.ready ? (`${t.statusReady} ` + status.gemini_model)
    : status.api_key_configured ? t.statusSdkMissing
    : t.statusApiKeyMissing;

  const wordCount = editedText.trim() ? editedText.trim().split(/\s+/).length : 0;
  const charCount = editedText.length;

  // Active confidence score & suggested corrections
  const activeConfidence = isPDF ? activePR?.confidence_score : result?.confidence_score;
  const activeCorrections = isPDF ? activePR?.suggested_corrections : result?.suggested_corrections;

  // ── Comprehensive Export Helpers ─────────────────────────────────────────────
  const exportTamilTXT = () => {
    if (isPDF) {
      const header = [
        '========================================================================',
        `TamilVault AI — Tamil Text Export`,
        `File: ${file?.name ?? 'Document.pdf'} | Total Pages: ${totalCount}`,
        `Completed: ${completedCount} | Needs Review: ${reviewCount} | Failed: ${failedCount} | Unprocessed: ${pendingCount}`,
        `Export Date: ${new Date().toLocaleString()}`,
        '========================================================================\n\n',
      ].join('\n');

      const body = pageList.map(p => {
        if (p.status === 'completed' || p.status === 'needs_review') {
          const marker = p.status === 'needs_review' ? ' [NEEDS REVIEW / EMPTY SCAN]' : '';
          return `=== Page ${p.page_number}${marker} ===\n${p.tamil_text || p.cleaned_text || '(Empty text / blank page)'}`;
        }
        if (p.status === 'failed') {
          return `=== Page ${p.page_number} [FAILED: ${p.error || 'Extraction error'}] ===`;
        }
        return `=== Page ${p.page_number} [UNPROCESSED] ===`;
      }).join('\n\n');

      downloadText(header + body, `${baseName}_tamil.txt`);
    } else {
      downloadText(editedText, `${baseName}_tamil.txt`);
    }
  };

  const handleExportPDF = async () => {
    setIsExportingPdf(true);
    setPdfExportError(null);
    try {
      let pagesToExport: PDFExportPageItem[] = [];

      if (!isPDF) {
        pagesToExport = [
          {
            page_number: 1,
            tamil_text: editedText || result?.tamil_text || result?.cleaned_text || '',
            english_translation: editedTranslation || result?.english_translation || null,
            hindi_translation: editedHindiTranslation || result?.hindi_translation || null,
            suggested_corrections: result?.suggested_corrections || null,
            status: result?.success ? 'completed' : 'failed',
            confidence_score: result?.confidence_score ?? 90,
            source: 'ocr',
          },
        ];
      } else {
        let targetNumbers: number[] = [];
        if (pdfExportScope === 'current') {
          targetNumbers = [activePage];
        } else if (pdfExportScope === 'range') {
          targetNumbers = parsePageRangeList(pdfExportRangeStr, totalCount);
          if (targetNumbers.length === 0) {
            throw new Error(
              uiLang === 'ta'
                ? 'செல்லுபடியாகும் பக்க வரம்பை உள்ளிடவும் (எ.கா: 1-5, 8)'
                : uiLang === 'hi'
                ? 'कृपया एक वैध पृष्ठ सीमा दर्ज करें (उदा. 1-5, 8)'
                : 'Please enter a valid page range (e.g. 1-5, 8)',
            );
          }
        } else {
          // 'all'
          targetNumbers = Array.from({ length: totalCount }, (_, i) => i + 1);
        }

        pagesToExport = targetNumbers.map(pNum => {
          const pd = pagesMap[pNum];
          return {
            page_number: pNum,
            tamil_text: pd?.tamil_text || pd?.cleaned_text || '',
            english_translation: pd?.english_translation || null,
            hindi_translation: pd?.hindi_translation || null,
            suggested_corrections: pd?.suggested_corrections || null,
            status: pd?.status || 'pending',
            confidence_score: pd?.confidence_score ?? null,
            source: pd?.source || 'ocr',
          };
        });
      }

      const docTitle = file?.name ? file.name.replace(/\.[^/.]+$/, '') : (restoredDocName ? stripBasename(restoredDocName) : 'TamilVault_Document');
      const blob = await exportDocumentPDF({
        title: docTitle,
        pages: pagesToExport,
        include_tamil: pdfExportIncludeTamil,
        include_translation: pdfExportIncludeTranslation,
        include_hindi: pdfExportIncludeHindi,
        include_notes: pdfExportIncludeNotes,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_export.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setShowPdfExportModal(false);
    } catch (err) {
      setPdfExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const exportEnglishTXT = () => {
    if (isPDF) {
      const header = [
        '========================================================================',
        `TamilVault AI — English Translation Export`,
        `File: ${file?.name ?? (restoredDocName || 'Document.pdf')} | Total Pages: ${totalCount}`,
        `Completed: ${completedCount} | Needs Review: ${reviewCount} | Failed: ${failedCount} | Unprocessed: ${pendingCount}`,
        `Export Date: ${new Date().toLocaleString()}`,
        '========================================================================\n\n',
      ].join('\n');

      const body = pageList.map(p => {
        if (p.english_translation) {
          return `=== Page ${p.page_number} ===\n${p.english_translation}`;
        }
        if (p.status === 'failed') {
          return `=== Page ${p.page_number} [FAILED: ${p.error || 'Extraction error'}] ===`;
        }
        if (p.status === 'completed' || p.status === 'needs_review') {
          return `=== Page ${p.page_number} ===\n(No English translation)`;
        }
        return `=== Page ${p.page_number} [UNPROCESSED] ===`;
      }).join('\n\n');

      downloadText(header + body, `${baseName}_english.txt`);
    } else {
      downloadText(editedTranslation || result?.english_translation || '', `${baseName}_english.txt`);
    }
  };

  const exportHindiTXT = () => {
    if (isPDF) {
      const header = [
        '========================================================================',
        `TamilVault AI — Hindi Translation Export`,
        `File: ${file?.name ?? (restoredDocName || 'Document.pdf')} | Total Pages: ${totalCount}`,
        `Completed: ${completedCount} | Needs Review: ${reviewCount} | Failed: ${failedCount} | Unprocessed: ${pendingCount}`,
        `Export Date: ${new Date().toLocaleString()}`,
        '========================================================================\n\n',
      ].join('\n');

      const body = pageList.map(p => {
        if (p.hindi_translation) {
          return `=== Page ${p.page_number} ===\n${p.hindi_translation}`;
        }
        if (p.status === 'failed') {
          return `=== Page ${p.page_number} [FAILED: ${p.error || 'Extraction error'}] ===`;
        }
        if (p.status === 'completed' || p.status === 'needs_review') {
          return `=== Page ${p.page_number} ===\n(No Hindi translation)`;
        }
        return `=== Page ${p.page_number} [UNPROCESSED] ===`;
      }).join('\n\n');

      downloadText(header + body, `${baseName}_hindi.txt`);
    } else {
      downloadText(editedHindiTranslation || result?.hindi_translation || '', `${baseName}_hindi.txt`);
    }
  };

  const exportCombinedTXT = () => {
    if (isPDF) {
      const header = [
        '========================================================================',
        `TamilVault AI — Combined Tamil & Multilingual Translation Export`,
        `File: ${file?.name ?? (restoredDocName || 'Document.pdf')} | Total Pages: ${totalCount}`,
        `Completed: ${completedCount} | Needs Review: ${reviewCount} | Failed: ${failedCount} | Unprocessed: ${pendingCount}`,
        `Export Date: ${new Date().toLocaleString()}`,
        '========================================================================\n\n',
      ].join('\n');

      const body = pageList.map(p => {
        const marker = p.status === 'needs_review' ? ' [NEEDS REVIEW]' : p.status === 'failed' ? ' [FAILED]' : p.status === 'pending' ? ' [UNPROCESSED]' : '';
        const lines = [
          `=== Page ${p.page_number}${marker} — Tamil Source ===`,
          p.tamil_text || p.cleaned_text || (p.error ? `Error: ${p.error}` : '(Empty text)'),
        ];
        if (p.english_translation) {
          lines.push(`\n--- English Translation ---`, p.english_translation);
        }
        if (p.hindi_translation) {
          lines.push(`\n--- Hindi Translation ---`, p.hindi_translation);
        }
        return lines.join('\n');
      }).join('\n\n');

      downloadText(header + body, `${baseName}_combined.txt`);
    } else {
      let combined = `=== Tamil Original ===\n${editedText}`;
      if (editedTranslation || result?.english_translation) {
        combined += `\n\n=== English Translation ===\n${editedTranslation || result?.english_translation}`;
      }
      if (editedHindiTranslation || result?.hindi_translation) {
        combined += `\n\n=== Hindi Translation ===\n${editedHindiTranslation || result?.hindi_translation}`;
      }
      downloadText(combined, `${baseName}_combined.txt`);
    }
  };

  const exportJSON = () => {
    if (isPDF) {
      downloadJSON({
        document: file?.name ?? restoredDocName,
        total_pages: totalCount,
        summary: {
          completed: completedCount,
          needs_review: reviewCount,
          failed: failedCount,
          pending: pendingCount,
        },
        pages: pageList.map(p => ({
          page_number: p.page_number,
          status: p.status,
          source: p.source,
          tamil_text: p.tamil_text || p.cleaned_text,
          english_translation: p.english_translation,
          hindi_translation: p.hindi_translation,
          confidence_score: p.confidence_score,
          suggested_corrections: p.suggested_corrections,
          error: p.error,
          error_category: p.error_category,
          engine_model: p.engine_model,
        })),
      }, `${baseName}.json`);
    } else if (result) {
      downloadJSON({
        file: file?.name ?? restoredDocName,
        language: lang,
        tamil_text: editedText,
        english_translation: editedTranslation || result.english_translation,
        hindi_translation: editedHindiTranslation || result.hindi_translation,
        confidence_score: result.confidence_score,
        suggested_corrections: result.suggested_corrections,
        success: result.success,
        engine: result.engine,
        engine_model: result.engine_model,
      }, `${baseName}.json`);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="app-bg">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
      </div>

      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="logo-icon">🔤</div>
          <span className="logo-text">{t.appTitle}</span>
        </div>
        <span className="topbar-subtitle">{t.appSubtitle}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Saved Documents Button (Supabase) */}
          <button
            className="history-btn"
            onClick={openHistory}
            title={t.savedDocuments}
            id="saved-docs-btn"
          >
            📁 {t.savedDocuments}
          </button>

          {/* Language Switcher */}
          <div className="lang-toggle" title="Switch UI Language / இடைமுக மொழியை மாற்றுக / भाषा बदलें">
            <button
              className={`lang-toggle-btn ${uiLang === 'ta' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('ta')}
              id="lang-btn-ta"
            >
              தமிழ்
            </button>
            <button
              className={`lang-toggle-btn ${uiLang === 'en' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('en')}
              id="lang-btn-en"
            >
              English
            </button>
            <button
              className={`lang-toggle-btn ${uiLang === 'hi' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('hi')}
              id="lang-btn-hi"
            >
              हिन्दी
            </button>
          </div>

          {status?.pdf_support && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 }}>
              {t.pdfAvailable}
            </span>
          )}

          <div className={'status-chip ' + chipVariant}>
            <span className="status-dot" />
            {chipLabel}
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="main-grid">

        {/* ── LEFT panel ──────────────────────────────────────────────────── */}
        <aside className="left-panel">

          {/* Alerts */}
          {statusErr && (
            <div className="alert error">
              <span className="alert-icon">🔌</span>
              <div>
                <strong>{t.backendOfflineTitle}</strong> {t.backendOfflineDesc}
                <code style={{ display: 'block', marginTop: 6, fontSize: 12, background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: 4 }}>
                  .\start_backend.bat
                </code>
              </div>
            </div>
          )}
          {status && !status.ready && (
            <div className="alert warn">
              <span className="alert-icon">🔑</span>
              <div>{status.diagnostic_message ?? t.apiKeyMissingTitle}</div>
            </div>
          )}

          {/* Quota-exhausted banner */}
          {quotaExhausted && (
            <div className="alert error" style={{ borderLeft: '3px solid #f59e0b' }}>
              <span className="alert-icon">⛔</span>
              <div>
                <strong style={{ color: '#fbbf24' }}>{t.dailyQuotaTitle}</strong>
                <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6 }}>
                  {t.dailyQuotaDesc1}<br />
                  ✓ {t.dailyQuotaDesc2}<br />
                  ✓ {t.dailyQuotaDesc3}<br />
                  <a href="https://aistudio.google.com/app/usage" target="_blank" rel="noreferrer"
                    style={{ color: '#a78bfa', textDecoration: 'underline' }}>
                    {t.checkUsageLink}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Supabase sync notice */}
          {supabaseSyncMsg && isSupabaseConfigured && (
            <div style={{ fontSize: 11, color: '#34d399', background: 'rgba(16,185,129,0.08)', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>☁</span> {supabaseSyncMsg}
            </div>
          )}

          {/* Upload card */}
          <div className="card">
            <p className="card-title">{t.uploadCardTitle}</p>

            {/* Restored session notice */}
            {isRestoredSession && !file && (
              <div style={{
                background: 'rgba(99,112,255,0.08)',
                border: '1px solid rgba(99,112,255,0.25)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: 2 }}>
                  📂 {restoredDocName}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>
                  {t.originalFileMissingNotice}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.45)', marginTop: 4, fontSize: 11 }}>
                  {t.promptReuploadToRun}
                </div>
              </div>
            )}

            <div
              className={'upload-zone' + (dragOver ? ' drag-over' : '')}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ cursor: 'pointer' }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf"
                onChange={onFileInput}
                id="file-input"
                style={{ display: 'none' }}
              />
              <span className="upload-icon">{file ? (isPDF ? '📄' : '🖼️') : '📤'}</span>
              <p className="upload-title">{file ? file.name : (isRestoredSession ? (t.btnUploadFileToRerun + ' (' + restoredDocName + ')') : t.dropzoneTitleEmpty)}</p>
              <p className="upload-sub">
                {file ? (fmtBytes(file.size) + ' · ' + (isPDF ? t.pdfDocumentLabel : (file.type || t.imageDocumentLabel))) : t.supportedFormats}
              </p>
            </div>

            {/* PDF info */}
            {isPDF && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {pdfInfoLoading && (
                  <div style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div className="spinner" style={{ width: 14, height: 14 }} /> {t.readingPdfMeta}
                  </div>
                )}
                {pdfInfo && !pdfInfoLoading && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                      📑 {t.totalPagesLabel} <strong style={{ color: '#c084fc', fontSize: 14 }}>{pdfInfo.page_count}</strong>
                    </span>
                    {pdfInfo.has_digital_text && (
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{t.selectableTextAvailable}</span>
                    )}
                    {pdfInfo.error && <span style={{ color: '#f87171' }}>⚠ {pdfInfo.error}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Image preview */}
          {preview && !isPDF && (
            <div className="image-preview">
              <img src={preview} alt="Preview" />
              <div className="preview-meta">
                <span>{file?.name}</span>
                <span>{file ? fmtBytes(file.size) : ''}</span>
              </div>
            </div>
          )}

          {/* PDF page selection */}
          {isPDF && pdfInfo && pdfInfo.page_count > 0 && (
            <div className="card">
              <p className="card-title">{t.pageSelectionTitle}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {(['all', 'single', 'range'] as const).map(m => (
                  <button
                    key={m}
                    className={'lang-btn' + (pdfPageMode === m ? ' active' : '')}
                    onClick={() => setPdfPageMode(m)}
                    style={{ flex: '1 0 auto' }}
                  >
                    {m === 'all' ? `${t.modeAll} (${pdfInfo.page_count})` : m === 'single' ? t.modeSingle : t.modeRange}
                  </button>
                ))}
              </div>
              {pdfPageMode === 'single' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{t.pageLabel}</label>
                  <input
                    type="number" min={1} max={pdfInfo.page_count} value={pdfSinglePage}
                    onChange={e => setPdfSinglePage(Math.max(1, Math.min(pdfInfo.page_count, Number(e.target.value))))}
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 10px', color: '#fff', width: 80, fontSize: 14 }}
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{t.ofPagesLabel} {pdfInfo.page_count}</span>
                </div>
              )}
              {pdfPageMode === 'range' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{t.pagesLabel}</label>
                  <input
                    type="text" value={pdfRangeStr}
                    onChange={e => setPdfRangeStr(e.target.value)}
                    placeholder="e.g. 1-10, 15, 20-25"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 10px', color: '#fff', fontSize: 13, flex: 1 }}
                  />
                </div>
              )}
              {pdfInfo.has_digital_text && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={useDigital} onChange={e => setUseDigital(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#c084fc' }} />
                  {t.useDigitalTextToggle}
                </label>
              )}
            </div>
          )}

          {/* Output Language selector */}
          <div className="card">
            <p className="card-title">{t.outputLanguageTitle}</p>
            <div className="lang-select-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className={'lang-btn ' + (lang === 'tam+eng' ? 'active' : '')} onClick={() => setLang('tam+eng')}>
                {t.langTamEng}
              </button>
              <button className={'lang-btn ' + (lang === 'tam' ? 'active' : '')} onClick={() => setLang('tam')}>
                {t.langTamOnly}
              </button>
              <button className={'lang-btn ' + (lang === 'eng' ? 'active' : '')} onClick={() => setLang('eng')}>
                {t.langEngOnly}
              </button>
              <button className={'lang-btn ' + (lang === 'tam+eng+hin' ? 'active' : '')} onClick={() => setLang('tam+eng+hin')}>
                {t.langTamEngHin}
              </button>
              <button className={'lang-btn ' + (lang === 'tam+hin' ? 'active' : '')} onClick={() => setLang('tam+hin')}>
                {t.langTamHin}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
              {lang === 'tam+eng' ? t.langTamEngDesc :
               lang === 'tam' ? t.langTamOnlyDesc :
               lang === 'eng' ? t.langEngOnlyDesc :
               lang === 'tam+eng+hin' ? t.langTamEngHinDesc :
               t.langTamHinDesc}
            </p>
          </div>

          {/* Enhancement toggle */}
          <div className="card" style={{ paddingTop: 12, paddingBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={enhance} onChange={e => setEnhance(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#c084fc' }} />
              <div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{t.enhanceTitle}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{t.enhanceDesc}</div>
              </div>
            </label>
          </div>

          {/* Action buttons */}
          <button
            className="btn-primary"
            onClick={() => runOcr(false)}
            disabled={!file || processing || (isPDF && !pdfInfo)}
            id="run-ocr-btn"
          >
            {processing
              ? <><div className="spinner" /> {processingMsg || t.btnProcessing}</>
              : <>{isPDF ? t.btnProcessPdf : t.btnExtractText}</>
            }
          </button>

          {/* Resume processing button if interrupted */}
          {!processing && isPDF && pendingCount > 0 && processedCount > 0 && (
            <button
              onClick={() => runOcr(true)}
              id="resume-ocr-btn"
              style={{
                width: '100%', padding: '11px', border: '1px solid rgba(168,85,247,0.4)',
                borderRadius: 10, background: 'rgba(168,85,247,0.12)', color: '#c084fc',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.18s',
              }}
            >
              ▶ {t.btnResume} ({pendingCount})
            </button>
          )}

          {/* Retry failed pages button */}
          {!processing && isPDF && failedCount > 0 && (
            <button
              onClick={retryFailed}
              id="retry-failed-btn"
              style={{
                width: '100%', padding: '11px', border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: 10, background: 'rgba(245,158,11,0.08)', color: '#fbbf24',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.18s',
              }}
            >
              🔄 {t.btnRetryFailed} ({failedCount})
            </button>
          )}

          {processing && (
            <button
              onClick={cancelProcessing}
              style={{
                width: '100%', padding: '10px', border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 10, background: 'rgba(239,68,68,0.08)', color: '#f87171',
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                transition: 'all 0.18s',
              }}
              id="cancel-btn"
            >
              {t.btnCancel}
            </button>
          )}

          {/* Model switch notification */}
          {modelSwitchMsg && (
            <div style={{ fontSize: 11, color: '#fbbf24', background: 'rgba(245,158,11,0.1)', padding: '6px 10px', borderRadius: 6, borderLeft: '2px solid #f59e0b' }}>
              ℹ {modelSwitchMsg}
            </div>
          )}

          {/* Live Page Processing Tracker */}
          {isPDF && totalCount > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
                  {t.progressTitle}: {processedCount} / {totalCount}
                </span>
                <span style={{ fontSize: 12, color: 'var(--c-primary)', fontWeight: 700 }}>
                  {totalCount ? Math.round((processedCount / totalCount) * 100) : 0}%
                </span>
              </div>

              {/* Progress bar */}
              <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{
                  height: '100%', width: `${totalCount ? Math.round((processedCount / totalCount) * 100) : 0}%`,
                  background: 'linear-gradient(90deg,#6370ff,#a78bfa)',
                  transition: 'width 0.3s ease', borderRadius: 3,
                }} />
              </div>

              {/* 4-way stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', padding: '6px 2px', borderRadius: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{completedCount}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{t.statDone}</div>
                </div>
                <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', padding: '6px 2px', borderRadius: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>{reviewCount}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{t.statReview}</div>
                </div>
                <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', padding: '6px 2px', borderRadius: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: failedCount > 0 ? '#f87171' : 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono)' }}>{failedCount}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{t.statFailed}</div>
                </div>
                <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', padding: '6px 2px', borderRadius: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#9ba3d4', fontFamily: 'var(--font-mono)' }}>{pendingCount}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{t.statPending}</div>
                </div>
              </div>

              {streamProgress?.currentPage && processing && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <div className="spinner" style={{ width: 12, height: 12 }} />
                  {t.processingPageOf} {streamProgress.currentPage} {t.ofPagesLabel} {totalCount}…
                </div>
              )}

              {(activeModel || (speedInfo && (speedInfo.ppm != null || speedInfo.eta != null))) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                  <span>{activeModel ? `Model: ${activeModel}` : ''}</span>
                  {speedInfo && (speedInfo.ppm != null || speedInfo.eta != null) && (
                    <span>
                      {speedInfo.ppm != null ? `${speedInfo.ppm} ${t.pagesPerMin}` : ''}
                      {speedInfo.ppm != null && speedInfo.eta != null ? ' · ' : ''}
                      {speedInfo.eta != null ? `${t.etaLabel} ${speedInfo.eta < 60 ? speedInfo.eta + 's' : Math.round(speedInfo.eta / 60) + 'm'}` : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image summary */}
          {!isPDF && hasResult && result && (
            <div className="card">
              <p className="card-title">{t.imageSummaryTitle}</p>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-value">{wordCount}</div>
                  <div className="metric-label">{t.wordsLabel}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{charCount}</div>
                  <div className="metric-label">{t.charsLabel}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{editedText.split('\n').filter(Boolean).length}</div>
                  <div className="metric-label">{t.linesLabel}</div>
                </div>
              </div>
            </div>
          )}

          {/* Storage Privacy Guarantee Notice */}
          <div style={{
            margin: '8px 4px 16px',
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            lineHeight: 1.4,
            textAlign: 'center',
          }}>
            {t.storagePrivacyNotice}
          </div>
        </aside>

        {/* ── RIGHT panel ──────────────────────────────────────────────────── */}
        <section className="right-panel">

          {/* Tabs */}
          <div className="tab-bar">
            <button className={'tab-btn ' + (activeTab === 'result' ? 'active' : '')} onClick={() => setActiveTab('result')}>
              {lang === 'eng' ? t.tabTamilSource : t.tabTamilText}
            </button>
            {(lang.includes('eng') || hasTranslation) && (
              <button className={'tab-btn ' + (activeTab === 'translation' ? 'active' : '')} onClick={() => setActiveTab('translation')}>
                {t.tabEnglishTranslation}
                {hasTranslation && <span style={{ marginLeft: 6, width: 7, height: 7, borderRadius: '50%', background: '#a3e635', display: 'inline-block' }} />}
              </button>
            )}
            {(lang.includes('hin') || hasHindiTranslation) && (
              <button className={'tab-btn ' + (activeTab === 'hindi' ? 'active' : '')} onClick={() => setActiveTab('hindi')}>
                {t.tabHindiTranslation}
                {hasHindiTranslation && <span style={{ marginLeft: 6, width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
              </button>
            )}
            {hasResult && (
              <button className={'tab-btn ' + (activeTab === 'export' ? 'active' : '')} onClick={() => setActiveTab('export')}>
                {t.tabExport}
              </button>
            )}
          </div>

          {/* PDF Page Navigator: Shows every page 1..N */}
          {isPDF && totalCount > 0 && (
            <div style={{
              display: 'flex', gap: 6, padding: '10px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(0,0,0,0.2)',
              overflowX: 'auto', flexWrap: 'wrap', alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginRight: 6, flexShrink: 0 }}>
                {t.navigatorPagesLabel} (1–{totalCount}):
              </span>
              {Array.from({ length: totalCount }, (_, i) => i + 1).map(pNum => {
                const pd = pagesMap[pNum];
                const st = pd?.status ?? 'pending';
                const isActive = pNum === activePage;

                // Color tokens for page badges
                let borderColor = 'rgba(255,255,255,0.12)';
                let bgColor = 'transparent';
                let textColor = 'rgba(255,255,255,0.5)';
                let badgePrefix = '';

                if (st === 'completed') {
                  borderColor = isActive ? '#a855f7' : 'rgba(16,185,129,0.35)';
                  bgColor = isActive ? 'rgba(168,85,247,0.25)' : 'rgba(16,185,129,0.08)';
                  textColor = isActive ? '#c084fc' : '#10b981';
                  badgePrefix = '✓ ';
                } else if (st === 'needs_review') {
                  borderColor = isActive ? '#f59e0b' : 'rgba(245,158,11,0.4)';
                  bgColor = isActive ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.08)';
                  textColor = '#fbbf24';
                  badgePrefix = '? ';
                } else if (st === 'failed') {
                  borderColor = isActive ? '#ef4444' : 'rgba(239,68,68,0.5)';
                  bgColor = isActive ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.08)';
                  textColor = '#f87171';
                  badgePrefix = '⚠ ';
                } else if (st === 'processing') {
                  borderColor = '#6370ff';
                  bgColor = 'rgba(99,112,255,0.25)';
                  textColor = '#818cf8';
                  badgePrefix = '⏳ ';
                } else {
                  // pending
                  if (isActive) {
                    borderColor = '#a855f7';
                    bgColor = 'rgba(168,85,247,0.15)';
                    textColor = '#c084fc';
                  }
                }

                return (
                  <button
                    key={pNum}
                    onClick={() => goToPage(pNum)}
                    title={`Page ${pNum}: ${st.toUpperCase()}${pd?.error ? ` (${pd.error})` : ''}`}
                    style={{
                      padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      border: `1px solid ${borderColor}`,
                      background: bgColor,
                      color: textColor,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isActive ? 700 : 500,
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                    }}
                  >
                    {badgePrefix}p{pNum}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active Page Header Bar */}
          {isPDF && activePR && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 20px', background: 'rgba(255,255,255,0.02)',
              borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, color: '#e8eaf6' }}>
                  {t.activePageOf} {activePR.page_number} {t.ofPagesLabel} {totalCount}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', fontWeight: 700,
                  background: activePR.status === 'completed' ? 'rgba(16,185,129,0.15)' : activePR.status === 'failed' ? 'rgba(239,68,68,0.15)' : activePR.status === 'needs_review' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.08)',
                  color: activePR.status === 'completed' ? '#10b981' : activePR.status === 'failed' ? '#f87171' : activePR.status === 'needs_review' ? '#fbbf24' : 'rgba(255,255,255,0.5)',
                }}>
                  {activePR.status}
                </span>

                {/* Honest Confidence Badge */}
                {activePR.confidence_score != null && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                    background: activePR.confidence_score >= 80 ? 'rgba(16,185,129,0.15)' : activePR.confidence_score >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                    color: activePR.confidence_score >= 80 ? '#10b981' : activePR.confidence_score >= 50 ? '#fbbf24' : '#f87171',
                  }}>
                    🎯 {t.confidenceScoreLabel} {activePR.confidence_score}%
                  </span>
                )}

                {activePR.engine_model && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
                    {activePR.source === 'digital' ? 'digital text layer' : activePR.engine_model}
                  </span>
                )}
              </div>

              {/* Page specific action */}
              <div style={{ display: 'flex', gap: 8 }}>
                {activePR.status === 'failed' && (
                  <button
                    onClick={() => processSinglePage(activePR.page_number)}
                    disabled={singlePageLoading === activePR.page_number || processing}
                    style={{
                      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                      color: '#f87171', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {singlePageLoading === activePR.page_number ? t.btnProcessing : `${t.btnRetryPage} ${activePR.page_number}`}
                  </button>
                )}
                {activePR.status === 'pending' && (
                  <button
                    onClick={() => processSinglePage(activePR.page_number)}
                    disabled={singlePageLoading === activePR.page_number || processing}
                    style={{
                      background: 'rgba(99,112,255,0.15)', border: '1px solid rgba(99,112,255,0.4)',
                      color: '#818cf8', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {singlePageLoading === activePR.page_number ? t.btnProcessing : `${t.btnProcessPageNow} (${activePR.page_number})`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tab: Tamil Text Result */}
          {activeTab === 'result' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

              {/* Single Image Error */}
              {!isPDF && result && !result.success && result.error && (
                <div className="alert error" style={{ margin: '16px 20px 0' }}>
                  <span className="alert-icon">⚠</span>
                  <span>{result.error}</span>
                </div>
              )}

              {/* Active PDF Page Error Banner */}
              {isPDF && activePR && activePR.status === 'failed' && (
                <div className="alert error" style={{ margin: '16px 20px 0' }}>
                  <span className="alert-icon">⚠</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {t.activePageOf} {activePR.page_number} {t.pageFailedTitle} {activePR.error_category ? `[${activePR.error_category}]` : ''}
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', wordBreak: 'break-word', color: 'rgba(255,255,255,0.8)' }}>
                      {activePR.error ?? 'Error occurred while processing this page.'}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => processSinglePage(activePR.page_number)}
                        disabled={singlePageLoading === activePR.page_number}
                        style={{
                          background: 'rgba(239,68,68,0.2)', border: '1px solid #f87171', color: '#fff',
                          borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        {singlePageLoading === activePR.page_number ? t.btnProcessing : t.btnRetryThisPage}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Active PDF Page Needs Review Banner */}
              {isPDF && activePR && activePR.status === 'needs_review' && (
                <div style={{ margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24', fontSize: 12 }}>
                  ⚠ <strong>{t.needsReviewTitle}</strong>{' '}
                  {!activePR.tamil_text.trim()
                    ? t.needsReviewEmptyScan
                    : t.needsReviewUnclear}
                </div>
              )}

              {/* Scholarly Suggestions / Epigraphical Notes */}
              {activeCorrections && (
                <div style={{ margin: '10px 20px 0', padding: '10px 14px', borderRadius: 8, background: 'rgba(99,112,255,0.08)', border: '1px solid rgba(99,112,255,0.3)', color: '#c084fc', fontSize: 12 }}>
                  📜 <strong>{t.suggestedCorrectionsLabel}</strong>
                  <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.85)' }}>
                    {activeCorrections}
                  </div>
                </div>
              )}

              {/* Active PDF Page Pending Notice */}
              {isPDF && activePR && activePR.status === 'pending' && (
                <div style={{ margin: '24px 20px', padding: 24, textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  <h3 style={{ fontSize: 16, marginBottom: 8 }}>
                    {t.activePageOf} {activePR.page_number} {t.pagePendingTitle}
                  </h3>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: 440, margin: '0 auto 16px' }}>
                    {t.pagePendingDesc}
                  </p>
                  <button
                    onClick={() => processSinglePage(activePR.page_number)}
                    disabled={singlePageLoading === activePR.page_number}
                    style={{
                      background: 'var(--c-primary)', color: '#fff', border: 'none',
                      borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {singlePageLoading === activePR.page_number ? t.btnProcessing : `${t.btnProcessPageNow} (${activePR.page_number})`}
                  </button>
                </div>
              )}

              {/* Active PDF Page Processing Notice */}
              {isPDF && activePR && activePR.status === 'processing' && (
                <div className="empty-state">
                  <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
                  <p style={{ marginTop: 16, fontSize: 14 }}>
                    {t.pageProcessingTitle} {activePR.page_number}…
                  </p>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                    {t.pageProcessingSubtitle}
                  </span>
                </div>
              )}

              {/* Initial Empty state before any file */}
              {!file && (
                <div className="empty-state">
                  <div className="empty-icon">📜</div>
                  <p>{t.initialEmptyTitle}</p>
                  <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.8 }}>
                    {t.initialEmptySubtitle}
                  </div>
                </div>
              )}

              {/* Textarea for completed / editable pages */}
              {((!isPDF && result?.success) || (isPDF && activePR && (activePR.status === 'completed' || activePR.status === 'needs_review' || (activePR.status === 'failed' && activePR.tamil_text)))) && (
                <div style={{ flex: 1, padding: '12px 20px 20px', display: 'flex', flexDirection: 'column' }}>
                  <textarea
                    className="ocr-textarea"
                    value={editedText}
                    onChange={e => handleTamilTextChange(e.target.value)}
                    spellCheck={false}
                    placeholder={t.tamilPlaceholder}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
                    <span>
                      {wordCount} {t.wordsLabel} · {charCount} {t.charsLabel}
                    </span>
                    <span>
                      {activeConfidence != null ? `🎯 ${t.confidenceScoreLabel} ${activeConfidence}% · ` : ''}
                      {isPDF ? `${t.activePageOf} ${activePage} · ${activePR?.source === 'digital' ? 'digital text' : 'Gemini Vision OCR'}` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: English Translation */}
          {activeTab === 'translation' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 20px 20px' }}>
              {isPDF && activePR && activePR.status === 'failed' ? (
                <div className="alert error">
                  <span className="alert-icon">⚠</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.activePageOf} {activePR.page_number} {t.pageFailedTitle}</div>
                    <div style={{ fontSize: 12 }}>{t.translationFailedNotice}</div>
                  </div>
                </div>
              ) : (isPDF && activePR && activePR.status === 'pending') ? (
                <div className="empty-state">
                  <div className="empty-icon">⏳</div>
                  <p>{t.activePageOf} {activePR.page_number}: {t.translationPendingNotice}</p>
                </div>
              ) : hasTranslation ? (
                <>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>🌍 {t.tabEnglishTranslation}</span>
                    {lang === 'eng' && (
                      <span style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                        {t.primaryOutputBadge}
                      </span>
                    )}
                  </div>
                  <textarea
                    className="ocr-textarea"
                    value={editedTranslation}
                    onChange={e => handleTranslationChange(e.target.value)}
                    spellCheck
                    placeholder={t.translationPlaceholder}
                  />
                </>
              ) : (
                <div className="empty-state">
                  {processing
                    ? <><div className="spinner" /><p>{t.translationGenerating}</p></>
                    : <><div className="empty-icon">🌍</div><p>{t.noTranslationForPage}<br />{t.noTranslationPrompt}</p></>
                  }
                </div>
              )}
            </div>
          )}

          {/* Tab: Hindi Translation */}
          {activeTab === 'hindi' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 20px 20px' }}>
              {isPDF && activePR && activePR.status === 'failed' ? (
                <div className="alert error">
                  <span className="alert-icon">⚠</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.activePageOf} {activePR.page_number} {t.pageFailedTitle}</div>
                    <div style={{ fontSize: 12 }}>{t.translationFailedNotice}</div>
                  </div>
                </div>
              ) : (isPDF && activePR && activePR.status === 'pending') ? (
                <div className="empty-state">
                  <div className="empty-icon">⏳</div>
                  <p>{t.activePageOf} {activePR.page_number}: {t.translationPendingNotice}</p>
                </div>
              ) : hasHindiTranslation ? (
                <>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>🇮🇳 {t.tabHindiTranslation}</span>
                  </div>
                  <textarea
                    className="ocr-textarea"
                    value={editedHindiTranslation}
                    onChange={e => handleHindiTranslationChange(e.target.value)}
                    spellCheck
                    placeholder={t.hindiPlaceholder}
                  />
                </>
              ) : (
                <div className="empty-state">
                  {processing
                    ? <><div className="spinner" /><p>{t.translationGenerating}</p></>
                    : <><div className="empty-icon">🇮🇳</div><p>{t.noHindiTranslationForPage}<br />{t.noTranslationPrompt}</p></>
                  }
                </div>
              )}
            </div>
          )}

          {/* Tab: Export */}
          {activeTab === 'export' && (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>
                {t.exportOrderNotice}
              </p>

              {isPDF && totalCount > 0 && (
                <div style={{ padding: '12px 16px', borderRadius: 10, fontSize: 13, background: 'rgba(99,112,255,0.08)', border: '1px solid rgba(99,112,255,0.25)', color: 'rgba(255,255,255,0.8)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: '#c084fc' }}>
                    {t.exportSummaryTitle}
                  </div>
                  <div>
                    ✓ {completedCount + reviewCount} {t.ofPagesLabel} {totalCount} {t.exportReadySummary}
                    {failedCount > 0 && (
                      <span style={{ color: '#f87171', marginLeft: 8 }}>
                        ⚠ {failedCount} {t.exportFailedSummary}
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span style={{ color: '#9ba3d4', marginLeft: 8 }}>
                        ⏳ {pendingCount} {t.exportPendingSummary}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 6, color: 'rgba(255,255,255,0.4)' }}>
                    {t.exportOrderNotice}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  className="export-btn"
                  onClick={() => {
                    setPdfExportRangeStr(isPDF ? `1-${totalCount}` : '1');
                    setPdfExportError(null);
                    setShowPdfExportModal(true);
                  }}
                  style={{
                    gridColumn: 'span 2',
                    border: '1px solid rgba(168,85,247,0.4)',
                    background: 'rgba(168,85,247,0.08)',
                    boxShadow: '0 2px 10px rgba(168,85,247,0.12)',
                  }}
                >
                  <span style={{ fontSize: 24 }}>📕</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#c084fc', fontSize: 14 }}>{t.exportPdf}</div>
                    <div style={{ fontSize: 11, opacity: 0.8, color: '#e8eaf6', marginTop: 2 }}>
                      {t.exportPdfSub}
                    </div>
                  </div>
                </button>

                <button className="export-btn" onClick={exportTamilTXT}>
                  <span>📝</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.exportTamilTxt}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{t.exportTamilTxtSub} (1..{totalCount || 1})</div>
                  </div>
                </button>

                {(lang.includes('eng') || hasTranslation) && (
                  <button className="export-btn" onClick={exportEnglishTXT}>
                    <span>🌍</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.exportEnglishTxt}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>{t.exportEnglishTxtSub}</div>
                    </div>
                  </button>
                )}

                {(lang.includes('hin') || hasHindiTranslation) && (
                  <button className="export-btn" onClick={exportHindiTXT}>
                    <span>🇮🇳</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.exportHindiTxt}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>{t.exportHindiTxtSub}</div>
                    </div>
                  </button>
                )}

                <button className="export-btn" onClick={exportCombinedTXT}>
                  <span>📄</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.exportCombinedTxt}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{t.exportCombinedTxtSub}</div>
                  </div>
                </button>

                <button className="export-btn" onClick={exportJSON}>
                  <span>{'{}'}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.exportJson}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{t.exportJsonSub}</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* ── Saved Documents History Modal (Supabase) ────────────────────────── */}
      {historyOpen && (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e8eaf6' }}>
                {t.historyModalTitle}
              </h3>
              <button
                onClick={() => setHistoryOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {loadingHistory ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.6)' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px' }} />
                  {t.btnProcessing}
                </div>
              ) : recentDocs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {t.historyEmpty}
                </div>
              ) : (
                recentDocs.map(doc => (
                  <div key={doc.id} className="doc-item">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>
                        {doc.filename}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                        {fmtBytes(doc.file_size)} · {doc.total_pages} {doc.total_pages > 1 ? 'pages' : 'page'} · {new Date(doc.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => restoreDocument(doc)}
                      style={{
                        background: 'var(--c-primary)', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {t.btnLoadDocument}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── PDF Export Options Modal ────────────────────────────────────────── */}
      {showPdfExportModal && (
        <div className="modal-backdrop" onClick={() => !isExportingPdf && setShowPdfExportModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📕</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e8eaf6', margin: 0 }}>
                  {t.exportPdfModalTitle}
                </h3>
              </div>
              <button
                disabled={isExportingPdf}
                onClick={() => setShowPdfExportModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ gap: 16 }}>
              {/* Scope Selection */}
              {isPDF && totalCount > 1 && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                    {t.exportScopeLabel}:
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setPdfExportScope('all')}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: pdfExportScope === 'all' ? 'var(--c-primary)' : 'rgba(255,255,255,0.06)',
                        color: pdfExportScope === 'all' ? '#fff' : 'rgba(255,255,255,0.7)',
                        border: '1px solid ' + (pdfExportScope === 'all' ? 'transparent' : 'rgba(255,255,255,0.12)'),
                      }}
                    >
                      {t.exportScopeAll} (1–{totalCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPdfExportScope('current')}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: pdfExportScope === 'current' ? 'var(--c-primary)' : 'rgba(255,255,255,0.06)',
                        color: pdfExportScope === 'current' ? '#fff' : 'rgba(255,255,255,0.7)',
                        border: '1px solid ' + (pdfExportScope === 'current' ? 'transparent' : 'rgba(255,255,255,0.12)'),
                      }}
                    >
                      {t.exportScopeCurrent} (p.{activePage})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPdfExportScope('range')}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: pdfExportScope === 'range' ? 'var(--c-primary)' : 'rgba(255,255,255,0.06)',
                        color: pdfExportScope === 'range' ? '#fff' : 'rgba(255,255,255,0.7)',
                        border: '1px solid ' + (pdfExportScope === 'range' ? 'transparent' : 'rgba(255,255,255,0.12)'),
                      }}
                    >
                      {t.exportScopeRange}
                    </button>
                  </div>

                  {pdfExportScope === 'range' && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        type="text"
                        value={pdfExportRangeStr}
                        onChange={e => setPdfExportRangeStr(e.target.value)}
                        placeholder="e.g. 1-5, 8"
                        style={{
                          width: '100%', padding: '8px 12px', borderRadius: 8,
                          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                          color: '#fff', fontSize: 13,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Inclusions */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                  Sections to Include:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e8eaf6', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pdfExportIncludeTamil}
                      onChange={e => setPdfExportIncludeTamil(e.target.checked)}
                      style={{ accentColor: 'var(--c-primary)' }}
                    />
                    {t.exportIncludeTamil}
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e8eaf6', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pdfExportIncludeTranslation}
                      onChange={e => setPdfExportIncludeTranslation(e.target.checked)}
                      style={{ accentColor: 'var(--c-primary)' }}
                    />
                    {t.exportIncludeTranslation}
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e8eaf6', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pdfExportIncludeHindi}
                      onChange={e => setPdfExportIncludeHindi(e.target.checked)}
                      style={{ accentColor: 'var(--c-primary)' }}
                    />
                    {t.exportIncludeHindi}
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e8eaf6', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pdfExportIncludeNotes}
                      onChange={e => setPdfExportIncludeNotes(e.target.checked)}
                      style={{ accentColor: 'var(--c-primary)' }}
                    />
                    {t.exportIncludeNotes}
                  </label>
                </div>
              </div>

              {/* Error Notice */}
              {pdfExportError && (
                <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12 }}>
                  ⚠ {pdfExportError}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  disabled={isExportingPdf}
                  onClick={() => setShowPdfExportModal(false)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  {t.btnClose}
                </button>
                <button
                  type="button"
                  disabled={isExportingPdf || (!pdfExportIncludeTamil && !pdfExportIncludeTranslation)}
                  onClick={handleExportPDF}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: 'var(--g-primary)', color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: isExportingPdf ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    boxShadow: '0 2px 10px rgba(99,112,255,0.4)',
                  }}
                >
                  {isExportingPdf ? (
                    <>
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                      {t.exportGeneratingPdf}
                    </>
                  ) : (
                    <>
                      <span>⬇</span> {t.btnDownloadPdf}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}