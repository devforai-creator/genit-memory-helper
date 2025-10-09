/**
 * @typedef {object} GuideControlsOptions
 * @property {() => void} [reparse]
 * @property {() => Promise<void> | void} copySummaryGuide
 * @property {() => Promise<void> | void} copyResummaryGuide
 * @property {Console | { warn?: (...args: unknown[]) => void } | null} [logger]
 */

/**
 * @typedef {object} GuideControls
 * @property {(panel: Element | null) => void} bindGuideControls
 */

/**
 * Wires panel guide buttons to share workflow helpers.
 *
 * @param {GuideControlsOptions} [options]
 * @returns {GuideControls}
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

  /**
   * Registers click handlers on the guide controls rendered in the panel.
   * @param {Element | null} panel
   * @returns {void}
   */
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
