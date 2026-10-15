// i18n.tsx — Centralized Internationalization Dictionary for TamilVault AI
// Provides comprehensive English, Tamil (தமிழ்), and Hindi (हिन्दी) UI translations.

import React, { createContext, useContext, useState } from 'react';

export type UILanguage = 'en' | 'ta' | 'hi';

export interface Translations {
  // Topbar & Navigation
  appTitle: string;
  appSubtitle: string;
  statusConnecting: string;
  statusOffline: string;
  statusReady: string;
  statusApiKeyMissing: string;
  statusSdkMissing: string;
  pdfAvailable: string;
  switchLangEn: string;
  switchLangTa: string;
  switchLangHi: string;
  cloudSync: string;
  cloudSyncSaved: string;
  savedDocuments: string;

  // Alerts
  backendOfflineTitle: string;
  backendOfflineDesc: string;
  apiKeyMissingTitle: string;
  dailyQuotaTitle: string;
  dailyQuotaDesc1: string;
  dailyQuotaDesc2: string;
  dailyQuotaDesc3: string;
  checkUsageLink: string;

  // Upload Section
  uploadCardTitle: string;
  dropzoneTitleEmpty: string;
  dropzoneTitleSelected: string;
  supportedFormats: string;
  pdfDocumentLabel: string;
  imageDocumentLabel: string;
  readingPdfMeta: string;
  totalPagesLabel: string;
  selectableTextAvailable: string;

  // Page Selection
  pageSelectionTitle: string;
  modeAll: string;
  modeSingle: string;
  modeRange: string;
  pageLabel: string;
  pagesLabel: string;
  ofPagesLabel: string;
  useDigitalTextToggle: string;

  // Output Language
  outputLanguageTitle: string;
  langTamEng: string;
  langTamOnly: string;
  langEngOnly: string;
  langTamEngHin: string;
  langTamHin: string;
  langTamEngDesc: string;
  langTamOnlyDesc: string;
  langEngOnlyDesc: string;
  langTamEngHinDesc: string;
  langTamHinDesc: string;

  // Scan Enhancement
  enhanceTitle: string;
  enhanceDesc: string;

  // Actions
  btnExtractText: string;
  btnProcessPdf: string;
  btnProcessing: string;
  btnResume: string;
  btnRetryFailed: string;
  btnCancel: string;

  // Progress & Stats Tracker
  progressTitle: string;
  statDone: string;
  statReview: string;
  statFailed: string;
  statPending: string;
  processingPageOf: string;
  pagesPerMin: string;
  etaLabel: string;

  // Image Summary
  imageSummaryTitle: string;
  wordsLabel: string;
  charsLabel: string;
  linesLabel: string;

  // Result Tabs
  tabTamilSource: string;
  tabTamilText: string;
  tabEnglishTranslation: string;
  tabHindiTranslation: string;
  tabExport: string;
  primaryOutputBadge: string;

  // Page Navigator
  navigatorPagesLabel: string;
  activePageOf: string;
  btnRetryPage: string;
  btnProcessPageNow: string;

  // Page State Banners
  pageFailedTitle: string;
  btnRetryThisPage: string;
  needsReviewTitle: string;
  needsReviewEmptyScan: string;
  needsReviewUnclear: string;
  pagePendingTitle: string;
  pagePendingDesc: string;
  pageProcessingTitle: string;
  pageProcessingSubtitle: string;
  initialEmptyTitle: string;
  initialEmptySubtitle: string;
  tamilPlaceholder: string;
  translationPlaceholder: string;
  hindiPlaceholder: string;
  confidenceScoreLabel: string;
  suggestedCorrectionsLabel: string;

  // Translation Tab Messages
  translationFailedNotice: string;
  translationPendingNotice: string;
  translationGenerating: string;
  noTranslationForPage: string;
  noTranslationPrompt: string;
  noHindiTranslationForPage: string;

  // Export Section
  exportSummaryTitle: string;
  exportReadySummary: string;
  exportFailedSummary: string;
  exportPendingSummary: string;
  exportOrderNotice: string;
  exportTamilTxt: string;
  exportTamilTxtSub: string;
  exportEnglishTxt: string;
  exportEnglishTxtSub: string;
  exportHindiTxt: string;
  exportHindiTxtSub: string;
  exportCombinedTxt: string;
  exportCombinedTxtSub: string;
  exportJson: string;
  exportJsonSub: string;
  exportPdf: string;
  exportPdfSub: string;
  exportPdfModalTitle: string;
  exportScopeLabel: string;
  exportScopeAll: string;
  exportScopeCurrent: string;
  exportScopeRange: string;
  exportIncludeTamil: string;
  exportIncludeTranslation: string;
  exportIncludeHindi: string;
  exportIncludeNotes: string;
  exportGeneratingPdf: string;
  btnDownloadPdf: string;

  // Cloud History Modal & Restored State
  historyModalTitle: string;
  historyEmpty: string;
  btnLoadDocument: string;
  btnClose: string;
  documentSavedNotice: string;
  originalFileMissingNotice: string;
  promptReuploadToRun: string;
  btnUploadFileToRerun: string;
  storagePrivacyNotice: string;
}

export const translations: Record<UILanguage, Translations> = {
  en: {
    // Topbar & Navigation
    appTitle: 'Tharavu',
    appSubtitle: 'TamilVault AI — OCR & Translation Engine',
    statusConnecting: 'Connecting…',
    statusOffline: 'Backend offline',
    statusReady: '✦ Gemini',
    statusApiKeyMissing: 'API key not set',
    statusSdkMissing: 'Gemini SDK missing',
    pdfAvailable: 'PDF ✓',
    switchLangEn: 'English',
    switchLangTa: 'தமிழ்',
    switchLangHi: 'हिन्दी',
    cloudSync: 'Supabase Cloud Sync',
    cloudSyncSaved: 'Saved to Supabase',
    savedDocuments: 'Saved Documents',

    // Alerts
    backendOfflineTitle: 'Backend offline.',
    backendOfflineDesc: 'Start the backend server on port 8001:',
    apiKeyMissingTitle: 'Gemini API key not configured.',
    dailyQuotaTitle: 'Daily Quota Limit Reached',
    dailyQuotaDesc1: 'Gemini API reported quota exhaustion.',
    dailyQuotaDesc2: 'All pages extracted so far remain safely saved.',
    dailyQuotaDesc3: 'Use Resume or Retry Failed Pages once quota refreshes.',
    checkUsageLink: 'Check usage → aistudio.google.com/app/usage',

    // Upload Section
    uploadCardTitle: '📂 Upload File',
    dropzoneTitleEmpty: 'Drop image or PDF here',
    dropzoneTitleSelected: 'Selected File:',
    supportedFormats: 'JPEG · PNG · TIFF · BMP · PDF',
    pdfDocumentLabel: 'PDF Document',
    imageDocumentLabel: 'Image Document',
    readingPdfMeta: 'Reading PDF metadata…',
    totalPagesLabel: 'Total pages:',
    selectableTextAvailable: '✓ Selectable text available',

    // Page Selection
    pageSelectionTitle: '📑 Page Selection',
    modeAll: 'All',
    modeSingle: 'Single page',
    modeRange: 'Page range',
    pageLabel: 'Page:',
    pagesLabel: 'Pages:',
    ofPagesLabel: 'of',
    useDigitalTextToggle: 'Use embedded text layer when available',

    // Output Language
    outputLanguageTitle: '🌐 Output Language',
    langTamEng: 'Tamil + English',
    langTamOnly: 'Tamil only',
    langEngOnly: 'English only',
    langTamEngHin: 'Tamil + English + Hindi',
    langTamHin: 'Tamil + Hindi',
    langTamEngDesc: 'Extract Tamil text and provide English translation',
    langTamOnlyDesc: 'Faithful Tamil transcription only (no translation)',
    langEngOnlyDesc: 'Translate Tamil to English (English is primary output)',
    langTamEngHinDesc: 'Extract Tamil text and provide English and Hindi translations',
    langTamHinDesc: 'Extract Tamil text and provide Hindi translation',

    // Scan Enhancement
    enhanceTitle: '🔆 Enhance for aged scans',
    enhanceDesc: 'Contrast & sharpness boost for historical documents & inscriptions',

    // Actions
    btnExtractText: '✨ Extract Text',
    btnProcessPdf: '📄 Process PDF Pages',
    btnProcessing: 'Processing…',
    btnResume: '▶ Resume Processing',
    btnRetryFailed: '🔄 Retry Failed Pages',
    btnCancel: '✕ Cancel Processing',

    // Progress & Stats Tracker
    progressTitle: 'Live Page Processing Tracker',
    statDone: 'Done',
    statReview: 'Review',
    statFailed: 'Failed',
    statPending: 'Pending',
    processingPageOf: 'Processing page',
    pagesPerMin: 'p/min',
    etaLabel: 'ETA',

    // Image Summary
    imageSummaryTitle: '📊 Image Summary',
    wordsLabel: 'Words',
    charsLabel: 'Chars',
    linesLabel: 'Lines',

    // Result Tabs
    tabTamilSource: '🔤 Tamil Source',
    tabTamilText: '🔤 Tamil Text',
    tabEnglishTranslation: '🌍 English Translation',
    tabHindiTranslation: '🇮🇳 Hindi Translation',
    tabExport: '💾 Export',
    primaryOutputBadge: 'primary output',

    // Page Navigator
    navigatorPagesLabel: 'Pages',
    activePageOf: 'Page',
    btnRetryPage: '🔄 Retry Page',
    btnProcessPageNow: '▶ Process Page Now',

    // Page State Banners
    pageFailedTitle: 'Extraction Failed',
    btnRetryThisPage: '🔄 Retry This Page',
    needsReviewTitle: 'Needs Review:',
    needsReviewEmptyScan: 'No text was detected on this page (blank or unreadable scan). You may verify or enter text manually below.',
    needsReviewUnclear: 'This page contains weathered segments marked with [unclear]. Review suggested corrections below.',
    pagePendingTitle: 'This page has not been processed yet',
    pagePendingDesc: 'Click "Process Page Now" to extract this specific page, or run "Process PDF Pages" in the sidebar.',
    pageProcessingTitle: 'Extracting text from page',
    pageProcessingSubtitle: 'Results will appear here immediately upon completion',
    initialEmptyTitle: 'Upload a Tamil historical document (PDF or image) to begin',
    initialEmptySubtitle: 'Full multi-page PDF processing · Zero lost pages · Historical Tamil transcription',
    tamilPlaceholder: 'Extracted Tamil text will appear here…',
    translationPlaceholder: 'English translation will appear here…',
    hindiPlaceholder: 'Hindi translation will appear here…',
    confidenceScoreLabel: 'Confidence Score',
    suggestedCorrectionsLabel: 'Suggested Readings / Corrections',

    // Translation Tab Messages
    translationFailedNotice: 'Cannot generate translation because text extraction failed.',
    translationPendingNotice: 'This page is pending extraction.',
    translationGenerating: 'Generating translation…',
    noTranslationForPage: 'No English translation for this page.',
    noTranslationPrompt: 'Select "Tamil + English" or "English only" to generate translations.',
    noHindiTranslationForPage: 'No Hindi translation for this page.',

    // Export Section
    exportSummaryTitle: 'Export Status Summary',
    exportReadySummary: 'pages ready for download.',
    exportFailedSummary: 'pages failed (marked as [FAILED] in export).',
    exportPendingSummary: 'pages unprocessed (marked as [UNPROCESSED] in export).',
    exportOrderNotice: 'Export includes all pages in exact document order with Tamil Unicode intact.',
    exportTamilTxt: 'Tamil Text (.txt)',
    exportTamilTxtSub: 'Full original Tamil transcription',
    exportEnglishTxt: 'English Translation (.txt)',
    exportEnglishTxtSub: 'English translation only across all pages',
    exportHindiTxt: 'Hindi Translation (.txt)',
    exportHindiTxtSub: 'Hindi translation only across all pages',
    exportCombinedTxt: 'Combined (.txt)',
    exportCombinedTxtSub: 'Side-by-side Tamil + translations with page markers',
    exportJson: 'Structured JSON (.json)',
    exportJsonSub: 'JSON export with page statuses, error logs & metadata',
    exportPdf: 'Export as PDF (.pdf)',
    exportPdfSub: 'Archival document with native Tamil Unicode & layout',
    exportPdfModalTitle: 'Export Document as PDF',
    exportScopeLabel: 'Page Scope',
    exportScopeAll: 'All Pages',
    exportScopeCurrent: 'Current Page Only',
    exportScopeRange: 'Custom Page Range (e.g. 1-5, 8)',
    exportIncludeTamil: 'Include Tamil Transcription',
    exportIncludeTranslation: 'Include English Translation',
    exportIncludeHindi: 'Include Hindi Translation',
    exportIncludeNotes: 'Include Scholarly Notes & Corrections',
    exportGeneratingPdf: 'Generating PDF document with Tamil Unicode…',
    btnDownloadPdf: 'Download PDF',

    // Cloud History Modal & Restored State
    historyModalTitle: '📁 Saved Documents in Supabase',
    historyEmpty: 'No documents saved in Supabase yet. Process an image or PDF to save it automatically.',
    btnLoadDocument: 'Open Document',
    btnClose: 'Close',
    documentSavedNotice: 'Document and pages synced to Supabase.',
    originalFileMissingNotice: 'Notice: Document text and metadata restored from Supabase. Original scan file is kept strictly temporary and is not stored in cloud storage.',
    promptReuploadToRun: 'To run OCR again on additional pages, please select and re-upload the original file.',
    btnUploadFileToRerun: '📁 Select Original File to Re-run OCR',
    storagePrivacyNotice: '🔒 Privacy Guaranteed: Original scan files remain temporary and are never uploaded to cloud storage buckets.',
  },

  ta: {
    // Topbar & Navigation
    appTitle: 'தரவு',
    appSubtitle: 'தமிழ்வால்ட் AI — தமிழ் வரலாற்று உரைத்தெரிவு மற்றும் மொழிபெயர்ப்பு பொறி',
    statusConnecting: 'இணைக்கப்படுகிறது…',
    statusOffline: 'பின்னணி முடங்கியுள்ளது',
    statusReady: '✦ ஜெமினி',
    statusApiKeyMissing: 'API சாவி அமைக்கப்படவில்லை',
    statusSdkMissing: 'ஜெமினி SDK இல்லை',
    pdfAvailable: 'PDF ✓',
    switchLangEn: 'English',
    switchLangTa: 'தமிழ்',
    switchLangHi: 'हिन्दी',
    cloudSync: 'சூபாபேஸ் கிளவுட் ஒத்திசைவு',
    cloudSyncSaved: 'சூபாபேஸில் சேமிக்கப்பட்டது',
    savedDocuments: 'சேமிக்கப்பட்ட ஆவணங்கள்',

    // Alerts
    backendOfflineTitle: 'பின்னணி சேவையகம் முடங்கியுள்ளது.',
    backendOfflineDesc: 'முனையத்தில் பின்னணி சேவையகத்தைத் தொடங்குக (Port 8001):',
    apiKeyMissingTitle: 'ஜெமினி API சாவி உள்ளமைக்கப்படவில்லை.',
    dailyQuotaTitle: 'அன்றாட பயன்பாட்டு வரம்பு எட்டப்பட்டது',
    dailyQuotaDesc1: 'ஜெமினி API இன் இலவச அன்றாட வரம்பு முடிவடைந்தது.',
    dailyQuotaDesc2: 'இதுவரை பெறப்பட்ட அனைத்துப் பக்கங்களும் பாதுகாப்பாக சேமிக்கப்பட்டுள்ளன.',
    dailyQuotaDesc3: 'வரம்பு புதுப்பிக்கப்பட்டதும் "மீண்டும் தொடர்க" அல்லது "தோல்வியுற்றதை மீண்டும் செய்" என்பதைப் பயன்படுத்துங்கள்.',
    checkUsageLink: 'பயன்பாட்டைச் சரிபார்க்க → aistudio.google.com/app/usage',

    // Upload Section
    uploadCardTitle: '📂 கோப்பைப் பதிவேற்றுக',
    dropzoneTitleEmpty: 'படம் அல்லது PDF ஆவணத்தை இங்கே இழுத்துப் போடுங்கள்',
    dropzoneTitleSelected: 'தேர்ந்தெடுக்கப்பட்ட கோப்பு:',
    supportedFormats: 'JPEG · PNG · TIFF · BMP · PDF',
    pdfDocumentLabel: 'PDF ஆவணம்',
    imageDocumentLabel: 'பட ஆவணம்',
    readingPdfMeta: 'PDF விவரங்கள் படிக்கப்படுகின்றன…',
    totalPagesLabel: 'மொத்தப் பக்கங்கள்:',
    selectableTextAvailable: '✓ தேர்ந்தெடுக்கக்கூடிய உரை அடுக்கு உள்ளது',

    // Page Selection
    pageSelectionTitle: '📑 பக்கத் தேர்வு',
    modeAll: 'அனைத்தும்',
    modeSingle: 'தனிப் பக்கம்',
    modeRange: 'பக்க வரம்பு',
    pageLabel: 'பக்கம்:',
    pagesLabel: 'பக்கங்கள்:',
    ofPagesLabel: 'இல்',
    useDigitalTextToggle: 'டிஜிட்டல் உரை அடுக்கு கிடைக்கும்போது அதைப் பயன்படுத்துக',

    // Output Language
    outputLanguageTitle: '🌐 வெளியீட்டு மொழி',
    langTamEng: 'தமிழ் + ஆங்கிலம்',
    langTamOnly: 'தமிழ் மட்டும்',
    langEngOnly: 'ஆங்கிலம் மட்டும்',
    langTamEngHin: 'தமிழ் + ஆங்கிலம் + இந்தி',
    langTamHin: 'தமிழ் + இந்தி',
    langTamEngDesc: 'தமிழ் உரையைப் பிரித்தெடுத்து ஆங்கில மொழிபெயர்ப்பையும் வழங்குக',
    langTamOnlyDesc: 'அசல் வரலாற்றுத் தமிழ் எழுத்துப்பெயர்ப்பு மட்டும்',
    langEngOnlyDesc: 'தமிழை ஆங்கிலத்தில் மொழிபெயர்க்க (ஆங்கிலம் முதன்மை வெளியீடு)',
    langTamEngHinDesc: 'தமிழ் உரையுடன் ஆங்கிலம் மற்றும் இந்தி மொழிபெயர்ப்புகளை வழங்குக',
    langTamHinDesc: 'தமிழ் உரையுடன் இந்தி மொழிபெயர்ப்பை வழங்குக',

    // Scan Enhancement
    enhanceTitle: '🔆 பழைய ஆவணங்களுக்கான தெளிவாக்கம்',
    enhanceDesc: 'கல்வெட்டுகள் மற்றும் பழைய வரலாற்று நூல்களுக்கான ஒளித்தெளிவு மேம்பாடு',

    // Actions
    btnExtractText: '✨ உரையைப் பிரித்தெடு',
    btnProcessPdf: '📄 PDF பக்கங்களைப் பகுப்பாய்வு செய்க',
    btnProcessing: 'பகுப்பாய்வு நடைபெறுகிறது…',
    btnResume: '▶ பகுப்பாய்வைத் தொடர்க',
    btnRetryFailed: '🔄 தோல்வியுற்ற பக்கங்களை மீண்டும் செய்',
    btnCancel: '✕ பகுப்பாய்வை ரத்து செய்க',

    // Progress & Stats Tracker
    progressTitle: 'நேரடி பக்க பகுப்பாய்வு கண்காணிப்பாளர்',
    statDone: 'முடிந்தது',
    statReview: 'மறுபார்வை',
    statFailed: 'தோல்வி',
    statPending: 'நிலுவை',
    processingPageOf: 'பகுப்பாய்வு செய்யும் பக்கம்',
    pagesPerMin: 'பக்/நிமி',
    etaLabel: 'மதிப்பிடப்பட்ட நேரம்',

    // Image Summary
    imageSummaryTitle: '📊 பட சுருக்கம்',
    wordsLabel: 'சொற்கள்',
    charsLabel: 'எழுத்துக்கள்',
    linesLabel: 'வரிகள்',

    // Result Tabs
    tabTamilSource: '🔤 தமிழ் மூலம்',
    tabTamilText: '🔤 தமிழ் உரை',
    tabEnglishTranslation: '🌍 ஆங்கில மொழிபெயர்ப்பு',
    tabHindiTranslation: '🇮🇳 இந்தி மொழிபெயர்ப்பு',
    tabExport: '💾 ஏற்றுமதி',
    primaryOutputBadge: 'முதன்மை வெளியீடு',

    // Page Navigator
    navigatorPagesLabel: 'பக்கங்கள்',
    activePageOf: 'பக்கம்',
    btnRetryPage: '🔄 பக்கத்தை மீண்டும் செய்',
    btnProcessPageNow: '▶ இப்பக்கத்தை உடனே செய்',

    // Page State Banners
    pageFailedTitle: 'பகுப்பாய்வு தோல்வியடைந்தது',
    btnRetryThisPage: '🔄 இப்பக்கத்தை மீண்டும் முயற்சிக்கவும்',
    needsReviewTitle: 'மறுபார்வை தேவை:',
    needsReviewEmptyScan: 'இப்பக்கத்தில் உரை கண்டறியப்படவில்லை (வெற்றுப் பக்கம் அல்லது தெளிவற்ற படிவம்). கீழே நேரடியாகச் சரிபார்க்கலாம் அல்லது தட்டச்சு செய்யலாம்.',
    needsReviewUnclear: 'இப்பக்கத்தில் தேய்ந்த எழுத்துக்கள் [unclear] எனக் குறிக்கப்பட்டுள்ளன. பரிந்துரைக்கப்பட்ட வாசிப்புகளைக் கீழே காண்க.',
    pagePendingTitle: 'இப்பக்கம் இன்னும் பகுப்பாய்வு செய்யப்படவில்லை',
    pagePendingDesc: 'இப்பக்கத்தை மட்டும் எடுக்க "இப்பக்கத்தை உடனே செய்" என்பதை அழுத்தவும், அல்லது இடப்பக்கப் பலகையில் "PDF பக்கங்களைப் பகுப்பாய்வு செய்க" என்பதை இயக்கவும்.',
    pageProcessingTitle: 'உரை பிரித்தெடுக்கப்படுகிறது: பக்கம்',
    pageProcessingSubtitle: 'முடிந்ததும் உடனடியாக முடிவுகள் இங்கே தோன்றும்',
    initialEmptyTitle: 'தொடங்க வரலாற்றுத் தமிழ் ஆவணத்தை (PDF அல்லது படம்) பதிவேற்றவும்',
    initialEmptySubtitle: 'முழுமையான பல பக்க PDF செயலாக்கம் · விடுபடாத பக்கங்கள் · துல்லியமான தமிழ் எழுத்துப்பெயர்ப்பு',
    tamilPlaceholder: 'பிரித்தெடுக்கப்பட்ட தமிழ் உரை இங்கே தோன்றும்…',
    translationPlaceholder: 'ஆங்கில மொழிபெயர்ப்பு இங்கே தோன்றும்…',
    hindiPlaceholder: 'இந்தி மொழிபெயர்ப்பு இங்கே தோன்றும்…',
    confidenceScoreLabel: 'நம்பகத்தன்மை மதிப்பீடு',
    suggestedCorrectionsLabel: 'கல்வெட்டு அறிஞரின் வாசிப்புப் பரிந்துரைகள்',

    // Translation Tab Messages
    translationFailedNotice: 'உரை பிரித்தெடுத்தல் தோல்வியடைந்ததால் மொழிபெயர்க்க முடியவில்லை.',
    translationPendingNotice: 'இப்பக்கம் பகுப்பாய்வுக்காக காத்திருக்கிறது.',
    translationGenerating: 'மொழிபெயர்ப்பு உருவாக்கப்படுகிறது…',
    noTranslationForPage: 'இப்பக்கத்திற்கு ஆங்கில மொழிபெயர்ப்பு இல்லை.',
    noTranslationPrompt: 'மொழிபெயர்ப்பைப் பெற "தமிழ் + ஆங்கிலம்" அல்லது "ஆங்கிலம் மட்டும்" என்பதைத் தேர்ந்தெடுக்கவும்.',
    noHindiTranslationForPage: 'இப்பக்கத்திற்கு இந்தி மொழிபெயர்ப்பு இல்லை.',

    // Export Section
    exportSummaryTitle: 'ஏற்றுமதி நிலைச் சுருக்கம்',
    exportReadySummary: 'பக்கங்கள் பதிவிறக்கத்திற்கு தயாராக உள்ளன.',
    exportFailedSummary: 'பக்கங்கள் தோல்வியடைந்தன (ஏற்றுமதியில் [FAILED] எனக் குறிக்கப்படும்).',
    exportPendingSummary: 'பக்கங்கள் செய்யப்படவில்லை (ஏற்றுமதியில் [UNPROCESSED] எனக் குறிக்கப்படும்).',
    exportOrderNotice: 'அனைத்துப் பக்கங்களும் தமிழ் யுனிகோட் மாறாமல் சரியான வரிசையில் ஏற்றுமதி செய்யப்படும்.',
    exportTamilTxt: 'தமிழ் உரை (.txt)',
    exportTamilTxtSub: 'முழுமையான மூலத் தமிழ் எழுத்துப்பெயர்ப்பு',
    exportEnglishTxt: 'ஆங்கில மொழிபெயர்ப்பு (.txt)',
    exportEnglishTxtSub: 'அனைத்துப் பக்கங்களின் ஆங்கில மொழிபெயர்ப்பு மட்டும்',
    exportHindiTxt: 'இந்தி மொழிபெயர்ப்பு (.txt)',
    exportHindiTxtSub: 'அனைத்துப் பக்கங்களின் இந்தி மொழிபெயர்ப்பு மட்டும்',
    exportCombinedTxt: 'இணைந்த உரை (.txt)',
    exportCombinedTxtSub: 'பக்கக் குறிகளுடன் தமிழ் மற்றும் மொழிபெயர்ப்புகள் அருகருகே',
    exportJson: 'கட்டமைக்கப்பட்ட JSON (.json)',
    exportJsonSub: 'பக்க நிலைகள், பிழைப் பதிவுகள் மற்றும் மேலதிக விவரங்கள்',
    exportPdf: 'PDF வடிவத்தில் பதிவிறக்கு (.pdf)',
    exportPdfSub: 'தமிழ் ஒருங்குறி மற்றும் அமைப்பைக் கொண்ட வரலாற்று ஆவணம்',
    exportPdfModalTitle: 'ஆவணத்தை PDF வடிவில் ஏற்றுமதி செய்',
    exportScopeLabel: 'பக்க வரம்பு',
    exportScopeAll: 'அனைத்து பக்கங்கள்',
    exportScopeCurrent: 'தற்போதைய பக்கம் மட்டும்',
    exportScopeRange: 'குறிப்பிட்ட பக்கங்கள் (எ.கா: 1-5, 8)',
    exportIncludeTamil: 'தமிழ் மூல உரையைச் சேர்',
    exportIncludeTranslation: 'ஆங்கில மொழிபெயர்ப்பைச் சேர்',
    exportIncludeHindi: 'இந்தி மொழிபெயர்ப்பைச் சேர்',
    exportIncludeNotes: 'ஆய்வுக் குறிப்புகளைச் சேர்',
    exportGeneratingPdf: 'தமிழ் ஒருங்குறி PDF உருவாக்கப்படுகிறது…',
    btnDownloadPdf: 'PDF பதிவிறக்கு',

    // Cloud History Modal & Restored State
    historyModalTitle: '📁 சூபாபேஸில் சேமிக்கப்பட்ட ஆவணங்கள்',
    historyEmpty: 'சூபாபேஸில் இன்னும் ஆவணங்கள் எதுவும் சேமிக்கப்படவில்லை. ஒரு படம் அல்லது PDF-ஐ இயக்கினால் அது தானாகவே சேமிக்கப்படும்.',
    btnLoadDocument: 'ஆவணத்தைத் திற',
    btnClose: 'மூடு',
    documentSavedNotice: 'ஆவணம் மற்றும் பக்கங்கள் சூபாபேஸில் ஒத்திசைக்கப்பட்டன.',
    originalFileMissingNotice: 'அறிவிப்பு: உரை மற்றும் விவரங்கள் சூபாபேஸிலிருந்து மீட்கப்பட்டன. அசல் ஆவணக் கோப்பு தற்காலிகமாக மட்டுமே வைக்கப்படும்; கிளவுடில் சேமிக்கப்படவில்லை.',
    promptReuploadToRun: 'மீதமுள்ள பக்கங்களுக்கு OCR இயக்க, தயவுசெய்து அசல் கோப்பை மீண்டும் தேர்ந்தெடுக்கவும்.',
    btnUploadFileToRerun: '📁 OCR இயக்க அசல் கோப்பைத் தேர்வுசெய்க',
    storagePrivacyNotice: '🔒 தனியுரிமை உறுதி: அசல் கோப்புகள் தற்காலிகமானவை மற்றும் கிளவுட் சேமிப்பகத்தில் சேமிக்கப்படுவதில்லை.',
  },

  hi: {
    // Topbar & Navigation
    appTitle: 'थारवु',
    appSubtitle: 'तमिलवॉल्ट AI — ऐतिहासिक तमिल OCR और अनुवाद इंजन',
    statusConnecting: 'सम्पर्क स्थापित किया जा रहा है…',
    statusOffline: 'बैकएंड ऑफलाइन है',
    statusReady: '✦ जेमिनी',
    statusApiKeyMissing: 'API कुंजी सेट नहीं है',
    statusSdkMissing: 'जेमिनी SDK उपलब्ध नहीं',
    pdfAvailable: 'PDF ✓',
    switchLangEn: 'English',
    switchLangTa: 'தமிழ்',
    switchLangHi: 'हिन्दी',
    cloudSync: 'सुपाबेस क्लाउड सिंक',
    cloudSyncSaved: 'सुपाबेस में सहेजा गया',
    savedDocuments: 'सहेजे गए दस्तावेज़',

    // Alerts
    backendOfflineTitle: 'बैकएंड सर्वर ऑफलाइन है।',
    backendOfflineDesc: 'पोर्ट 8001 पर बैकएंड सर्वर शुरू करें:',
    apiKeyMissingTitle: 'जेमिनी API कुंजी कॉन्फ़िगर नहीं की गई है।',
    dailyQuotaTitle: 'दैनिक कोटा सीमा समाप्त हो गई',
    dailyQuotaDesc1: 'जेमिनी API ने दैनिक कोटा समाप्त होने की सूचना दी है।',
    dailyQuotaDesc2: 'अब तक निकाले गए सभी पृष्ठ सुरक्षित रूप से सहेजे गए हैं।',
    dailyQuotaDesc3: 'कोटा रीसेट होने पर "जारी रखें" या "विफल पृष्ठ पुनः आज़माएं" का उपयोग करें।',
    checkUsageLink: 'उपयोग की जांच करें → aistudio.google.com/app/usage',

    // Upload Section
    uploadCardTitle: '📂 फ़ाइल अपलोड करें',
    dropzoneTitleEmpty: 'छवि या PDF फ़ाइल यहाँ खींचकर लाएँ',
    dropzoneTitleSelected: 'चयनित फ़ाइल:',
    supportedFormats: 'JPEG · PNG · TIFF · BMP · PDF',
    pdfDocumentLabel: 'PDF दस्तावेज़',
    imageDocumentLabel: 'छवि दस्तावेज़',
    readingPdfMeta: 'PDF मेटाडेटा पढ़ा जा रहा है…',
    totalPagesLabel: 'कुल पृष्ठ:',
    selectableTextAvailable: '✓ चयन योग्य डिजिटल टेक्स्ट परत उपलब्ध',

    // Page Selection
    pageSelectionTitle: '📑 पृष्ठ चयन',
    modeAll: 'सभी पृष्ठ',
    modeSingle: 'एकल पृष्ठ',
    modeRange: 'पृष्ठ सीमा',
    pageLabel: 'पृष्ठ:',
    pagesLabel: 'पृष्ठ:',
    ofPagesLabel: 'में से',
    useDigitalTextToggle: 'उपलब्ध होने पर अंतर्निहित डिजिटल टेक्स्ट परत का उपयोग करें',

    // Output Language
    outputLanguageTitle: '🌐 आउटपुट भाषा',
    langTamEng: 'तमिल + अंग्रेज़ी',
    langTamOnly: 'केवल तमिल',
    langEngOnly: 'केवल अंग्रेज़ी',
    langTamEngHin: 'तमिल + अंग्रेज़ी + हिन्दी',
    langTamHin: 'तमिल + हिन्दी',
    langTamEngDesc: 'तमिल टेक्स्ट निकालें और अंग्रेज़ी अनुवाद प्रदान करें',
    langTamOnlyDesc: 'केवल निष्ठावान ऐतिहासिक तमिल प्रतिलेखन (कोई अनुवाद नहीं)',
    langEngOnlyDesc: 'तमिल से अंग्रेज़ी में अनुवाद करें (अंग्रेज़ी प्राथमिक आउटपुट है)',
    langTamEngHinDesc: 'तमिल टेक्स्ट निकालें और अंग्रेज़ी व हिन्दी दोनों अनुवाद प्राप्त करें',
    langTamHinDesc: 'तमिल टेक्स्ट निकालें और हिन्दी अनुवाद प्राप्त करें',

    // Scan Enhancement
    enhanceTitle: '🔆 प्राचीन प्रतियों के लिए संवर्धन',
    enhanceDesc: 'शिलालेखों और प्राचीन पांडुलिपियों के लिए कंट्रास्ट और तीक्ष्णता बढ़ाएं',

    // Actions
    btnExtractText: '✨ टेक्स्ट निकालें',
    btnProcessPdf: '📄 PDF पृष्ठों को संसाधित करें',
    btnProcessing: 'संसाधित किया जा रहा है…',
    btnResume: '▶ प्रसंस्करण फिर से शुरू करें',
    btnRetryFailed: '🔄 विफल पृष्ठ पुनः आज़माएं',
    btnCancel: '✕ प्रसंस्करण रद्द करें',

    // Progress & Stats Tracker
    progressTitle: 'लाइव पृष्ठ प्रसंस्करण ट्रैकर',
    statDone: 'पूर्ण',
    statReview: 'समीक्षा',
    statFailed: 'विफल',
    statPending: 'लंबित',
    processingPageOf: 'पृष्ठ संसाधित हो रहा है',
    pagesPerMin: 'पृष्ठ/मिनट',
    etaLabel: 'अनुमानित समय',

    // Image Summary
    imageSummaryTitle: '📊 छवि सारांश',
    wordsLabel: 'शब्द',
    charsLabel: 'अक्षर',
    linesLabel: 'पंक्तियाँ',

    // Result Tabs
    tabTamilSource: '🔤 तमिल मूल',
    tabTamilText: '🔤 तमिल टेक्स्ट',
    tabEnglishTranslation: '🌍 अंग्रेज़ी अनुवाद',
    tabHindiTranslation: '🇮🇳 हिन्दी अनुवाद',
    tabExport: '💾 निर्यात',
    primaryOutputBadge: 'प्राथमिक आउटपुट',

    // Page Navigator
    navigatorPagesLabel: 'पृष्ठ',
    activePageOf: 'पृष्ठ',
    btnRetryPage: '🔄 पृष्ठ पुनः आज़माएं',
    btnProcessPageNow: '▶ इस पृष्ठ को अभी संसाधित करें',

    // Page State Banners
    pageFailedTitle: 'निष्कर्षण विफल रहा',
    btnRetryThisPage: '🔄 इस पृष्ठ को पुनः आज़माएं',
    needsReviewTitle: 'समीक्षा आवश्यक:',
    needsReviewEmptyScan: 'इस पृष्ठ पर कोई टेक्स्ट नहीं मिला (खाली या धुंधला स्कैन)। आप नीचे टेक्स्ट सत्यापित या मैन्युअल दर्ज कर सकते हैं।',
    needsReviewUnclear: 'इस पृष्ठ में क्षतिग्रस्त हिस्से हैं जिन्हें [unclear] के रूप में चिह्नित किया गया है। नीचे सुझाई गई समीक्षा देखें।',
    pagePendingTitle: 'यह पृष्ठ अभी संसाधित नहीं हुआ है',
    pagePendingDesc: 'इस पृष्ठ को निकालने के लिए "इस पृष्ठ को अभी संसाधित करें" पर क्लिक करें, या साइडबार से पूरे PDF को संसाधित करें।',
    pageProcessingTitle: 'पृष्ठ से टेक्स्ट निकाला जा रहा है',
    pageProcessingSubtitle: 'संसाधन पूरा होते ही परिणाम यहाँ तुरंत दिखाई देंगे',
    initialEmptyTitle: 'प्रारंभ करने के लिए एक ऐतिहासिक तमिल दस्तावेज़ (PDF या छवि) अपलोड करें',
    initialEmptySubtitle: 'पूर्ण बहु-पृष्ठ PDF प्रसंस्करण · शून्य खोए हुए पृष्ठ · ऐतिहासिक तमिल प्रतिलेखन',
    tamilPlaceholder: 'निकाला गया तमिल टेक्स्ट यहाँ प्रदर्शित होगा…',
    translationPlaceholder: 'अंग्रेज़ी अनुवाद यहाँ प्रदर्शित होगा…',
    hindiPlaceholder: 'हिन्दी अनुवाद यहाँ प्रदर्शित होगा…',
    confidenceScoreLabel: 'विश्वसनीयता स्कोर',
    suggestedCorrectionsLabel: 'अभिलेखीय समीक्षा और सुझाई गई वर्तनी',

    // Translation Tab Messages
    translationFailedNotice: 'टेक्स्ट निष्कर्षण विफल होने के कारण अनुवाद उत्पन्न नहीं किया जा सका।',
    translationPendingNotice: 'यह पृष्ठ अभी प्रसंस्करण की प्रतीक्षा में है।',
    translationGenerating: 'अनुवाद उत्पन्न किया जा रहा है…',
    noTranslationForPage: 'इस पृष्ठ के लिए कोई अंग्रेज़ी अनुवाद नहीं है।',
    noTranslationPrompt: 'अनुवाद प्राप्त करने के लिए "तमिल + अंग्रेज़ी" या "तमिल + अंग्रेज़ी + हिन्दी" चुनें।',
    noHindiTranslationForPage: 'इस पृष्ठ के लिए कोई हिन्दी अनुवाद नहीं है।',

    // Export Section
    exportSummaryTitle: 'निर्यात स्थिति सारांश',
    exportReadySummary: 'पृष्ठ डाउनलोड के लिए तैयार हैं।',
    exportFailedSummary: 'पृष्ठ विफल रहे (निर्यात में [FAILED] के रूप में चिह्नित)।',
    exportPendingSummary: 'पृष्ठ असंसाधित हैं (निर्यात में [UNPROCESSED] के रूप में चिह्नित)।',
    exportOrderNotice: 'निर्यात में तमिल यूनिकोड सुरक्षित रखते हुए सभी पृष्ठ सही दस्तावेज़ क्रम में शामिल हैं।',
    exportTamilTxt: 'तमिल टेक्स्ट (.txt)',
    exportTamilTxtSub: 'पूर्ण मूल ऐतिहासिक तमिल प्रतिलेखन',
    exportEnglishTxt: 'अंग्रेज़ी अनुवाद (.txt)',
    exportEnglishTxtSub: 'सभी पृष्ठों का केवल अंग्रेज़ी अनुवाद',
    exportHindiTxt: 'हिन्दी अनुवाद (.txt)',
    exportHindiTxtSub: 'सभी पृष्ठों का केवल हिन्दी अनुवाद',
    exportCombinedTxt: 'संयुक्त टेक्स्ट (.txt)',
    exportCombinedTxtSub: 'पृष्ठ चिह्नों के साथ तमिल और अनुवाद आमने-सामने',
    exportJson: 'संरचित JSON (.json)',
    exportJsonSub: 'पृष्ठ स्थिति, त्रुटि लॉग और मेटाडेटा के साथ JSON निर्यात',
    exportPdf: 'PDF के रूप में निर्यात करें (.pdf)',
    exportPdfSub: 'मूल तमिल यूनिकोड और सटीक लेआउट वाला पुरातात्विक दस्तावेज़',
    exportPdfModalTitle: 'दस्तावेज़ को PDF के रूप में निर्यात करें',
    exportScopeLabel: 'पृष्ठ विस्तार',
    exportScopeAll: 'सभी पृष्ठ',
    exportScopeCurrent: 'केवल वर्तमान पृष्ठ',
    exportScopeRange: 'कस्टम पृष्ठ सीमा (उदा. 1-5, 8)',
    exportIncludeTamil: 'मूल तमिल प्रतिलेखन शामिल करें',
    exportIncludeTranslation: 'अंग्रेज़ी अनुवाद शामिल करें',
    exportIncludeHindi: 'हिन्दी अनुवाद शामिल करें',
    exportIncludeNotes: 'विद्वत्तापूर्ण नोट्स व संशोधन शामिल करें',
    exportGeneratingPdf: 'तमिल और हिन्दी यूनिकोड के साथ PDF दस्तावेज़ बनाया जा रहा है…',
    btnDownloadPdf: 'PDF डाउनलोड करें',

    // Cloud History Modal & Restored State
    historyModalTitle: '📁 सुपाबेस में सहेजे गए दस्तावेज़',
    historyEmpty: 'सुपाबेस में अभी कोई दस्तावेज़ सहेजा नहीं गया है। किसी छवि या PDF को संसाधित करने पर वह स्वतः सहेज लिया जाएगा।',
    btnLoadDocument: 'दस्तावेज़ खोलें',
    btnClose: 'बंद करें',
    documentSavedNotice: 'दस्तावेज़ और पृष्ठ सुपाबेस में सफलतापूर्वक सिंक हो गए हैं।',
    originalFileMissingNotice: 'सूचना: दस्तावेज़ टेक्स्ट और मेटाडेटा सुपाबेस से बहाल किए गए हैं। मूल स्कैन फ़ाइल केवल अस्थायी रूप से रखी जाती है और क्लाउड स्टोरेज में नहीं सहेजी जाती।',
    promptReuploadToRun: 'अतिरिक्त पृष्ठों पर OCR पुनः चलाने के लिए, कृपया मूल फ़ाइल पुनः चुनें।',
    btnUploadFileToRerun: '📁 OCR पुनः चलाने के लिए मूल फ़ाइल चुनें',
    storagePrivacyNotice: '🔒 गोपनीयता गारंटी: मूल स्कैन फ़ाइलें अस्थायी हैं और उन्हें कभी भी क्लाउड स्टोरेज बकेट में अपलोड नहीं किया जाता है।',
  },
};

// ── React Context & Hook for i18n ─────────────────────────────────────────────
interface I18nContextType {
  lang: UILanguage;
  setLang: (l: UILanguage) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  t: translations.en,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<UILanguage>(() => {
    try {
      const saved = localStorage.getItem('tamilvault_ui_lang');
      if (saved === 'ta' || saved === 'en' || saved === 'hi') return saved as UILanguage;
    } catch { /* ignore */ }
    return 'en';
  });

  const setLang = (newLang: UILanguage) => {
    setLangState(newLang);
    try {
      localStorage.setItem('tamilvault_ui_lang', newLang);
    } catch { /* ignore */ }
  };

  const value = {
    lang,
    setLang,
    t: translations[lang] || translations.en,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
