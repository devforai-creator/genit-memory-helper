const STATUS_TONES = {
  success: { color: '#34d399', icon: '✅' },
  info: { color: '#93c5fd', icon: 'ℹ️' },
  progress: { color: '#facc15', icon: '⏳' },
  warning: { color: '#f97316', icon: '⚠️' },
  error: { color: '#f87171', icon: '❌' },
  muted: { color: '#cbd5f5', icon: '' },
};

export function createStatusManager({ panelVisibility } = {}) {
  let statusElement = null;

  const attachStatusElement = (element) => {
    statusElement = element || null;
  };

  const setStatus = (message, toneOrColor = 'info') => {
    if (!statusElement) return;
    const text = String(message || '');
    let icon = '';
    let color = '#9ca3af';
    let tone = toneOrColor;

    if (typeof toneOrColor === 'string' && toneOrColor.startsWith('#')) {
      color = toneOrColor;
      tone = null;
    } else if (typeof toneOrColor === 'string' && STATUS_TONES[toneOrColor]) {
      tone = toneOrColor;
    } else if (!toneOrColor) {
      tone = 'info';
    }

    if (tone && STATUS_TONES[tone]) {
      color = STATUS_TONES[tone].color;
      icon = STATUS_TONES[tone].icon || '';
    }

    statusElement.textContent = icon ? `${icon} ${text}` : text;
    statusElement.style.color = color;
    if (tone) statusElement.dataset.tone = tone;
    else delete statusElement.dataset.tone;

    panelVisibility?.onStatusUpdate?.({ tone });
  };

  return {
    STATUS_TONES,
    attachStatusElement,
    setStatus,
  };
}

export { STATUS_TONES };
