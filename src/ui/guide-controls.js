/**
 * Wires panel guide buttons to share workflow helpers.
 */
export function createGuideControls({
  reparse,
  copySummaryGuide,
  copyResummaryGuide,
  logger = typeof console !== 'undefined' ? console : null,
} = {}) {
  if (typeof copySummaryGuide !== 'function' || typeof copyResummaryGuide !== 'function') {
    throw new Error('createGuideControls requires summary and resummary copy functions');
  }

  const bindGuideControls = (panel) => {
    if (!panel || typeof panel.querySelector !== 'function') {
      if (logger?.warn) {
        logger.warn('[GMH] guide controls: panel missing querySelector');
      }
      return;
    }

    const reparseBtn = panel.querySelector('#gmh-reparse');
    if (reparseBtn && typeof reparse === 'function') {
      reparseBtn.onclick = () => reparse();
    }

    const guideBtn = panel.querySelector('#gmh-guide');
    if (guideBtn) {
      guideBtn.onclick = () => copySummaryGuide();
    }

    const reguideBtn = panel.querySelector('#gmh-reguide');
    if (reguideBtn) {
      reguideBtn.onclick = () => copyResummaryGuide();
    }
  };

  return { bindGuideControls };
}
