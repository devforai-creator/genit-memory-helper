import { ensureDesignSystemStyles } from './styles.js';

export function createPrivacyConfigurator({
  privacyConfig,
  setCustomList,
  parseListInput,
  setPanelStatus,
  modal,
  isModernUIActive,
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!privacyConfig) throw new Error('createPrivacyConfigurator requires privacyConfig');
  if (!setCustomList) throw new Error('createPrivacyConfigurator requires setCustomList');
  if (!parseListInput) throw new Error('createPrivacyConfigurator requires parseListInput');
  if (!setPanelStatus) throw new Error('createPrivacyConfigurator requires setPanelStatus');
  if (!modal) throw new Error('createPrivacyConfigurator requires modal');
  if (!documentRef) throw new Error('createPrivacyConfigurator requires document');

  const doc = documentRef;
  const win = windowRef;

  const resolveModernActive = () =>
    typeof isModernUIActive === 'function' ? isModernUIActive() : Boolean(isModernUIActive);

  const configurePrivacyListsModern = async () => {
    ensureDesignSystemStyles(doc);

    const stack = doc.createElement('div');
    stack.className = 'gmh-modal-stack';

    const intro = doc.createElement('p');
    intro.className = 'gmh-subtext';
    intro.textContent =
      '쉼표 또는 줄바꿈으로 여러 항목을 구분하세요. 블랙리스트는 강제 마스킹, 화이트리스트는 예외 처리됩니다.';
    stack.appendChild(intro);

    const makeLabel = (text) => {
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

    const confirmed = await modal.open({
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
    });

    if (!confirmed) {
      setPanelStatus('프라이버시 설정 변경을 취소했습니다.', 'muted');
      return;
    }

    setCustomList('blacklist', parseListInput(blackTextarea.value));
    setCustomList('whitelist', parseListInput(whiteTextarea.value));
    setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'success');
  };

  const configurePrivacyListsLegacy = () => {
    const currentBlack = privacyConfig.blacklist?.join('\n') || '';
    const nextBlack = win?.prompt
      ? win.prompt(
          '레다크션 강제 대상(블랙리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.',
          currentBlack,
        )
      : null;
    if (nextBlack !== null) {
      setCustomList('blacklist', parseListInput(nextBlack));
    }

    const currentWhite = privacyConfig.whitelist?.join('\n') || '';
    const nextWhite = win?.prompt
      ? win.prompt(
          '레다크션 예외 대상(화이트리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.',
          currentWhite,
        )
      : null;
    if (nextWhite !== null) {
      setCustomList('whitelist', parseListInput(nextWhite));
    }
    setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'info');
  };

  const configurePrivacyLists = async () => {
    if (resolveModernActive()) return configurePrivacyListsModern();
    return configurePrivacyListsLegacy();
  };

  return {
    configurePrivacyLists,
  };
}
