# codex – 미성년자 성적 맥락 감지 개선 메모

## 현재 문제
- 전체 `rawText`에 대해 정규식 한 번만 돌면서 미성년 키워드와 성적 키워드가 멀리 떨어져 있어도 차단 플래그가 켜짐.
- 숫자/은어 기반 연령 표현(`17살`, `고1`, `애새끼`, `underage`)이 누락돼 실제 위험을 놓칠 수 있음.
- 교육, 상담, 예방 캠페인 등 안전한 문맥을 구분하지 못해 false positive 많음.

## 개선 아이디어
- `hasMinorSexualContext`를 문장/턴 단위로 재작성하고, 80~120자 슬라이딩 윈도우 내에서만 위험 키워드 조합을 인정.
- 미성년 키워드 세트를 함수화해 숫자 패턴(`(?:13|14|15|16|17)\s*살`, `중[1-3]`, `고[1-3]`, `teen(ager)?`)과 은어 표현을 추가.
- 위험도를 단순 boolean이 아닌 점수화(`minor +2`, `sexual +2`, `explicit act +3`, `negative context -2`)해 threshold 이상일 때만 차단.
- 문장에 `교육`, `예방`, `상담`, `캠페인` 등 보호 문맥 단어가 포함되면 감점하여 false positive를 줄임.
- 감지 결과에 어떤 문장과 키워드 조합이 기여했는지 `blocked_details`에 기록해 운영자 점검을 돕기.

## 후속 작업 제안
- `tests/unit/privacy-redaction.spec.js`에 false positive 사례(교육 안내)와 true positive 사례(연령+explicit 묘사) 추가.
- `docs/role-classification-heuristics.md`와 `README.md`의 차단 로직 설명을 문장 기반 감지 & 점수 체계에 맞게 갱신.
- Tampermonkey 수동 QA에서 정상 시나리오와 차단 시나리오 모두 재현해 확인.
