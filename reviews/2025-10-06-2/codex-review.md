# Codex Review — 2025-10-06-2

## 요청 정리
- 현재 스크립트가 과도하게 복잡해졌는지, 충돌 가능성이 있는지, 예상 버그가 있는지 점검
- 중장기적으로 TypeScript 리팩토링이 언제 적절할지 제안

## 구조 및 복잡도 평가
- `src/` 모듈 구조와 `scripts/build.js`를 통한 번들 파이프라인이 비교적 명확하게 유지되고 있어, 범용 Tampermonkey 스크립트치고는 무거운 편이지만 기능 범위를 고려하면 과도한 엔지니어링 단계까지는 아님.
- 다만 `src/adapters/genit.js`가 800+ 라인으로 단일 파일에 DOM 휴리스틱, 구조화 수집, 내보내기 라우팅이 모두 섞여 있음. 향후 유지보수를 위해 `narration/players/info` 파트별 서브 모듈로 분리하거나 최소한 헬퍼 단위로 나누는 편이 안정성을 높일 수 있음.
- 상태·프라이버시·자동 스크롤 등 서브 시스템이 `createX` 팩토리 패턴을 공유하고 있어 확장에는 유리하지만, 의존 관계가 암묵적으로 얽혀 있음 (`src/index.js` 내에서 초기화 순서가 중요). 의존성 주입 지점에 JSDoc 타입/주석을 추가하면 추후 TS 전환 시 이해 비용을 줄일 수 있음.

## 잠재 버그 및 위험 요인
- **중복 대사 누락 가능성 (`src/adapters/genit.js:725-730`)**: `collectStructuredMessage`가 블록 내 문자열을 `Set`으로 중복 제거하기 때문에 동일 문장을 연속으로 말하는 케이스가 Classic/구조화 Export에서 사라짐. INFO 중복 제거 목적이지만, 실제 대화 데이터 손실이 될 수 있으므로 중복 제거는 INFO 영역 한정 또는 `(node, index)` 기반 키로 재조정 필요.
- **단어 단위 내레이션 누락 (`src/adapters/genit.js:596-608`)**: `shouldSkipNarrationLine`이 단어 수 1개이면서 `looksLikeName`이면 무조건 필터링. “정적”, “침묵” 같은 짧은 묘사도 빠질 가능성이 있어 Tailwind muted 파트에서 누락 위험. 최소한 구두점 여부가 아니라 DOM 컨텍스트(예: `.text-muted-foreground`)를 추가 확인하거나, 테스트 스냅샷으로 검증 필요.
- **Export Range 갱신 편차 (`src/features/auto-loader.js:215-234`)**: 자동 로딩 통계가 `Math.max(previousTotals, newTotals)`로만 증가하도록 되어 있어, 새 대화로 전환했을 때 이전 대화의 message/user 카운터가 남아 범위 선택이 과도해질 수 있음. 새로운 세션 감지 시(예: URL, adapter `resetInfoRegistry`) 명시적으로 `exportRange.clear()` 또는 `setTotals` 리셋 로직이 필요.
- **성능 여유 감시**: 전역 `MutationObserver`와 INFO 마킹 시 `querySelectorAll('*')`가 반복 실행되므로 브라우저 성능 이슈가 발생할 수 있음. 현재는 문제 없지만, DOM이 매우 큰 세션을 처리할 때 CPU 사용량을 관찰하고, 필요 시 batching/threshold를 마련해두는 것이 좋음.

## TypeScript 리팩토링 제안
1. **사전 정비 (현재~단기)**: `src/` 전역에 JSDoc 타입 주석과 `@typedef`를 도입하고, `npm scripts`에 `tsc --noEmit --allowJs` 체크를 추가해 타입 경고를 수집. 이 단계에서 의존성 그래프와 암묵적 계약을 정리.
2. **도메인 단위 전환 (1~2개월)**: 비교적 독립적인 유틸·core 모듈(`src/utils/*`, `src/core/state.js` 등)부터 `.ts`로 이동. Rollup 빌드 파이프라인에 esbuild/ts-plugin을 붙여도 구조가 단순하므로 리스크가 낮음.
3. **고위험 영역 (3개월~)**: `src/adapters/genit.js`와 `src/features/*`는 DOM 타입, `GM_*` API, Tampermonkey 환경 타입 정의가 필요하므로, 앞선 단계에서 확보한 타입 추상화/인터페이스를 활용. 기능 추가가 한동안 잦지 않은 스프린트를 골라 단계적 적용.
4. **최종 통합**: 전환이 완료되면 `genit-memory-helper.user.js` 생성 스텝에서 `.d.ts` 출력 또는 타입 검증 CI를 추가하고, README/문서에서 개발 흐름 업데이트.

## 추가 메모
- 테스트 스위트(`npm test`)는 정상 통과. 하지만 위 위험 지점에 대한 회귀 테스트(중복 대사, 단어 내레이션, range 리셋)를 추가하면 안전망이 강화됨.
- 리팩토링 전에 구조화 Export/Auto Loader 관련 DOM 샘플과 기대 결과를 `samples/` 혹은 `tests/fixtures`에 보강해두는 것이 TS 도입 시 안전.
