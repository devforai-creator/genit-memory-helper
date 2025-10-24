import { ensureDesignSystemStyles } from './styles';
import type { ModalController } from '../types';

interface PrivacyConfig {
  blacklist?: string[];
  whitelist?: string[];
}

interface PrivacyConfiguratorOptions {
  privacyConfig: PrivacyConfig;
  setCustomList(type: string, values: string[]): void;
  parseListInput(value: string): string[];
  setPanelStatus(message: string, tone?: string | null): void;
  modal: ModalController;
  documentRef?: Document | null;
}

interface PrivacyConfigurator {
  configurePrivacyLists(): Promise<void> | void;
}

/**
 * Creates privacy list configuration helpers for modal or legacy prompts.
 */
export function createPrivacyConfigurator({
  privacyConfig,
  setCustomList,
  parseListInput,
  setPanelStatus,
  modal,
  documentRef = typeof document !== 'undefined' ? document : null,
}: PrivacyConfiguratorOptions): PrivacyConfigurator {
  if (!documentRef) throw new Error('createPrivacyConfigurator requires document');

  const doc = documentRef;

  /**
   * Launches the design-system modal for editing privacy lists.
   */
  const configurePrivacyListsModern = async (): Promise<void> => {
    ensureDesignSystemStyles(doc);

    const stack = doc.createElement('div');
    stack.className = 'gmh-modal-stack';

    const intro = doc.createElement('p');
    intro.className = 'gmh-subtext';
    intro.textContent =
      '쉼표 또는 줄바꿈으로 여러 항목을 구분하세요. 블랙리스트는 강제 마스킹, 화이트리스트는 예외 처리됩니다.';
    stack.appendChild(intro);

    const makeLabel = (text: string): HTMLDivElement => {
      const label = doc.createElement('div');
      label.className = 'gmh-field-label';
      label.textContent = text;
      return label;
    };

    const blackLabel = makeLabel(`블랙리스트 (${privacyConfig.blacklist?.length || 0})`);
    stack.appendChild(blackLabel);

    const blackTextarea = doc.createElement('textarea');
    blackTextarea.id = 'gmh-privacy-blacklist';
    blackTextarea.className = 'gmh-textarea';
    blackTextarea.placeholder = '예: 서울시, 010-1234-5678';
    blackTextarea.value = privacyConfig.blacklist?.join('\n') || '';
    stack.appendChild(blackTextarea);

    const whiteLabel = makeLabel(`화이트리스트 (${privacyConfig.whitelist?.length || 0})`);
    stack.appendChild(whiteLabel);

    const whiteTextarea = doc.createElement('textarea');
    whiteTextarea.id = 'gmh-privacy-whitelist';
    whiteTextarea.className = 'gmh-textarea';
    whiteTextarea.placeholder = '예: 공식 길드명, 공개 닉네임';
    whiteTextarea.value = privacyConfig.whitelist?.join('\n') || '';
    stack.appendChild(whiteTextarea);

    const confirmed = Boolean(
      await modal.open({
        title: '프라이버시 민감어 관리',
        size: 'large',
        content: stack,
        actions: [
          {
            id: 'cancel',
            label: '취소',
            variant: 'secondary',
            value: false,
            attrs: { 'data-action': 'cancel' },
          },
          {
            id: 'save',
            label: '저장',
            variant: 'primary',
            value: true,
            attrs: { 'data-action': 'save' },
          },
        ],
        initialFocus: '#gmh-privacy-blacklist',
      }),
    );

    if (!confirmed) {
      setPanelStatus('프라이버시 설정 변경을 취소했습니다.', 'muted');
      return;
    }

    setCustomList('blacklist', parseListInput(blackTextarea.value));
    setCustomList('whitelist', parseListInput(whiteTextarea.value));
    setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'success');
  };

  /**
   * Opens either the modern modal or legacy prompt workflow.
   */
  const configurePrivacyLists = async (): Promise<void> => {
    await configurePrivacyListsModern();
  };

  return {
    configurePrivacyLists,
  };
}
