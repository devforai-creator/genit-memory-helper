export const LEGACY_PREVIEW_CSS = `
.gmh-preview-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.72);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;}
.gmh-preview-card{background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 18px 48px rgba(8,15,30,0.55);width:min(520px,94vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;font:13px/1.5 'Inter',system-ui,sans-serif;}
.gmh-preview-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,0.25);font-weight:600;}
.gmh-preview-body{padding:18px 20px;overflow:auto;display:grid;gap:16px;}
.gmh-preview-summary{display:grid;gap:8px;border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;background:rgba(30,41,59,0.65);}
.gmh-preview-summary div{display:flex;justify-content:space-between;gap:12px;}
.gmh-preview-summary strong{color:#bfdbfe;}
.gmh-preview-turns{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.gmh-preview-turn{background:rgba(30,41,59,0.55);border-radius:10px;padding:10px 12px;border:1px solid rgba(59,130,246,0.12);}
.gmh-preview-turn--selected{border-color:rgba(56,189,248,0.45);background:rgba(56,189,248,0.12);}
.gmh-turn-list__badge{display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:#38bdf8;background:rgba(56,189,248,0.12);padding:0 8px;border-radius:999px;}
.gmh-preview-turn-speaker{font-weight:600;color:#c4b5fd;margin-bottom:4px;}
.gmh-preview-turn-text{color:#e2e8f0;}
.gmh-preview-footnote{font-size:12px;color:#94a3b8;}
.gmh-preview-actions{display:flex;gap:10px;padding:16px 20px;border-top:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.92);}
.gmh-preview-actions button{flex:1;padding:10px 12px;border-radius:10px;border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease;}
.gmh-preview-cancel{background:#1e293b;color:#e2e8f0;}
.gmh-preview-cancel:hover{background:#243049;}
.gmh-preview-confirm{background:#34d399;color:#053527;}
.gmh-preview-confirm:hover{background:#22c55e;color:#052e21;}
.gmh-preview-close{background:none;border:0;color:#94a3b8;font-size:18px;cursor:pointer;}
.gmh-preview-close:hover{color:#f8fafc;}
@media (max-width:480px){.gmh-preview-card{width:100%;border-radius:12px;}}
`;

export const DESIGN_SYSTEM_CSS = `
:root{--gmh-bg:#0b1020;--gmh-surface:#0f172a;--gmh-surface-alt:rgba(30,41,59,0.65);--gmh-fg:#e2e8f0;--gmh-muted:#94a3b8;--gmh-accent:#38bdf8;--gmh-accent-soft:#c4b5fd;--gmh-success:#34d399;--gmh-warning:#fbbf24;--gmh-danger:#f87171;--gmh-border:rgba(148,163,184,0.25);--gmh-radius:14px;--gmh-radius-sm:10px;--gmh-panel-shadow:0 18px 48px rgba(8,15,30,0.55);--gmh-font:13px/1.5 'Inter',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;}
.gmh-modal-overlay{position:fixed;inset:0;background:rgba(8,11,20,0.72);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;}
.gmh-modal{background:var(--gmh-surface);color:var(--gmh-fg);border-radius:var(--gmh-radius);box-shadow:var(--gmh-panel-shadow);width:min(560px,94vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;font:var(--gmh-font);}
.gmh-modal--sm{width:min(420px,94vw);}
.gmh-modal--lg{width:min(720px,94vw);}
.gmh-modal__header{display:flex;flex-direction:column;gap:8px;padding:18px 22px;border-bottom:1px solid var(--gmh-border);}
.gmh-modal__header-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.gmh-modal__title{font-size:16px;font-weight:600;margin:0;color:var(--gmh-fg);}
.gmh-modal__description{margin:0;font-size:13px;color:var(--gmh-muted);line-height:1.45;}
.gmh-modal__body{padding:20px 22px;}
.gmh-modal__body--scroll{overflow:auto;display:grid;gap:18px;}
.gmh-modal__footer{padding:18px 22px;border-top:1px solid var(--gmh-border);background:rgba(11,16,32,0.92);}
.gmh-modal__actions{display:flex;gap:12px;flex-wrap:wrap;}
.gmh-modal__close{border:0;background:none;color:var(--gmh-muted);font-size:18px;cursor:pointer;padding:4px;border-radius:50%;transition:color 0.15s ease,background 0.15s ease;}
.gmh-modal__close:hover{color:#f8fafc;background:rgba(148,163,184,0.16);}
.gmh-button{flex:1;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;min-width:120px;}
.gmh-button--primary{background:var(--gmh-success);color:#053527;}
.gmh-button--primary:hover{background:#22c55e;color:#052e21;}
.gmh-button--secondary{background:#1e293b;color:var(--gmh-fg);border:1px solid var(--gmh-border);}
.gmh-button--secondary:hover{background:#243049;}
.gmh-button--ghost{background:rgba(15,23,42,0.65);color:var(--gmh-muted);border:1px solid transparent;}
.gmh-button--ghost:hover{color:var(--gmh-fg);border-color:var(--gmh-border);}
.gmh-modal-footnote{font-size:12px;color:var(--gmh-muted);}
.gmh-modal-stack{display:grid;gap:18px;}
.gmh-privacy-summary{display:grid;gap:8px;border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:14px;background:var(--gmh-surface-alt);}
.gmh-privacy-summary__row{display:flex;justify-content:space-between;gap:12px;font-size:13px;}
.gmh-privacy-summary__label{color:var(--gmh-muted);font-weight:600;}
.gmh-section-title{font-weight:600;color:#cbd5f5;font-size:13px;}
.gmh-turn-list{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.gmh-turn-list__item{background:var(--gmh-surface-alt);border-radius:var(--gmh-radius-sm);padding:10px 12px;border:1px solid rgba(59,130,246,0.18);}
.gmh-turn-list__item--selected{border-color:rgba(56,189,248,0.45);background:rgba(56,189,248,0.12);}
.gmh-turn-list__speaker{font-weight:600;color:var(--gmh-accent-soft);margin-bottom:4px;font-size:12px;}
.gmh-turn-list__badge{display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:var(--gmh-accent);background:rgba(56,189,248,0.12);padding:0 8px;border-radius:999px;}
.gmh-turn-list__text{color:var(--gmh-fg);font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.gmh-turn-list__empty{color:var(--gmh-muted);text-align:center;}
.gmh-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:var(--gmh-bg);color:var(--gmh-fg);padding:16px 16px 22px;border-radius:18px;box-shadow:var(--gmh-panel-shadow);display:grid;gap:14px;width:min(320px,92vw);font:var(--gmh-font);max-height:70vh;overflow:auto;transform:translateY(0);opacity:1;visibility:visible;transition:transform 0.2s ease,opacity 0.15s ease,visibility 0.15s ease;will-change:transform,opacity;}
.
.gmh-panel--dragging,.gmh-panel--resizing{transition:none !important;cursor:grabbing;}
.gmh-panel__header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;}
.gmh-panel__headline{display:flex;flex-direction:column;gap:2px;}
.gmh-panel__drag-handle{border:0;background:transparent;color:var(--gmh-muted);padding:6px 8px;border-radius:var(--gmh-radius-sm);cursor:grab;display:grid;place-items:center;font-size:16px;transition:background 0.15s ease,color 0.15s ease;}
.gmh-panel__drag-handle:hover{background:rgba(148,163,184,0.18);color:var(--gmh-accent);}
.gmh-panel__drag-handle:focus-visible{outline:2px solid var(--gmh-accent);outline-offset:2px;}
.gmh-panel__drag-handle[aria-disabled="true"]{cursor:not-allowed;opacity:0.5;}
.gmh-panel__drag-icon{pointer-events:none;line-height:1;}
.gmh-panel__resize-handle{position:absolute;width:18px;height:18px;bottom:6px;right:10px;cursor:nwse-resize;border-radius:6px;opacity:0.7;}
.gmh-panel__resize-handle::after{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(135deg,transparent 40%,rgba(148,163,184,0.35) 40%,rgba(148,163,184,0.8));}
.gmh-panel__resize-handle:hover{opacity:1;}
.gmh-panel__resize-handle[style*="none"]{display:none !important;}
.gmh-settings-grid{display:grid;gap:12px;}
.gmh-settings-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:1px solid rgba(148,163,184,0.25);background:var(--gmh-surface-alt);}
.gmh-settings-row__main{display:flex;flex-direction:column;gap:4px;}
.gmh-settings-row__label{font-weight:600;font-size:13px;color:var(--gmh-fg);}
.gmh-settings-row__description{font-size:12px;color:var(--gmh-muted);}
.gmh-settings-row input[type="checkbox"]{width:18px;height:18px;accent-color:var(--gmh-accent);}
.gmh-settings-row input[type="number"]{width:88px;background:#0f172a;border:1px solid var(--gmh-border);color:var(--gmh-fg);border-radius:8px;padding:6px 8px;}
html.gmh-collapsed #genit-memory-helper-panel{transform:translateY(calc(100% + 24px));opacity:0;visibility:hidden;pointer-events:none;}
html.gmh-panel-open #genit-memory-helper-panel{pointer-events:auto;}
#gmh-fab{position:fixed;right:16px;bottom:16px;width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;font:700 13px/1 var(--gmh-font);background:var(--gmh-accent);color:#041016;cursor:pointer;box-shadow:0 10px 28px rgba(8,15,30,0.45);z-index:2147483001;transition:transform 0.2s ease,box-shadow 0.2s ease,opacity 0.15s ease;touch-action:manipulation;}
#gmh-fab:hover{box-shadow:0 14px 32px rgba(8,15,30,0.55);transform:translateY(-2px);}
#gmh-fab:active{transform:translateY(0);box-shadow:0 6px 18px rgba(8,15,30,0.45);}
html.gmh-panel-open #gmh-fab{transform:translateY(-4px);box-shadow:0 12px 30px rgba(8,15,30,0.5);}
.gmh-panel__title{font-size:15px;font-weight:600;margin:0;}
.gmh-panel__tag{font-size:11px;color:var(--gmh-muted);margin-top:2px;}
.gmh-panel__section{border-top:1px solid var(--gmh-border);padding-top:12px;display:grid;gap:10px;}
.gmh-panel__section:first-of-type{border-top:none;padding-top:0;}
.gmh-panel__section-title{font-size:12px;color:var(--gmh-muted);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;}
.gmh-field-row{display:flex;gap:10px;align-items:center;width:100%;}
.gmh-field-row--wrap{flex-wrap:wrap;align-items:flex-start;}
.gmh-field-label{font-size:12px;font-weight:600;color:var(--gmh-muted);}
.gmh-helper-text{font-size:11px;color:var(--gmh-muted);line-height:1.4;}
.gmh-range-controls{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap;}
.gmh-bookmark-controls{display:flex;gap:6px;flex-wrap:wrap;}
.gmh-range-sep{color:var(--gmh-muted);}
.gmh-input,.gmh-select{flex:1;background:#111827;color:var(--gmh-fg);border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:8px 10px;font:inherit;}
.gmh-select--compact{padding:6px 8px;}
.gmh-bookmark-select{flex:1;display:flex;align-items:center;gap:8px;}
.gmh-input--compact{flex:0;min-width:72px;width:72px;}
.gmh-textarea{width:100%;min-height:96px;background:#111827;color:var(--gmh-fg);border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:10px;font:inherit;resize:vertical;}
.gmh-small-btn{padding:8px 10px;border-radius:var(--gmh-radius-sm);border:1px solid transparent;cursor:pointer;font-weight:600;font-size:12px;background:rgba(15,23,42,0.65);color:var(--gmh-muted);transition:background 0.15s ease,color 0.15s ease,border 0.15s ease;}
.gmh-small-btn--accent{background:var(--gmh-accent);color:#041016;}
.gmh-small-btn--muted{background:rgba(15,23,42,0.65);color:var(--gmh-muted);border:1px solid transparent;}
.gmh-small-btn--muted:hover{color:var(--gmh-fg);border-color:var(--gmh-border);}
.gmh-small-btn--accent:hover{background:#0ea5e9;color:#03212f;}
.gmh-panel-btn{flex:1;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;}
.gmh-panel-btn--accent{background:var(--gmh-success);color:#053527;}
.gmh-panel-btn--accent:hover{background:#22c55e;color:#052e21;}
.gmh-panel-btn--neutral{background:#1e293b;color:var(--gmh-fg);}
.gmh-panel-btn--neutral:hover{background:#243049;}
.gmh-panel-btn--warn{background:#ef4444;color:#fff;}
.gmh-panel-btn--warn:hover{background:#dc2626;}
.gmh-panel-btn--compact{flex:0.5;}
.gmh-disabled{opacity:0.6;pointer-events:none;}
.gmh-progress{display:grid;gap:6px;}
.gmh-progress__track{height:6px;border-radius:999px;background:rgba(148,163,184,0.2);overflow:hidden;position:relative;}
.gmh-progress__fill{height:100%;width:0%;border-radius:inherit;background:var(--gmh-accent);transition:width 0.2s ease;}
.gmh-progress__fill[data-state="error"]{background:var(--gmh-danger);}
.gmh-progress__fill[data-state="done"]{background:var(--gmh-success);}
.gmh-progress__fill[data-indeterminate="true"]{width:40%;animation:gmhProgressSlide 1.6s linear infinite;}
@keyframes gmhProgressSlide{0%{transform:translateX(-120%);}50%{transform:translateX(-10%);}100%{transform:translateX(120%);}}
.gmh-progress__label{font-size:12px;color:var(--gmh-muted);}
.gmh-status-line{font-size:12px;color:var(--gmh-muted);}
.gmh-subtext{font-size:12px;color:var(--gmh-muted);line-height:1.5;}
@media (max-width:480px){.gmh-modal{width:100%;border-radius:12px;}.gmh-modal__actions{flex-direction:column;}.gmh-panel{right:12px;left:12px;bottom:12px;width:auto;max-height:76vh;}.gmh-panel::-webkit-scrollbar{width:6px;}.gmh-panel::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.35);border-radius:999px;}#gmh-fab{width:48px;height:48px;right:12px;bottom:12px;font-size:12px;}}
@media (prefers-reduced-motion:reduce){.gmh-panel,.gmh-modal,.gmh-progress__fill,#gmh-fab{transition:none !important;animation-duration:0.001s !important;}}
`;

export function ensureLegacyPreviewStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  if (doc.getElementById('gmh-preview-style')) return;
  const style = doc.createElement('style');
  style.id = 'gmh-preview-style';
  style.textContent = LEGACY_PREVIEW_CSS;
  doc.head.appendChild(style);
}

export function ensureDesignSystemStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  if (doc.getElementById('gmh-design-system-style')) return;
  const style = doc.createElement('style');
  style.id = 'gmh-design-system-style';
  style.textContent = DESIGN_SYSTEM_CSS;
  doc.head.appendChild(style);
}
