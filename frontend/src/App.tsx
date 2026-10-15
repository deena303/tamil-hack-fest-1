import { useCallback, useEffect, useState } from 'react';
import './index.css';
import { fetchStatus, runOCR } from './api';
import type { OCRResult, SystemStatus, WordConfidence } from './api';

// ── Language options ──────────────────────────────────────────────────────────
const LANG_OPTIONS = [
  { code: 'tam+eng', label: 'Tamil + English' },
  { code: 'tam',     label: 'Tamil only' },
  { code: 'eng',     label: 'English only' },
];

// ── Confidence colour helper ──────────────────────────────────────────────────
function confClass(conf: number): string {
  if (conf >= 70) return 'high';
  if (conf >= 40) return 'medium';
  return 'low';
}

// ── Export helpers ────────────────────────────────────────────────────────────
function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
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

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus]         = useState<SystemStatus | null>(null);
  const [statusErr, setStatusErr]   = useState(false);
  const [file, setFile]             = useState<File | null>(null);
  const [preview, setPreview]       = useState<string | null>(null);
  const [lang, setLang]             = useState('tam+eng');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress]     = useState(0);
  const [result, setResult]         = useState<OCRResult | null>(null);
  const [editedText, setEditedText] = useState('');
  const [activeTab, setActiveTab]   = useState<'result' | 'confidence' | 'review' | 'export'>('result');
  const [dragOver, setDragOver]     = useState(false);
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  // Review: words with confidence < 50
  const lowConfWords: WordConfidence[] = (result?.words_with_confidence ?? [])
    .filter(w => w.confidence >= 0 && w.confidence < 50);

  // ── Poll backend status on mount ─────────────────────────────────────────
  useEffect(() => {
    fetchStatus()
      .then(s => setStatus(s))
      .catch(() => setStatusErr(true));
  }, []);

  // ── File selection ───────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setEditedText('');
    setCorrections({});
    const url = URL.createObjectURL(f);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  // ── Run OCR ──────────────────────────────────────────────────────────────
  const runOcr = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress(0);
    setResult(null);
    setActiveTab('result');

    try {
      const res = await runOCR(file, lang, p => setProgress(p));
      setResult(res);
      setEditedText(res.cleaned_text || res.raw_text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({
        success: false,
        raw_text: '',
        cleaned_text: '',
        words_with_confidence: [],
        regions_found: 0,
        engine: 'gemini',
        engine_model: '',
        api_key_configured: false,
        language: lang,
        error: `Network error: ${msg}. Is the backend running on port 8000?`,
      });
    } finally {
      setProcessing(false);
      setProgress(100);
    }
  };

  // ── Status chip ──────────────────────────────────────────────────────────
  const chipVariant = statusErr
    ? 'error'
    : !status
    ? 'warn'
    : status.ready
    ? 'ok'
    : 'warn';

  const chipLabel = statusErr
    ? 'Backend offline'
    : !status
    ? 'Connecting…'
    : status.ready
    ? `✦ Gemini ${status.gemini_model}`
    : status.api_key_configured
    ? 'Gemini SDK missing'
    : 'API key not set';

  // ── Average confidence ───────────────────────────────────────────────────
  const avgConf = result?.words_with_confidence.length
    ? Math.round(
        result.words_with_confidence
          .filter(w => w.confidence >= 0)
          .reduce((sum, w) => sum + w.confidence, 0) /
        result.words_with_confidence.filter(w => w.confidence >= 0).length
      )
    : null;

  // ── Word count ───────────────────────────────────────────────────────────
  const wordCount = editedText.trim() ? editedText.trim().split(/\s+/).length : 0;

  // ── Final text with corrections applied ──────────────────────────────────
  const finalText = Object.entries(corrections).reduce(
    (text, [word, corrected]) =>
      corrected ? text.replaceAll(word, corrected) : text,
    editedText
  );

  return (
    <>
      {/* Ambient background orbs */}
      <div className="app-bg">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
      </div>

      {/* ── Topbar ────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="logo-icon">🔤</div>
          <span className="logo-text">தரவு</span>
        </div>
        <span className="topbar-subtitle">Tamil OCR Engine</span>
        <div className={`status-chip ${chipVariant}`}>
          <span className="status-dot" />
          {chipLabel}
        </div>
      </header>

      {/* ── Main two-panel grid ───────────────────────────────────────── */}
      <main className="main-grid">

        {/* ── LEFT: upload + controls ─────────────────────────────────── */}
        <aside className="left-panel">

          {/* Backend offline */}
          {statusErr && (
            <div className="alert error">
              <span className="alert-icon">🔌</span>
              <div>
                <strong>Backend offline.</strong> Start the backend with:
                <code style={{ display: 'block', marginTop: 6, fontSize: 12, background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: 4 }}>
                  .venv\Scripts\python -m uvicorn main:app --reload
                </code>
                (run from the <code>backend/</code> directory)
              </div>
            </div>
          )}

          {/* Gemini API key not configured */}
          {status && !status.ready && (
            <div className="alert warn">
              <span className="alert-icon">🔑</span>
              <div>
                {status.diagnostic_message
                  ? status.diagnostic_message
                  : <><strong>Gemini API key not set.</strong>{' '}
                    Add <code>GEMINI_API_KEY=your_key</code> to{' '}
                    <code>backend/.env</code> and restart the backend.{' '}
                    Get a free key at{' '}
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer"
                      style={{ color: 'inherit', textDecoration: 'underline' }}>
                      aistudio.google.com
                    </a>.
                  </>
                }
              </div>
            </div>
          )}

          {/* Upload zone */}
          <div className="card">
            <p className="card-title">📂 Upload Image</p>
            <div
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp"
                onChange={onFileInput}
                id="file-input"
              />
              <span className="upload-icon">{file ? '🖼️' : '📤'}</span>
              <p className="upload-title">
                {file ? file.name : 'Drop image or click to browse'}
              </p>
              <p className="upload-sub">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · ${file.type || 'unknown type'}`
                  : 'JPEG · PNG · TIFF · BMP'}
              </p>
            </div>
          </div>

          {/* Image preview */}
          {preview && (
            <div className="image-preview">
              <img src={preview} alt="Uploaded preview" />
              <div className="preview-meta">
                <span>{file?.name}</span>
                <span>{file ? `${(file.size / 1024).toFixed(0)} KB` : ''}</span>
              </div>
            </div>
          )}

          {/* Language selector */}
          <div className="card">
            <p className="card-title">🌐 Language</p>
            <div className="lang-select-row">
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  className={`lang-btn ${lang === opt.code ? 'active' : ''}`}
                  onClick={() => setLang(opt.code)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            className="btn-primary"
            onClick={runOcr}
            disabled={!file || processing}
            id="run-ocr-btn"
          >
            {processing ? (
              <><div className="spinner" /> Processing…</>
            ) : (
              <> ✨ Extract Text</>
            )}
          </button>

          {/* Result summary stats */}
          {result?.success && (
            <div className="card">
              <p className="card-title">📊 Result Summary</p>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-value">{wordCount}</div>
                  <div className="metric-label">Words</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{editedText.split('\n').filter(Boolean).length}</div>
                  <div className="metric-label">Lines</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value" style={{ fontSize: 13 }}>{result.engine_model || 'Gemini'}</div>
                  <div className="metric-label">Engine</div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ── RIGHT: tabbed result panels ─────────────────────────────── */}
        <section className="right-panel">
          <nav className="tabs">
            {[
              { id: 'result',     icon: '📄', label: 'OCR Text' },
              { id: 'confidence', icon: '🎯', label: 'Confidence' },
              { id: 'review',     icon: '✏️', label: `Review (${lowConfWords.length})` },
              { id: 'export',     icon: '💾', label: 'Export' },
            ].map(t => (
              <button
                key={t.id}
                className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id as typeof activeTab)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">

            {/* Progress bar */}
            {processing && (
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* ── Tab: OCR Text ────────────────────────────────────────── */}
            {activeTab === 'result' && (
              <>
                {!result && !processing && (
                  <div className="empty-state">
                    <span className="empty-icon">🔍</span>
                    <p className="empty-title">No result yet</p>
                    <p className="empty-sub">
                      Upload an image and click <strong>Extract Text</strong> to run the
                      Tamil OCR pipeline.
                    </p>
                  </div>
                )}

                {result?.error && (
                  <div className="alert error" style={{ marginBottom: 16 }}>
                    <span className="alert-icon">❌</span>
                    <div><strong>Error:</strong> {result.error}</div>
                  </div>
                )}

                {result?.success && (
                  <>
                    <div className="result-header">
                      <h2 className="result-title">Extracted Text</h2>
                      <div className="result-actions">
                        <button
                          className="btn-secondary"
                          onClick={() => navigator.clipboard.writeText(finalText)}
                          title="Copy to clipboard"
                        >
                          📋 Copy
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => setEditedText(result.raw_text)}
                          title="Reset to raw OCR output"
                        >
                          ↺ Raw
                        </button>
                      </div>
                    </div>

                    <textarea
                      className="ocr-textarea"
                      value={editedText}
                      onChange={e => setEditedText(e.target.value)}
                      spellCheck={false}
                      placeholder="OCR output will appear here…"
                      id="ocr-output-textarea"
                    />

                    <div className="alert success" style={{ marginTop: 12 }}>
                      <span className="alert-icon">✅</span>
                      <div>
                        Transcription complete via <strong>{result.engine_model || 'Gemini'}</strong>.
                        Language: <strong>{result.language}</strong>. You can edit the text above.
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Tab: Confidence view ──────────────────────────────────── */}
            {activeTab === 'confidence' && (
              <>
                {!result?.success ? (
                  <div className="empty-state">
                    <span className="empty-icon">🎯</span>
                    <p className="empty-title">Run OCR first</p>
                    <p className="empty-sub">Confidence information will appear here after extraction.</p>
                  </div>
                ) : (
                  <>
                    <div className="result-header">
                      <h2 className="result-title">Confidence</h2>
                    </div>
                    <div className="alert warn" style={{ marginBottom: 16 }}>
                      <span className="alert-icon">ℹ️</span>
                      <div>
                        <strong>Per-word confidence scores are not available</strong> when using the
                        Gemini Vision engine. Gemini returns the full transcription as a single
                        response without exposing per-token probabilities.
                        <br /><br />
                        Use the <strong>Review</strong> tab to manually inspect and correct
                        any uncertain words marked as <code>[unclear]</code> in the transcription.
                      </div>
                    </div>
                    {/* Show [unclear] markers found in the text */}
                    {(() => {
                      const unclearCount = (editedText.match(/\[unclear\]/gi) ?? []).length;
                      return unclearCount > 0 ? (
                        <div className="alert error" style={{ marginTop: 0 }}>
                          <span className="alert-icon">⚠️</span>
                          <div>
                            <strong>{unclearCount} unreadable section{unclearCount > 1 ? 's' : ''}</strong>{' '}
                            marked as <code>[unclear]</code> in the transcription.
                            Review them manually in the <strong>Review</strong> tab.
                          </div>
                        </div>
                      ) : (
                        <div className="alert success">
                          <span className="alert-icon">✅</span>
                          <div>No <code>[unclear]</code> markers — the image appears fully readable.</div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* ── Tab: Human review ─────────────────────────────────────── */}
            {activeTab === 'review' && (
              <>
                {!result?.success ? (
                  <div className="empty-state">
                    <span className="empty-icon">✏️</span>
                    <p className="empty-title">Run OCR first</p>
                    <p className="empty-sub">
                      Words marked <code>[unclear]</code> by Gemini will appear here for manual correction.
                    </p>
                  </div>
                ) : (() => {
                  // Find [unclear] sections in the raw transcription
                  const unclearMatches = Array.from(
                    (result.raw_text || '').matchAll(/\[unclear\]/gi)
                  );
                  return unclearMatches.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-icon">🎉</span>
                      <p className="empty-title">Nothing to review!</p>
                      <p className="empty-sub">
                        Gemini did not mark any sections as <code>[unclear]</code>.
                        You can still edit the transcription directly in the <strong>OCR Text</strong> tab.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="result-header">
                        <h2 className="result-title">Human Review</h2>
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setEditedText(finalText);
                            setActiveTab('result');
                          }}
                        >
                          ✓ Apply Corrections
                        </button>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginBottom: 16 }}>
                        Gemini marked {unclearMatches.length} section{unclearMatches.length > 1 ? 's' : ''}{' '}
                        as <code>[unclear]</code>. Replace each with a manual transcription,
                        or leave the field blank to keep <code>[unclear]</code>.
                      </p>
                      <div className="review-list">
                        {unclearMatches.map((_, i) => (
                          <div key={i} className="review-item">
                            <span className="review-word">[unclear #{i + 1}]</span>
                            <span className="review-conf" style={{ color: '#fca5a5' }}>unreadable</span>
                            <input
                              className="review-input"
                              placeholder="Type the correct text here…"
                              value={corrections[`[unclear_${i}]`] ?? ''}
                              onChange={e =>
                                setCorrections(prev => ({ ...prev, [`[unclear_${i}]`]: e.target.value }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </>
            )}

            {/* ── Tab: Export ───────────────────────────────────────────── */}
            {activeTab === 'export' && (
              <>
                {!result?.success ? (
                  <div className="empty-state">
                    <span className="empty-icon">💾</span>
                    <p className="empty-title">Nothing to export</p>
                    <p className="empty-sub">Run OCR first to generate exportable text.</p>
                  </div>
                ) : (
                  <>
                    <div className="result-header">
                      <h2 className="result-title">Export</h2>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginBottom: 20 }}>
                      Export includes any corrections you made in the Review tab.
                    </p>
                    <div className="export-grid">
                      <button
                        className="export-btn"
                        onClick={() => downloadText(finalText, 'tamil_ocr_output.txt')}
                      >
                        <span className="export-btn-icon">📄</span>
                        Plain Text
                      </button>
                      <button
                        className="export-btn"
                        onClick={() => downloadJSON({
                          file: file?.name,
                          language: result.language,
                          engine: result.engine,
                          engine_model: result.engine_model,
                          raw_text: result.raw_text,
                          cleaned_text: result.cleaned_text,
                          edited_text: finalText,
                          corrections,
                        }, 'tamil_ocr_result.json')}
                      >
                        <span className="export-btn-icon">🔧</span>
                        JSON (full)
                      </button>
                      <button
                        className="export-btn"
                        onClick={() => {
                          const csv = [
                            'word,confidence',
                            ...result.words_with_confidence.map(
                              w => `"${w.word.replace(/"/g, '""')}",${w.confidence}`
                            )
                          ].join('\n');
                          downloadText(csv, 'confidence_scores.csv');
                        }}
                      >
                        <span className="export-btn-icon">📊</span>
                        CSV (conf.)
                      </button>
                      <button
                        className="export-btn"
                        onClick={() => {
                          const raw = result.raw_text;
                          downloadText(raw, 'raw_ocr_output.txt');
                        }}
                      >
                        <span className="export-btn-icon">🗒️</span>
                        Raw OCR
                      </button>
                    </div>

                    <div style={{ marginTop: 28 }}>
                      <p className="card-title">📋 Final Text Preview</p>
                      <textarea
                        className="ocr-textarea"
                        readOnly
                        value={finalText}
                        style={{ minHeight: 200 }}
                      />
                    </div>
                  </>
                )}
              </>
            )}

          </div>{/* tab-content */}
        </section>

      </main>
    </>
  );
}
