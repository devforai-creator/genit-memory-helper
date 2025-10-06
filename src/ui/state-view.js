export const STATE_PRESETS = {
  idle: {
    label: '대기 중',
    message: '준비 완료',
    tone: 'info',
    progress: { value: 0 },
  },
  scanning: {
    label: '스크롤/수집 중',
    message: '위로 불러오는 중...',
    tone: 'progress',
    progress: { indeterminate: true },
  },
  redacting: {
    label: '민감정보 마스킹 중',
    message: '레다크션 파이프라인 적용 중...',
    tone: 'progress',
    progress: { indeterminate: true },
  },
  preview: {
    label: '미리보기 준비 완료',
    message: '레다크션 결과를 검토하세요.',
    tone: 'info',
    progress: { value: 0.75 },
  },
  exporting: {
    label: '내보내기 진행 중',
    message: '파일을 준비하는 중입니다...',
    tone: 'progress',
    progress: { indeterminate: true },
  },
  done: {
    label: '작업 완료',
    message: '결과를 확인하세요.',
    tone: 'success',
    progress: { value: 1 },
  },
  error: {
    label: '오류 발생',
    message: '작업을 다시 시도해주세요.',
    tone: 'error',
    progress: { value: 1 },
  },
};

/**
 * Builds the state view binder so the panel shows current workflow progress.
 */
export function createStateView({ stateApi, statusManager, stateEnum }) {
  if (!stateApi) throw new Error('createStateView requires stateApi');
  if (!statusManager) throw new Error('createStateView requires statusManager');

  let progressFillEl = null;
  let progressLabelEl = null;
  let unsubscribe = null;

  const clamp = (value) => {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  };

  const setPanelStatus = statusManager.setStatus;

  const applyState = (stateKey, meta = {}) => {
    const payload = meta?.payload || {};
    const preset = STATE_PRESETS[stateKey] || STATE_PRESETS.idle;
    const label = payload.label || preset.label || '';
    const tone = payload.tone || preset.tone || 'info';
    const message = payload.message || preset.message || label || '';
    const progress = payload.progress || preset.progress || null;

    if (progressLabelEl) progressLabelEl.textContent = label || ' ';

    if (progressFillEl) {
      if (progress?.indeterminate) {
        progressFillEl.dataset.indeterminate = 'true';
        progressFillEl.style.width = '40%';
        progressFillEl.setAttribute('aria-valuenow', '0');
      } else {
        progressFillEl.dataset.indeterminate = 'false';
        const value = clamp(progress?.value);
        progressFillEl.style.width = `${Math.round(value * 100)}%`;
        progressFillEl.setAttribute('aria-valuenow', String(value));
      }
      progressFillEl.dataset.state = stateKey || 'idle';
      if (label) progressFillEl.setAttribute('aria-valuetext', label);
    }

    if (message) setPanelStatus(message, tone);
  };

  const bind = ({ progressFill, progressLabel } = {}) => {
    progressFillEl = progressFill || null;
    progressLabelEl = progressLabel || null;
    if (typeof unsubscribe === 'function') unsubscribe();
    if (progressFillEl) {
      progressFillEl.setAttribute('role', 'progressbar');
      progressFillEl.setAttribute('aria-valuemin', '0');
      progressFillEl.setAttribute('aria-valuemax', '1');
      progressFillEl.setAttribute('aria-valuenow', '0');
      progressFillEl.setAttribute('aria-live', 'polite');
    }
    if (progressLabelEl) {
      progressLabelEl.setAttribute('aria-live', 'polite');
    }
    unsubscribe = stateApi.subscribe?.((state, meta) => {
      applyState(state, meta);
    });
    const current = stateApi.getState?.() || stateEnum?.IDLE || 'idle';
    applyState(current, { payload: STATE_PRESETS[current] || {} });
  };

  return { bind };
}
