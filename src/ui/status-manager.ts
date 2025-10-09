import type { PanelVisibilityController } from '../types';

interface StatusTone {
  color: string;
  icon: string;
}

interface StatusManagerOptions {
  panelVisibility?: PanelVisibilityController | null;
}

export const STATUS_TONES: Record<string, StatusTone> = {
  success: { color: '#34d399', icon: '✅' },
  info: { color: '#93c5fd', icon: 'ℹ️' },
  progress: { color: '#facc15', icon: '⏳' },
  warning: { color: '#f97316', icon: '⚠️' },
  error: { color: '#f87171', icon: '❌' },
  muted: { color: '#cbd5f5', icon: '' },
};

interface StatusManager {
  STATUS_TONES: typeof STATUS_TONES;
  attachStatusElement(element: HTMLElement | null): void;
  setStatus(message: unknown, toneOrColor?: string | null): void;
}

/**
 * Creates a minimal status manager that updates panel status text and notifies listeners.
 */
export function createStatusManager({ panelVisibility }: StatusManagerOptions = {}): StatusManager {
  let statusElement: HTMLElement | null = null;

  /**
   * Sets the DOM element where panel status text renders.
   */
  const attachStatusElement = (element: HTMLElement | null): void => {
    statusElement = element ?? null;
  };

  /**
   * Updates the status element text and tone styling.
   */
  const setStatus = (message: unknown, toneOrColor: string | null = 'info'): void => {
    if (!statusElement) return;
    const text = String(message || '');
    let icon = '';
    let color = '#9ca3af';
    let tone: string | null | undefined = toneOrColor ?? undefined;

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

    panelVisibility?.onStatusUpdate?.({ tone: tone ?? null });
  };

  return {
    STATUS_TONES,
    attachStatusElement,
    setStatus,
  };
}
