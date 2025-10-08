# Codex Meta-Review – 2025-09-30

## Gemini Review Assessment
- **Strengths**: 정확하게 하이브리드 구조와 모듈 경계를 짚었고, Rollup/테스트 파이프라인 등 프로젝트 운영 측면을 긍정적으로 정리했습니다. 신규 기여자 관점에서 전체 그림을 이해하기에는 도움이 됩니다.
- **누락/오류**: 실질적인 버그, 보안, 회귀 가능성은 전혀 다루지 않아 현재 발견된 치명적 결함(예: `src/export/writers-structured.js:28`, `src/features/snapshot.js:112-161`)을 놓쳤습니다. 테스트 공백이나 문서 불일치도 언급되지 않았습니다.
- **Actionability**: 제안(레거시 제거, TypeScript 도입, 환경 변수 문서화)은 모두 중·장기 과제이며 우선순위 근거가 없습니다. 단기 안전성 확보를 위한 체크리스트로는 사용이 어렵습니다.

## Claude Review Assessment
- **Strengths**: 전 영역(보안/성능/아키텍처/테스트/품질)을 커버하고, 단계별 로드맵과 테스트 할 일 목록을 제시한 점은 유용합니다. 다양한 refactor/문서화 아이디어가 정리되어 있어 장기 기획에 참고할 가치가 있습니다.
- **검증 결과**: 일부 HIGH 우선순위 이슈는 과장되었습니다. 예를 들어 `src/ui/modal.js:20-41`는 `<template>`을 사용해 스크립트를 실제 DOM에 넣기 전에 제거하므로 지적한 "내부 script 즉시 실행" 위험은 재현되지 않았습니다. 같은 이유로 제안된 DOMParser 대체는 우선순위가 낮습니다. `src/privacy/settings.js`의 localStorage 로드 역시 문자열 이외 값을 모두 정규화·필터(`normalizeList`)하고 있어 치명적이라고 보긴 어렵습니다(입력 길이 제한이 없긴 하나, 영향은 성능 저하 수준). 또 커버리지 수치와 매직 넘버 규모 등은 근거 데이터가 함께 제공되지 않았습니다.
- **Coverage Gaps**: 우리 쪽에서 확인한 실제 회귀 위험(Structured Markdown 코드 블록 출력, 중복 대사 누락)은 이 리뷰에서도 빠져 있습니다. 보안 진단 위주라서 내보내기 파이프라인의 신뢰성 검증이 필요합니다.

## 통합 로드맵 제안
1. **즉시 (Stability)**
   - Structured Markdown 코드펜스 이슈 수정 (`src/export/writers-structured.js:28` → 실 백틱 출력 후 테스트 보강).
   - Snapshot 중복 대사 누락 해결 (`src/features/snapshot.js:112-161` 전역 dedupe 제거 또는 `(originIndex,text)` 키 사용).
   - Gemini·Claude 리뷰 둘 다 놓친 부분이지만 사용자 영향이 즉시 나타나는 회귀라 최우선으로 둡니다.

2. **보안·데이터 위생 (Risk Review)**
   - Modal sanitizer가 현재 수준으로도 script를 제거하는지 추가 테스트(템플릿 삽입 E2E)만 작성해 근거 확보.
   - localStorage 로드에 길이 제한·엔트리 수 제한을 추가하는 것은 부담이 적으니 Phase 1 backlog에 둡니다.

3. **성능/테스트 (Phase 1-2)**
   - Claude 체크리스트 중 실제 체감 개선이 큰 항목(자동 로더 캐싱, 핵심 경로 테스트 케이스)을 우선 선정.
   - Gemini가 언급한 레거시 번들/모듈 이원화 문제도 테스트가 안정된 뒤 리팩터링 대상으로 편성합니다.

4. **중장기 (Phase 3+)**
   - 환경 변수 문서화, TypeScript 점진 도입, 문서/ADR 갱신은 두 리뷰의 공통 제안 중 위험이 낮은 작업으로 묶어 후순위에 배치합니다.

위 순서대로 진행하면 두 리뷰의 장점(전략적 제안, 운영 관점 정리)을 살리면서도 실제로 확인된 안정성 이슈부터 해소할 수 있습니다.
