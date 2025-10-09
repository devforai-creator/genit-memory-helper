interface GuideControlsOptions {
  reparse?: () => void;
  copySummaryGuide: () => Promise<void> | void;
  copyResummaryGuide: () => Promise<void> | void;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export function createGuideControls({
  reparse,
  copySummaryGuide,
  copyResummaryGuide,
  logger = typeof console !== 'undefined' ? console : null,
}: GuideControlsOptions) {
  if (typeof copySummaryGuide !== 'function' || typeof copyResummaryGuide !== 'function') {
    throw new Error('createGuideControls requires summary and resummary copy functions');
  }

  const bindGuideControls = (panel: Element | null): void => {
    if (!panel || typeof panel.querySelector !== 'function') {
      logger?.warn?.('[GMH] guide controls: panel missing querySelector');
      return;
    }

    const reparseBtn = panel.querySelector<HTMLButtonElement>('#gmh-reparse');
    if (reparseBtn && typeof reparse === 'function') {
      reparseBtn.addEventListener('click', () => reparse());
    }

    const guideBtn = panel.querySelector<HTMLButtonElement>('#gmh-guide');
    if (guideBtn) {
      guideBtn.addEventListener('click', () => {
        void copySummaryGuide();
      });
    }

    const reguideBtn = panel.querySelector<HTMLButtonElement>('#gmh-reguide');
    if (reguideBtn) {
      reguideBtn.addEventListener('click', () => {
        void copyResummaryGuide();
      });
    }
  };

  return { bindGuideControls };
}
