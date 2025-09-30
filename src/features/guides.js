const SUMMARY_GUIDE_PROMPT = `
당신은 "장기기억 보관용 사서"입니다.
아래 파일은 캐릭터 채팅 로그를 정형화한 것입니다.
목표는 이 데이터를 2000자 이내로 요약하여, 캐릭터 플랫폼의 "유저노트"에 넣을 수 있는 형식으로 정리하는 것입니다.

조건:
1. 중요도 기준
   - 플레이어와 NPC 관계 변화, 약속, 목표, 갈등, 선호/금기만 포함.
   - 사소한 농담·잡담은 제외.
   - 최근일수록 더 비중 있게 반영.

2. 출력 구조
   - [전체 줄거리 요약]: 주요 사건 흐름을 3~6개 항목으로.
   - [주요 관계 변화]: NPC별 감정/태도 변화를 정리.
   - [핵심 테마]: 반복된 규칙, 세계관 요소, 목표.

3. 형식 규칙
   - 전체 길이는 1200~1800자.
   - 문장은 간결하게.
   - 플레이어 이름은 "플레이어"로 통일.
`;

const RESUMMARY_GUIDE_PROMPT = `
아래에는 [이전 요약본]과 [새 로그 파일]이 있습니다.
이 둘을 통합하여, 2000자 이내의 "최신 장기기억 요약본"을 만드세요.

규칙:
- 이전 요약본에서 이미 있는 사실은 유지하되, 새 로그 파일에 나온 사건/관계 변화로 업데이트.
- 모순되면 "최근 사건"을 우선.
- 출력 구조는 [전체 줄거리 요약] / [주요 관계 변화] / [핵심 테마].
- 길이는 1200~1800자.
`;

export function createGuidePrompts({
  clipboard,
  setPanelStatus,
  statusMessages = {},
} = {}) {
  if (!clipboard || typeof clipboard.set !== 'function') {
    throw new Error('createGuidePrompts requires clipboard helper');
  }

  const notify = (message, tone) => {
    if (typeof setPanelStatus === 'function' && message) {
      setPanelStatus(message, tone);
    }
  };

  const summaryMessage = statusMessages.summaryCopied || '요약 프롬프트가 클립보드에 복사되었습니다.';
  const resummaryMessage =
    statusMessages.resummaryCopied || '재요약 프롬프트가 클립보드에 복사되었습니다.';

  const copySummaryGuide = () => {
    clipboard.set(SUMMARY_GUIDE_PROMPT, { type: 'text', mimetype: 'text/plain' });
    notify(summaryMessage, 'success');
    return SUMMARY_GUIDE_PROMPT;
  };

  const copyResummaryGuide = () => {
    clipboard.set(RESUMMARY_GUIDE_PROMPT, { type: 'text', mimetype: 'text/plain' });
    notify(resummaryMessage, 'success');
    return RESUMMARY_GUIDE_PROMPT;
  };

  return {
    copySummaryGuide,
    copyResummaryGuide,
    prompts: {
      summary: SUMMARY_GUIDE_PROMPT,
      resummary: RESUMMARY_GUIDE_PROMPT,
    },
  };
}
