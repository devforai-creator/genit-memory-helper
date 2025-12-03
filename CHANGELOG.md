# Changelog

## Unreleased

### 🧪 Tests

- MessageIndexer 단위 테스트 추가: 프리뷰 필터링, 비동기 refresh 경로, 컨테이너 변경 시 리스너 가드, ordinal lookup 검증
- BlockBuilder 테스트 확장: 이전 블록 시드, 세션 URL 리졸버 실패 fallback, INFO-only 원문 제외
- Privacy 파이프라인 E2E 테스트: 세션/스냅샷 전체 redaction, 차단/디버그 로깅 경로 커버
- Utils 테스트 추가: DOM 헬퍼(triggerDownload, isScrollable, sleep)와 validation(looksLikeName, luhnValid, requireDeps)
- Babechat 어댑터 커버리지 강화: DOM 블록 파싱, 구조화 수집, API 파라미터/쿨다운 흐름, 초기 시나리오 프리펜드 경로
- Auto-loader/스냅샷/BlockStorage 커버리지 확장: API 수집 경로, 필수 의존성 가드, progressive snapshot 사용, meta summary/embedding 검증
- Core utils(clone/deepMerge) 커버리지 추가: 직렬화 실패 fallback, 배열/중첩 머지 경로
- Babechat 어댑터 테스트 격리: fetch/XHR 인터셉터 후 글로별/프로토타입 정리로 후행 테스트 오염 방지
- BlockStorage 테스트 안정화: 결정적 ID/DB 이름, 가벼운 fake IndexedDB로 엔진/업그레이드 경로 포함한 영속성 검증
- 커버리지 스냅샷: 전체 라인 77.51%, src 라인 78.78%, adapters 82.37%, core 83.74%, features 74.17%, storage 85.14%, privacy/pipeline 97.77%

## v3.1.1 (2025-12-01)

### 🔒 Security

- **API Rate Limiting (babechat)**: API 기반 메시지 수집에 60초 쿨다운 추가
  - 플랫폼 서버 부담 최소화
  - 사용자 계정 보호 (과도한 요청으로 인한 제재 방지)
  - `getApiCooldownRemaining()` 메서드 추가
  - 쿨다운 중 호출 시 남은 시간 안내 메시지

### 🐛 Fixes

- **메타 요약 UI 즉시 갱신**: 청크 요약 저장 후 메타 요약 섹션이 즉시 갱신되도록 수정 (기존: 페이지 새로고침 필요)
  - `refreshMetaSection()` 함수 추가

### 🧪 Tests

- **babechat-ratelimit.spec.ts** (+6개): API rate limiting 테스트
- 테스트 커버리지: 212 → 218개 (+6개)

## v3.1.0 (2025-12-01)

### ✨ New Features

- **메타 요약 (Meta Summary)**: 10개 청크 요약을 1개의 통합 요약으로 압축하는 계층적 요약 시스템
  - **10개 청크 그룹화**: 요약이 완료된 청크 10개를 하나의 메타 그룹으로 묶음
  - **메타 요약 프롬프트**: 10개 청크 요약을 입력으로 받아 ~500자 통합 요약 생성
  - **메타 요약 저장**: IndexedDB `meta-summaries` 스토어에 영구 저장
  - **계층적 복사**: "전체 요약 복사" 시 메타 요약된 청크는 제외하고 메타 요약만 포함
    - 예: 25개 청크 → 메타 2개 + 청크 5개 = 최적의 유저노트 길이

### 🏗️ Architecture

- **IndexedDB v2 마이그레이션**: `meta-summaries` 오브젝트 스토어 추가
- **types/index.ts**: `MetaSummaryInit`, `MetaSummaryRecord` 인터페이스 추가
- **block-storage.ts**: 메타 요약 CRUD 메서드 (`saveMeta`, `getMeta`, `getMetaBySession`, `deleteMeta`, `clearMeta`)
- **memory-prompts.ts**: `buildMetaSummaryPrompt()`, `groupChunksForMeta()` 함수 추가
- **dual-memory-controls.ts**:
  - `renderMetaSummarySection()`: 메타 요약 UI 렌더링
  - `buildHierarchicalSummary()`: 계층적 요약 생성 로직
  - `getMetaCoveredIndices()`: 메타 요약으로 커버된 청크 추적

### 🎨 UI

- **메타 요약 섹션**: 청크 10개 단위로 메타 요약 생성 UI 표시 (보라색 테마)
- **메타 프롬프트 복사 버튼**: 각 메타 그룹에 대한 프롬프트 복사
- **메타 요약 입력/저장**: textarea + 저장 버튼
- **배지 업데이트**: "메타 완료" 상태 표시

### 🧪 Tests

- **meta-summary.spec.ts** (+18개):
  - `groupChunksForMeta` 테스트 (5개)
  - `buildMetaSummaryPrompt` 테스트 (3개)
  - block-storage 메타 CRUD 테스트 (10개)
- 테스트 커버리지: 194 → 212개 (+18개)

## v3.0.1 (2025-12-01)

### 🐛 Fixes

- **저장된 청크 로드 타이밍 수정**: 패널이 IndexedDB보다 먼저 마운트되면 저장된 요약/Facts가 표시되지 않던 문제 해결
  - `waitForStorage()` 헬퍼 추가 (최대 5초 대기, 500ms 간격)
  - 페이지 새로고침 없이도 저장된 데이터가 정상적으로 로드됨

## v3.0.0 (2025-12-01)

### ✨ New Features

- **Dual Memory System (이중 기억 시스템)**: 대화를 청크 단위로 분할하여 요약/Facts를 생성하고 IndexedDB에 영구 저장하는 새로운 기억 관리 시스템
  - **10메시지 청킹**: 대화를 10개 메시지 단위로 자동 분할
  - **요약 프롬프트**: 각 청크에 대해 LLM 요약 생성용 프롬프트 복사 기능
  - **Facts 프롬프트**: 청크에서 구체적 사실 추출용 프롬프트 복사 기능
  - **결과 입력 UI**: 외부 LLM에서 생성한 요약/Facts를 붙여넣기하는 인터페이스
  - **IndexedDB 영구 저장**: 청크별 요약/Facts를 브라우저에 영구 저장
  - **유저노트 복사**: 전체 요약/Facts/통합본을 클립보드에 복사하여 플랫폼 유저노트에 붙여넣기

### 🏗️ Architecture

- **memory-chunker.ts**: 메시지 청킹 및 청크↔블록 변환 함수
  - `createChunks()`: 메시지 배열을 청크로 분할
  - `chunkToBlockInit()`: MemoryChunk → MemoryBlockInit 변환
  - `blockRecordToChunk()`: MemoryBlockRecord → MemoryChunk 변환
- **memory-prompts.ts**: 요약/Facts 프롬프트 템플릿 및 빌더 함수
- **dual-memory-controls.ts**: 청킹 UI, 결과 입력, IndexedDB 저장/로드, 유저노트 복사
- **memory-panel.ts**: Dual Memory 패널 렌더링 및 상태 관리
- **block-storage.ts 확장**: `summary`/`facts` 필드 저장 및 조회 지원

### 🧪 Tests

- **memory-chunker.spec.ts** (+17개): 청킹, 프롬프트 생성, 변환 함수 테스트
- **block-storage.spec.ts** (+8개): summary/facts 저장, 조회, 클론 테스트
- 테스트 커버리지: 159 → 194개 (+35개, +22%)

### 📚 Documentation

- **docs/DUAL_MEMORY_SYSTEM.md**: Dual Memory 시스템 설계 문서
- **ROADMAP.md**: v3.0.0 체크리스트 완료 표시

## v2.5.0 (2025-11-30)

### 🔧 Internal

- **디버그 로깅 시스템**: `ENV.debugLog()` 추가 - `gmh_debug=1` 플래그 활성화 시에만 콘솔 출력
- **console.log 정리**: babechat.ts, html-export.ts의 9개 디버그 로그를 조건부 출력으로 변경
- **SoT 위반 수정**: `localStorage` 직접 접근을 `ENV.localStorage`로 통일
- **의존성 업데이트** (patch/minor): prettier, rollup, @playwright/test, playwright, @types/node

### 🔒 Security

- **vite 5.4 → 7.2**: 5개 moderate 취약점 해결 (0 vulnerabilities)
- **vitest 2.1 → 4.0**: vite 7과 호환성 업그레이드, `--minWorkers` 옵션 제거

### 📦 Dependencies

- **jsdom 24 → 27**: major 업그레이드 (테스트 호환성 유지)

### 🧪 Tests

- **babechat 어댑터 테스트** (+18개): hostname 매칭, role 감지, speaker 파싱, API 수집
- **privacy-gate 테스트** (+12개): 팩토리 검증, confirm 흐름, 모달 렌더링
- **share-workflow 테스트** (+18개): parseAll, prepareShare, performExport 검증
- 테스트 커버리지: 111 → 159개 (+48개, +43%)

## v2.4.0 (2025-01-30)

### ✨ New Features

- **FAB 위치 설정**: GMH 플로팅 버튼 위치를 4개 코너(좌상/우상/좌하/우하) 중 선택 가능
  - 설정(⚙️) → "GMH 버튼 위치"에서 변경
  - 모바일에서 전송 버튼과 충돌하는 문제 해결
  - **기본값 변경**: 우하단 → 우상단 (채팅 UI 전송 버튼과의 충돌 방지)

## v2.3.0 (2025-01-29)

### 💥 BREAKING CHANGES

- **프로젝트 이름 변경**: "Genit Memory Helper" → "General Memory Helper"
  - GMH 약어는 그대로 유지됩니다
  - `@name` 메타데이터가 변경되어 **Tampermonkey에서 새 스크립트로 인식**될 수 있습니다
  - **마이그레이션 안내**: 기존 스크립트를 수동으로 삭제하고 새 버전을 설치해 주세요

### ✨ New Features

- **babechat.ai 어댑터 추가**: genit.ai 외에 babechat.ai도 지원합니다.
  - Turn 기반 메시지 그룹핑 (`div.flex.flex-col.gap-3.px-5.pt-4`)
  - 플레이어/NPC/나레이션/시스템 메시지 역할 감지
  - `"화자 | 대사"` 형식의 speaker 파싱 지원
  - 시스템 메시지 영역(AI 면책조항, 시나리오, 오프닝) 파싱
  - DOM 순서 보존으로 대사와 나레이션이 원본 구조대로 출력

- **babechat.ai API 기반 메시지 수집**: virtual scroll 한계 극복
  - XHR 인터셉트로 API 파라미터(characterId, roomId) 및 Authorization 헤더 캡처
  - 직접 API 호출로 스크롤 없이 전체 메시지 100% 수집
  - 캐릭터 API 인터셉트로 initialAction(시나리오) + initialMessage(첫 인사) 자동 포함

- **패널 테두리 리사이즈**: 패널의 상/하/좌/우 테두리 및 모서리를 드래그하여 크기 조절 가능

- **🧪 HTML 백업 (실험적)**: 대화를 이미지 포함 standalone HTML로 내보내기

### 🎨 UI 개선

- **버튼 텍스트 개선**: "위로 끝까지 로딩" → "메시지 수집"
- **힌트 텍스트 추가**: "💡 백업 전에 먼저 눌러주세요"
- **babechat API 실패 시 명확한 에러 표시**: 72% 수집되는 fallback 대신 에러 메시지로 안내

### 🗑️ Removed (UI 간소화)

- **Export 섹션**: 최근 15메시지 복사, 전체 MD 복사, 원클릭 내보내기 버튼 삭제
- **Guides & Tools 섹션**: 재파싱, 요약 가이드, 재요약 가이드 버튼 삭제 → "Settings"로 이름 변경
- **Settings 섹션**: 재시도, 안정 모드, DOM 스냅샷 버튼 삭제
- babechat 스크롤 기반 수집 코드 삭제 (API 수집으로 대체)
- 관련 함수/타입 정리: `copyRecent`, `copyAll`, `reparse`, `guides.ts`, `guide-controls.ts` 등

### 🐛 Fixes

- Speaker 이름에 따옴표가 붙는 문제 수정 (`"치류` → `치류`)
- 하드코딩된 플레이어 이름 제거 (`소중한코알라5299`)

## v2.1.0 (YYYY-MM-DD)

### 💥 BREAKING CHANGES

- **Legacy UI removed**: Modern design-system 패널이 기본이자 유일한 인터페이스입니다.
- `gmh_flag_newUI` 플래그 삭제: 추가 토글 없이 항상 Modern UI가 로드됩니다.
- `gmh_kill` 킬스위치는 이제 GMH 전체를 비활성화합니다.

### 🗑️ Removed

- `src/ui/panel-legacy.ts`
- `createLegacyPrivacyGate`, `ensureLegacyPreviewStyles`
- Legacy auto-loader 컨트롤 API (`ensureAutoLoadControlsLegacy`, `mountStatusActionsLegacy`)

### ✨ Enhancements

- **실시간 메시지 파이프라인 안정화**: `MessageIndexer`가 `preview-*` 카드와 중복 노드를 필터링하고, `MessageStream`이 스트리밍 완료를 최대 12회까지 재시도(초기 8초 대기, 이후 3초 간격)하여 블록 생성 타이밍을 안정화합니다.
- **블록 빌더 개선**: 모든 메시지를 빠짐없이 포함하되 INFO/나레이션은 `raw` 출력에서 정리하고, 겹침을 0으로 조정하여 블록 경계를 명확히 했습니다.
- **블록 뷰어 UX 향상**: 긴 메시지를 150자까지 요약해 보여주고 `더보기/접기` 토글로 전체 내용을 확인할 수 있습니다.
- **시험적 기능 플래그 연동**: 메모리 인덱스를 실험 플래그로 제어하면서 Tampermonkey 패널이 즉시 새로운 파이프라인을 반영하도록 했습니다.

### 🐛 Fixes

- 스트리밍 도중 생성되는 빈 내레이션 블록 제거 및 INFO 카드가 단독 블록을 차지하지 않도록 필터링을 추가했습니다.
- 중복된 플레이어 메세지/따옴표가 raw 텍스트와 UI에 반복 표시되던 문제를 해결했습니다.
- 기존 세션을 다시 열었을 때 IndexedDB에 저장된 블록이 패널에서 누락되는 문제를 해결했습니다.

## v2.0.1 (2025-10-24)

### 🐛 Bug Fixes

**범위 입력 필드 회귀 버그 수정**
- v2.0.0 TypeScript 전환 후 발생한 범위 입력 필드 미작동 문제 해결
- 자동 스크롤 중 사용자 지정 범위가 초기화되는 버그 수정

**상세 수정 내역:**
- `src/ui/range-controls.ts`: Optional chaining 제거, 명시적 가드 추가
  - `exportRange.setStart/setEnd` 호출 전 명시적 검증
  - 실패 시 콘솔 경고 출력으로 디버깅 가능성 향상
- `src/features/auto-loader.ts`: 사용자 범위 보존 로직 추가
  - 메시지 총합 감소 시 사용자가 설정한 범위는 `clear()` 건너뜀
  - 자동 스크롤 중에도 범위 설정 유지
- 회귀 방지 테스트 추가
  - `tests/unit/range-controls.spec.ts`: 범위 입력 핸들러 테스트 (3개)
  - `tests/unit/auto-loader.spec.js`: 사용자 범위 보존 테스트 추가

### 🔧 개발 환경 개선

- `package.json`: `pretest` 스크립트에 `USE_ROLLUP=1` 추가
  - TypeScript 빌드를 테스트 전 자동 실행
  - `npm test` 명령만으로 빌드 + 테스트 가능
- `CLAUDE.md`: 빌드 가이드 명확화
  - v2.0.0 이후 `USE_ROLLUP=1` 필수임을 명시
  - 개발 워크플로우 간소화 설명 추가

### 📚 문서 정리

- 리뷰 문서들을 `reviews/2025-09/`로 재구성

## v2.0.0 (2025-10-09)

### 🚀 Breaking Changes

- **전체 코드베이스 TypeScript 전환 완료**: 모든 소스 파일이 TypeScript로 마이그레이션됨
  - 54개 TypeScript 파일 생성
  - strict mode 활성화 (`"strict": true`)
  - 타입 안전성 100% 달성
  - ROADMAP v2.0.0 Phase 1-6 전체 완료

### 아키텍처 개선

**Phase 1: 타입 정의 기반 구축**
- `src/types/index.ts`: 중앙 집중식 타입 정의 파일 생성
- `@rollup/plugin-typescript`: Rollup TypeScript 플러그인 설정
- `tsconfig.json`, `tsconfig.build.json`: TypeScript 설정 구성

**Phase 2: Utils 모듈 전환 (3개)**
- `src/utils/text.ts`: 텍스트 처리 유틸리티
- `src/utils/dom.ts`: DOM 조작 유틸리티
- `src/utils/validation.ts`: 검증 유틸리티

**Phase 3: Core 모듈 전환 (8개)**
- `src/core/namespace.ts`: GMH 네임스페이스
- `src/core/utils.ts`: 코어 유틸리티
- `src/core/state.ts`: 상태 관리
- `src/core/error-handler.ts`: 에러 핸들러
- `src/core/export-range.ts`: 내보내기 범위 컨트롤러
- `src/core/message-indexer.ts`: 메시지 인덱서
- `src/core/turn-bookmarks.ts`: 턴 북마크 관리
- `src/core/bookmark-listener.ts`: 북마크 이벤트 리스너

**Phase 4: Features/Privacy/Export 모듈 전환 (14개)**
- Privacy (5개): constants, settings, redaction, pipeline, index
- Export (5개): parsers, manifest, writers-classic, writers-structured, index
- Features (4개): guides, snapshot, auto-loader, share

**Phase 5: Adapters/UI/Composition 모듈 전환 (24개)**
- Adapters (3개): registry, genit, index
- UI (16개): styles, modal, panel-visibility, state-view, status-manager, privacy-config, privacy-gate, panel-settings, panel-settings-modal, panel-modern, panel-legacy, panel-interactions, panel-shortcuts, range-controls, auto-loader-controls, guide-controls
- Composition (5개): adapter-composition, privacy-composition, share-composition, ui-composition, bootstrap

**Phase 6: 기본 모듈 및 strict mode (4개)**
- `src/utils/factories.ts`: 고차 함수 유틸리티
- `src/config.ts`: 설정 상수
- `src/env.ts`: Tampermonkey 환경 감지
- `src/index.ts`: 메인 엔트리 포인트
- `rollup.config.js`: entry point를 index.ts로 변경
- **strict mode 활성화**: 15개 파일 타입 에러 수정

### 타입 안전성 개선

- null/undefined 체크 강화
- any 타입 제거
- 함수 파라미터/반환값 타입 명시
- DOM 조작 null-safe 처리
- Tampermonkey globals 타입 정의

### 테스트

- 전체 86개 테스트 통과
- `npm run typecheck` 에러 없음 (strict mode)
- 빌드 파이프라인 검증 완료

### 개발 경험 개선

- IDE 자동완성 및 타입 추론 향상
- 컴파일 타임 에러 감지
- 리팩토링 안전성 증대
- 코드 가독성 및 유지보수성 향상

### 통계

- 27개 커밋으로 마이그레이션 완료
- 60+ 파일 TypeScript 전환
- strict mode 활성화로 런타임 에러 80% 감소 예상

## v1.11.0 (2025-10-09)

### 아키텍처 개선

- **JSDoc 타입 커버리지 완성**: TypeScript 전환을 위한 전체 타입 주석 인프라 구축 완료
  - `types/api.d.ts`: 확장된 인터페이스 정의 (state manager, error handler, export range, message indexer, bookmark)
  - UI 모듈 JSDoc 추가: `src/ui/panel-interactions.js`, `src/ui/panel-visibility.js`, `src/ui/state-view.js`, `src/ui/panel-shortcuts.js`
  - Core 모듈 JSDoc 추가: `src/core/state.js`, `src/core/error-handler.js`, `src/core/export-range.js`, `src/core/message-indexer.js`, `src/core/turn-bookmarks.js`, `src/core/bookmark-listener.js`
  - `tsconfig.json`: checkJs 범위 확장 (기존 4개 → 14개 모듈 포함)
  - v1.9.0 Issue #7 완료 (ROADMAP Phase 1-2)

### 개발자 도구 개선

- **커밋 메시지 규칙 표준화**: AI 에이전트와 인간 개발자를 위한 Conventional Commits 도입
  - `CLAUDE.md`: AI 에이전트용 커밋 메시지 컨벤션 추가
  - `.gitmessage`: Git 커밋 템플릿 파일 생성
  - 타입별 커밋 가이드라인: feat, fix, docs, refactor, test, chore, perf, style
  - AI는 필수 준수, 인간은 권장 사항으로 유연하게 운영

### 테스트

- 전체 86개 테스트 통과
- `npm run typecheck` 통과 (14개 모듈)
- 타입 안전성 강화로 런타임 에러 예방 능력 향상

### 문서

- CLAUDE.md에 Commit Message Convention 섹션 추가
- AI 에이전트가 참고할 수 있는 명확한 가이드라인 제공

## v1.10.2 (2025-10-07)

### 아키텍처 개선

- **Composition 모듈 완성**: UI 및 부트스트랩 로직을 별도 모듈로 분리 완료
  - `src/composition/ui-composition.js`: 모달·패널 가시성·상태 뷰·프라이버시 설정 조립
  - `src/composition/bootstrap.js`: boot/teardown/DOM 감시 로직
  - `src/index.js` 765줄 수준 유지 (composition 모듈 5개로 분산)
  - v1.9.0 Issue #6 완료

- **TypeScript 전환 기반 마련**: JSDoc 타입 주석 및 타입 체크 인프라 구축
  - `types/api.d.ts`: 공용 JSDoc 인터페이스 정의
  - `types/globals.d.ts`: Tampermonkey GM_* API 타입 선언
  - `tsconfig.json`: checkJs 활성화, 핵심 4개 모듈 포함 (auto-loader, share, pipeline, modal)
  - `npm run typecheck`: pretest에 통합 (tsc --noEmit)
  - JSDoc typedef 추가: `src/features/auto-loader.js`, `src/features/share.js`, `src/privacy/pipeline.js`, `src/ui/modal.js`, `src/core/message-indexer.js`
  - v1.9.0 Issue #7 부분 완료 (추가 모듈 편입 예정)

### 개발자 도구 개선

- **고차 함수 패턴 도입**: 반복 코드 제거 및 재사용성 향상
  - `src/utils/factories.js`: `withPlayerNames` 고차 함수 추가
  - export 함수 wrapper 단순화
  - v1.9.0 Issue #10 완료

### 문서

- **ROADMAP.md 정리**: v1.8.0 및 v1.9.0 Issue 완료 상태 표시
  - v1.8.0 Issue #1~#5 완료 표시 (2025-10-07 릴리스)
  - v1.9.0 Issue #6, #8, #9, #10 완료 표시
  - v1.9.0 Issue #7 부분 완료 상태 명시
  - 체크리스트 업데이트

### 테스트

- 전체 86개 테스트 통과
- typecheck 통과 (4개 핵심 모듈)

## v1.10.1 (2025-10-07)

### 버그 수정 (부분)

- **Player 메시지 감지 개선 - NPC 오분류 방지**: NPC 체크를 React 비교 전으로 이동
  - **문제**: v1.10.0 이후에도 일부 NPC 메시지가 player로 잘못 분류됨
  - **원인**: Phase 2 (React 텍스트 비교)가 Phase 1.5 (NPC 체크)보다 먼저 실행
  - **해결**: detectRole 로직 순서 재배치 (justify-end → NPC → React 비교 → CSS 폴백)
  - **영향**: NPC 메시지 오분류 해결, 전체 86개 테스트 통과

### 알려진 제한사항

- **Player 메시지 감지 정확도: 73% (19/26)**
  - genit.ai가 일부 user 메시지를 `role: "assistant"`로 저장
  - `.justify-end` CSS 클래스 누락 케이스 존재
  - DOM/React 텍스트가 동일한 경우 구분 불가
  - **영향**: 7개 user 메시지가 `channel: "llm"`으로 분류됨 (ordinal 12, 20, 22, 30, 32, 40, 42)
  - **대응**: ROADMAP.md에 상세 조사 결과 및 향후 개선 방향 문서화
  - **사용자 영향**: 일반 export는 실용 가능, 통계 기반 기능 추가 시 주의 필요

### 문서

- ROADMAP.md "Player Message Detection - Known Limitations" 섹션 추가
  - 3시간 조사 결과 및 시도한 모든 방법 기록
  - Codex/Gemini 상담 내용 반영
  - 향후 개선 방향: 사용자 수동 UI 추가 (우선순위 MEDIUM)

## v1.10.0 (2025-10-07)

### 버그 수정 (부분)

- **Player 생각/행동 입력 분류 개선 시도**: React props 기반 role 감지 추가
  - **문제**: 유저가 생각/행동으로 입력한 메시지가 `channel: "llm"`, `role: "narration"`으로 잘못 분류됨
  - **원인**: genit.ai가 생각/행동 입력을 CSS 구조상 assistant처럼 렌더링 (`flex w-full`, `justify-end` 없음)
  - **시도**: React Fiber에서 `message.role` 추출하는 `getReactMessage()` 함수 추가
  - **결과**: 부분 해결 - 일부 user 메시지도 React에서 `role: "assistant"`로 저장되어 완전 해결 실패
  - **후속**: v1.10.1에서 DOM/React 텍스트 비교 추가 (19/26 감지, 73% 정확도)
  - `src/adapters/genit.js:207-248` (getReactMessage + detectRole 수정)

### 아키텍처 개선

- **React Fiber 탐색 기능 추가**: genit.ai의 React 내부 상태를 안전하게 읽어 role을 판정
  - `Object.getOwnPropertyNames()` 사용하여 non-enumerable React Fiber props 접근
  - 최대 10단계 부모 노드 탐색으로 `message` prop 찾기
  - CSS 폴백 유지로 React 구조 변경 시에도 동작 보장

### 테스트 개선

- Player 생각/행동 입력 감지 테스트 추가 (`tests/unit/adapter-genit.spec.js:166-220`)
  - React props 모킹 테스트
  - CSS 폴백 테스트
- 전체 86개 테스트 통과

### 문서

- ROADMAP.md에 Phase 2 개선 사항 문서화
  - 텍스트 휴리스틱 기반 백업 감지 로직 (향후 필요 시)
  - React 구조 변경 대비 계획

## v1.9.0 (2025-10-07)

### 아키텍처 개선

- **Composition 모듈 도입**: 대형 부트스트랩 블록을 전용 composition 모듈로 분리했습니다.
  - `src/composition/adapter-composition.js`: 어댑터 레지스트리 및 플레이어 이름 관리
  - `src/composition/privacy-composition.js`: 프라이버시 파이프라인 및 설정 초기화
  - `src/composition/share-composition.js`: 공유 워크플로우 조합
  - `src/index.js`가 이제 오케스트레이터 역할만 수행 (인라인 로직 최소화)
  - `src/config.js`: 중앙 집중식 타이밍/제한 상수 (auto-loader 프로파일, preview 제한 등)

### 파싱 및 Range 동작 강화

- **나레이션 휴리스틱 개선**: 단어 1개 설명문을 유지하면서 명확한 라벨은 필터링
  - 예: "정적", "당황" 같은 감정/상태 설명은 보존
  - `src/adapters/genit.js`, `genit-memory-helper.user.js` 반영

- **Auto-loader range 관리 수정**: 턴 수가 줄어들면 range를 자동으로 축소/초기화
  - 기존: 단조 증가만 가능
  - 개선: `exportRange.clear()` 호출하여 무효한 범위 제거
  - `src/features/auto-loader.js`, 테스트: `tests/unit/auto-loader.spec.js`

### 개발자 도구 개선

- **의존성 검증 헬퍼**: `requireDeps` 유틸리티로 share 워크플로우 의존성 그룹 검증
  - `src/features/share.js`, `src/utils/validation.js`
  - 누락된 의존성에 대한 명확한 에러 메시지 제공

- **JSDoc 추가**: composition 헬퍼에 JSDoc 주석 추가

### 테스트 개선

- NPC 중복 대사 회귀 테스트 추가
- INFO 블록 처리 테스트 강화
- 단어 1개 나레이션 보존 테스트 추가
- 모달 sanitization 테스트
- 프라이버시 리스트 필터링 테스트
- Auto-loader range 축소 시나리오 테스트

## v1.8.0 (2025-10-07)

### 버그 수정

- **중복 대사 데이터 손실 수정** (#1): INFO 블록과 일반 대사를 구분하여 처리하도록 개선했습니다.
  - **문제**: `collectStructuredMessage`에서 단일 `seen` Set이 모든 메시지 타입에 적용되어 정상적인 중복 대사가 제거됨
  - **해결**: INFO 블록에만 전용 중복 제거 로직 적용, 일반 대사는 중복 허용
  - **영향**: NPC 반복 대사나 플레이어 반복 선택지가 정확히 보존됨
  - `src/adapters/genit.js:424`, `genit-memory-helper.user.js:1742`

- **프라이버시 설정 XSS 차단** (#2): 커스텀 패턴 입력 검증을 강화했습니다.
  - **문제**: 사용자 정의 프라이버시 리스트에 HTML/JS 페이로드 삽입 가능
  - **해결**: `<`, `>`, `javascript:` 패턴을 포함한 항목 자동 제거
  - **영향**: 악의적인 입력이 설정 저장 단계에서 차단됨
  - `src/privacy/settings.js:4`, 테스트 추가: `tests/unit/privacy-settings.spec.js:66`

- **모달 콘텐츠 안전성 검증** (#3): 기존 sanitizer의 안전성을 테스트로 확인했습니다.
  - **문제**: 모달에 HTML 콘텐츠 삽입 시 XSS 우려
  - **해결**: 기존 `<template>` 기반 sanitizer가 이미 안전함을 확인
  - **영향**: `<script>`, `onerror`, `javascript:` 등 위험 요소가 모두 제거됨
  - 테스트 추가: `tests/unit/modal.spec.js:1`

- **북마크 리스너 중복 등록 방지** (#4): 페이지 전환 시 리스너 누적을 차단했습니다.
  - **문제**: SPA 라우팅 시 `bookmarkListener.start()` 중복 호출로 클릭당 북마크가 여러 개 생성됨
  - **해결**: `boot()` 함수 내부에서만 시작하고 `panelMounted` 가드 플래그 추가
  - **영향**: 페이지 전환 후에도 북마크가 정상 동작
  - `src/index.js:788`

- **MutationObserver 무한 재시작 수정** (#5): DOM 변화 시 불필요한 재부팅을 제거했습니다.
  - **문제**: SPA 내비게이션마다 MutationObserver가 `boot()` 재호출하여 성능 저하
  - **해결**: `panelMounted`/`bootInProgress` 플래그로 중복 실행 차단
  - **영향**: 메모리 누수 방지, 콘솔 로그 정리
  - `src/index.js:788`

### 테스트 개선

- INFO 블록 중복 제거 및 일반 대사 보존 케이스 추가 (`tests/unit/adapter-genit.spec.js:83`)
- 모달 sanitizer 안전성 검증 (script/onerror/srcdoc 제거) 추가 (`tests/unit/modal.spec.js`)
- 프라이버시 설정 XSS 차단 회귀 테스트 추가 (`tests/unit/privacy-settings.spec.js:66`)
- 북마크 리스너 초기화 수정 (`tests/unit/range-bookmark.spec.js:47`)

## v1.7.4 (2025-10-06)

### 모바일 UX 개선

- **"바깥 클릭 시 접기" 기본값 변경**: 모바일 환경에서의 안정성을 위해 모든 사용자에게 기본적으로 비활성화됩니다.

  - **배경**: v1.7.3 이후 모바일에서 패널 내부 스크롤 시 의도치 않게 패널이 닫히는 문제가 지속적으로 보고됨
    - 터치 이벤트와 outside click 감지 로직의 근본적인 충돌
    - 복잡한 터치 트래킹으로 인한 엣지 케이스 증가
    - 코드 복잡도 상승 및 유지보수 부담 가중

  - **해결**: 단순하고 안전한 접근 방식 채택
    - `collapseOnOutside` 기본값을 `false`로 변경 (모든 플랫폼)
    - 모바일 감지 및 자동 조정 로직 제거 (60줄 삭제)
    - 복잡한 터치 세션 트래킹 제거 (107줄 삭제)
    - 설정 화면에 "⚠️ 모바일에서는 비활성화 권장" 안내 추가

  - **영향**:
    - 모바일 사용자: 즉시 안정적인 패널 조작 가능
    - 데스크톱 사용자: 원하면 설정에서 수동으로 활성화 가능
    - 코드베이스: 230줄 감소로 유지보수성 대폭 향상

### 기술 개선

- **Over-engineering 제거**: 복잡한 모바일 터치 트래킹 로직을 제거하고 v1.7.3의 안정적인 패널 관리 시스템으로 복구했습니다.
  - `isProbablyMobile()`, `mobileCollapseOptIn`, 거리/시간 임계값 계산 등 제거
  - 코드 복잡도 감소 및 향후 버그 위험 최소화

### 참고

- 이전 시도(v1.7.3+)에서 추가된 복잡한 터치 처리 로직은 근본적인 UX 문제를 해결하지 못했고, 오히려 새로운 엣지 케이스를 만들어냄
- 단순한 기본값 변경만으로 모바일 문제를 효과적으로 해결

## v1.7.3 (2025-10-05)

### 버그 수정

- **모바일 패널 토글 중복 감지 수정**: 모바일 환경에서 패널이 열렸다가 즉시 닫히는 문제를 해결했습니다.

  - **문제**: Galaxy S24 등 모바일 브라우저에서 GMH 패널 버튼 터치 시 패널이 반복적으로 켜졌다 꺼지는 현상 발생
    - 원인: 모바일 터치 이벤트가 synthetic click + native click으로 중복 발생
    - 영향: 패널 사용이 거의 불가능한 수준의 UX 저하

  - **해결**: FAB 버튼 클릭에 350ms 타임스탬프 가드 추가
    - 동일 버튼의 350ms 이내 중복 토글 차단
    - `performance.now()` 기반 정밀 타이밍 체크
    - 다른 입력 경로(단축키 등)에는 영향 없음

  - **영향**:
    - 모바일 사용자 경험 대폭 개선
    - 데스크톱 환경에서도 부작용 없이 안정적으로 작동

### 기여

- Issue #7 리포트: @tpalsdhkdwk1

## v1.7.2 (2025-10-04)

### 사용자 경험 개선

- **차단 알림에 디버그 안내 추가**: 미성년자 성적 맥락 감지로 차단된 사용자가 차단 이유를 확인할 수 있도록 상세 안내를 추가했습니다.

  - **기존 문제**: 차단된 사용자는 왜 차단되었는지 알 수 없었음
    - 디버그 모드(`gmh_debug_blocking`)를 아는 사용자만 로그 확인 가능
    - 정당한 콘텐츠가 오차단된 경우 피드백 경로 불명확

  - **개선 사항**: 차단 알림에 단계별 디버그 활성화 방법 포함
    ```
    차단 이유를 확인하려면:
    1. F12 키를 눌러 개발자 도구 열기
    2. 콘솔(Console) 탭 선택
    3. 다음 명령어 입력 후 Enter:
       localStorage.setItem('gmh_debug_blocking', '1')
    4. 다시 내보내기/복사 시도
    5. 콘솔에서 상세 정보 확인
    ```
    - GitHub Issues 링크 추가로 오탐 신고 경로 제공

  - **기대 효과**:
    - 사용자가 차단 원인을 스스로 확인 가능
    - False Positive 피드백 수집 개선
    - 투명성 증대로 사용자 신뢰도 향상

### 영향

- **사용자 셀프서비스 강화**: 기술적 배경이 없는 사용자도 F12 안내를 따라 디버그 가능
- **품질 개선 피드백 루프**: 오탐 신고가 쉬워져 향후 알고리즘 개선 가속화

## v1.7.1 (2025-10-04)

### 긴급 수정 (v1.7.0 False Positive 해결)

- **근접도 기반 감지 추가 (Phase 2)**: v1.7.0에서 발생한 일반 대화 오차단 문제를 해결했습니다.

  - **문제**: v1.7.0이 교육/상담 맥락이 아닌 모든 콘텐츠를 차단
    - 예: "17세 캐릭터 설정... (500자 후) ...성격이 활발함" → 잘못 차단됨
    - 사용자 피드백: "도저히 그런 기억이 없는데 차단됨"

  - **해결**: 100자 슬라이딩 윈도우로 키워드 근접도 검사
    - 미성년 키워드와 성적 키워드가 **100자 이내**에 있을 때만 차단
    - 멀리 떨어진 경우 자동 통과 처리

  - **결과**:
    - ✅ "17세 캐릭터...(500자)...성격" → 통과 (근접도 0)
    - ✅ "미성년자 보호법...(500자)...성적 소수자" → 통과 (근접도 0)
    - ✅ "미성년자 성교육" → 통과 (정당한 맥락, Phase 1)
    - ❌ "미성년자와 성관계" → 차단 (근접도 95)

### 기술 개선

- **근접도 계산 로직**: `calculateProximityScore()` 함수 추가
  - PROXIMITY_WINDOW = 100자
  - 임계값 = 70점 (거리가 가까울수록 높은 점수)

- **테스트 확대**: 원거리 vs 근접 시나리오 테스트 추가
  - "멀리 떨어진 키워드" 통과 검증
  - "가까운 키워드" 차단 검증

### 영향

- **False Positive 추가 감소**: 일반 대화/롤플레이에서 오탐 대폭 감소
- **사용자 경험 개선**: 정상적인 대화 내보내기가 원활해짐
- **Phase 1 유지**: 교육/상담/권리 맥락은 여전히 즉시 통과

### 참고

- Phase 3 (점수 기반 종합 평가)는 사용자 피드백 수집 후 결정 예정
- 1-2주 모니터링 기간 후 추가 개선 여부 평가

## v1.7.0 (2025-10-04)

### 프라이버시 보호 개선 (Phase 1)

- **미성년자 성적 맥락 감지 알고리즘 대폭 개선**: 정당한 교육/상담 콘텐츠와 위험 콘텐츠를 정확히 구분하는 새로운 감지 시스템을 도입했습니다.

  - **6가지 정당한 맥락 패턴 추가**: 학업 성적, 성교육, 성적 지향, 보호 활동, 권리 개념을 정확히 인식
    - 학업: "고등학생의 성적 향상", "성적 관리" 등
    - 성교육: "미성년자 성교육 프로그램", "성발달 상담" 등
    - 권리: "성적 자기결정권", "성적 건강" 등

  - **양방향 보호 패턴 매칭**: 키워드 순서에 관계없이 정당한 맥락 인식
    - ✅ "교육 프로그램: 미성년자 보호" (기존 방식)
    - ✅ "미성년자 성폭력 예방 캠페인" (새로 지원)

  - **명백한 위험 요소 감지**: 우회 시도를 효과적으로 차단
    - 범죄 키워드: 강간, 성폭행, 몰카, 아청법
    - 포르노 미디어: "야한 사진", "음란 영상" 등
    - 예: "미성년자 성교육 자료 야한 사진" → 차단 ✅

  - **조기 필터링 로직**: "정당한 맥락 + 위험 요소 없음 = 통과" 원칙 적용
    - 순수 교육 콘텐츠는 즉시 통과 처리
    - 위험 요소가 포함된 경우에만 차단

### 기술 개선

- **전역 정규식 상태 버그 수정**: `.test()` 호출 시 `lastIndex` 문제로 두 번째 호출부터 오작동하던 버그 수정
  - TEST용 정규식(`/i`)과 MATCH용 정규식(`/gi`)을 분리하여 상태 관리 문제 해결

- **테스트 가능성 향상**: 프라이버시 파이프라인에 `logger`/`storage` 주입 방식 도입
  - 디버그 모드 지원: `localStorage.setItem('gmh_debug_blocking', '1')`
  - 차단 결정 로그 출력으로 투명성 증대

- **테스트 커버리지 확대**: 새로운 감지 로직에 대한 포괄적인 테스트 추가
  - 정규식 상태 버그 회귀 방지 테스트
  - 정당한 교육/권리 콘텐츠 통과 검증
  - 우회 시도 차단 검증

### 개발 프로세스

- **AI 협업 리뷰 프로세스 도입**: Claude, Codex, Grok의 4차례 교차 리뷰를 통해 설계 검증
  - 기술적 정확성, 우회 가능성, 일관성 등 다각도 검토
  - `reviews/2025-10-04/` 폴더에 의사결정 과정 문서화

### 영향

- **False Positive 대폭 감소**: 교육/상담 콘텐츠에서 오탐 약 80% 감소 예상
- **보안 강화**: 교육 키워드를 악용한 우회 시도 차단
- **사용자 경험 개선**: 정당한 용도의 대화 내보내기가 더 원활해짐

## v1.6.4 (2025-10-01)

### 주요 버그 수정

- **NPC 블록 내 narration 누락 문제 해결**: NPC 대사와 narration이 같은 블록에 있을 때 narration이 export에서 완전히 누락되던 심각한 버그를 수정했습니다.
  - 원인: `markInfoNodeTree()`가 INFO 카드 마킹 시 상위 `.markdown-content` 전체를 INFO로 간주해, 같은 컨테이너의 narration `<p>` 태그도 걸러냄
  - 해결: INFO 카드(`.bg-card`, `.info-card`)만 선별적으로 마킹하도록 수정 (src/adapters/genit.js:405)

- **Narration-INFO 순서 문제 해결**: Narration이 DOM 순서와 다르게 INFO 카드보다 뒤에 배치되던 문제를 수정했습니다.
  - 원인: `emitInfo()`가 부모 `.markdown-content`를 `node`로 지정해, `getOrderPath()` 정렬 시 부모-자식 우선순위로 INFO가 먼저 옴
  - 해결: INFO 카드 wrapper(`.bg-card`)를 가리키도록 수정해 narration `<p>`와 형제 관계로 만들어 DOM 순서 유지 (src/adapters/genit.js:431-436)

### 성능 최적화 (Phase 1.5)

- **증분 스냅샷 캐싱**: DOM에 로드된 메시지만 파싱하도록 최적화해 대규모 대화에서 성능 개선
  - WeakMap 기반 블록 캐시로 재파싱 방지
  - `force: true` 플래그로 export 시 캐시 강제 갱신

- **자동 로더 캐싱 개선**: 스크롤 중 중복 파싱 방지 및 통계 계산 최적화

- **프라이버시 검증 강화**: 미성년자 콘텐츠 필터 및 레다크션 파이프라인 안정성 개선

### 문서 개선

- `docs/role-classification-heuristics.md`에 버그 수정 이력 및 DOM 구조 상세 기록 추가
- 핵심 교훈: "너무 넓은 범위를 가리켰다" - DOM 어댑터는 가능한 한 구체적이고 좁은 셀렉터 사용 필요

## npm run bump:patch  # v1.6.3
 - Fix: Markdown code fence rendering (Codex)
 - Fix: Duplicate line deduplication (Codex)
 - Test: Add regression tests for export accuracy

## v1.6.2 (2025-09-30)

- **Structured JSON 최적화**: 중복 데이터를 제거해 내보내기 파일 크기를 26% 축소했습니다.
  - 일반 part와 message에서 `legacyLines` 필드 제거 (INFO part는 폴백용으로 유지)
  - `meta.turn_range`를 `meta.selection`으로 통합하고 20개 중복 필드 제거
  - `selected_ordinals` 배열(중복값 100+ 항목) 완전 삭제
  - 프라이버시 파이프라인에서 legacy 데이터를 non-enumerable 속성으로 처리
- **테스트 커버리지 강화**: privacy-redaction 테스트를 Tampermonkey 의존성 없이 직접 모듈 단위 테스트로 재작성하고, structured-export 테스트에 fallback 시나리오 3개 추가했습니다 (총 58개 테스트 통과).
- **개발자 경험 개선**: JSON 구조가 단순해져 LLM 파싱 효율성과 디버깅 편의성이 향상되었습니다.

## v1.6.0 (2025-09-30)

- **모듈화 완료**: 7580줄 단일 파일을 46개 모듈(8개 디렉토리)로 분할해 유지보수성과 테스트 격리성을 대폭 개선했습니다.
- **Rollup 빌드 시스템 도입**: ESM 모듈을 Tampermonkey 호환 IIFE 단일 파일로 번들링하는 이중 빌드 시스템(`USE_ROLLUP=1` 플래그)을 구축했습니다.
- **아키텍처 구조**:
  - `src/core/`: 상태 관리, 에러 핸들링, 북마크, 메시지 인덱싱 등 핵심 모듈
  - `src/adapters/`: Genit 플랫폼 DOM 어댑터
  - `src/privacy/`: 프라이버시 프로필 및 레다크션 파이프라인
  - `src/export/`: JSON/Markdown/TXT 내보내기 및 파서
  - `src/ui/`: 패널, 모달, 설정 UI 컴포넌트
  - `src/features/`: 자동 로딩, 스냅샷, 가이드 프롬프트 등 기능 모듈
  - `src/utils/`: 텍스트 처리, DOM 유틸리티, 검증 함수
- **Legacy UI 분리**: Modern/Legacy 패널을 팩토리 패턴으로 분리해 조건부 렌더링 로직을 단순화했습니다.
- **테스트 안정성 유지**: 모듈화 과정에서 80개 테스트가 계속 통과하도록 점진적 마이그레이션을 수행했습니다.
- **개발자 경험 개선**: 명확한 디렉토리 구조와 의존성 주입 패턴으로 신규 기능 추가 및 디버깅이 용이해졌습니다.

## v1.5.0 (2025-10-04)

- 구조 보존 파이프라인을 재정비해 INFO 카드와 내레이션 라벨이 중복 수집되지 않도록 했습니다. INFO 블록은 한 번만 추출되고, 라벨 전용 텍스트(한 단어 이름)는 Rich/Classic 모두에서 자동으로 걸러집니다.
- DOM 순서를 기반으로 파트가 정렬되도록 수집기를 개선하고, Markdown/JSON 내보내기에서 INFO가 카드 위치에 맞춰 자연스럽게 표시되도록 정렬 로직을 추가했습니다.
- 새 `Rich TXT (.txt)` 내보내기 포맷을 도입해 메시지 헤더와 발화/코드/INFO 파트를 간결한 텍스트 기호로 표현합니다. Rich 모드 실패 시 Classic TXT로 자동 폴백합니다.
- Export 패널 기본값을 Rich Markdown으로 전환하고, README/역할 휴리스틱 문서를 새로운 Rich Markdown/TXT/JSON 흐름에 맞게 업데이트했습니다.
- 구조 보존 TXT/Markdown/JSON 생성 경로에 대한 Vitest 단위 테스트를 보강했습니다.

## v1.4.2 (2025-09-28)

- bookmark 클릭이 동일 messageId의 다른 DOM 노드를 참조하던 버그를 해결해, `시작/끝 지정`이 항상 최신 메시지 번호(1, 2 …)를 사용하도록 보강했습니다. ExportRange가 잘못된 6‒15 구간으로 스냅되는 현상이 사라집니다.
- ExportRange를 메시지 축 전용으로 정식 선언하고, 오디널 재계산/재선택 시 인덱서 캐시를 우선 사용하도록 정리했습니다.
- role heuristics 문서를 muted 플레이어 말풍선 포함 여부에 맞춰 업데이트하고, AGENTS.md/README.md를 현재 저장소 구조(테스트 폴더·Prettier 포함)에 맞게 정리했습니다. (`prettier`를devDependency로 추가)
- 관련 Vitest 스위트(`message-indexer`, `range-bookmark`, `export-range`)를 수동 실행해 리그레션을 확인했습니다.

## v1.4.0 (2025-09-28)

- 턴 파서를 플레이어/NPC/내레이션 축 대신 `user`/`llm` 메시지 축으로 리팩터링해 각 DOM 메시지가 고유한 순번(`data-gmh-message-ordinal`)을 갖도록 정비했습니다. JSON/Markdown/프리뷰 내보내기가 동일한 메시지 축을 사용합니다.
- 메시지 범위 지정 UI가 새 축을 기준으로 북마크·`시작지정/끝지정` 버튼을 동기화하면서 실험 플래그를 제거했습니다. 북마크 드롭다운은 최근 메시지 북마크 5개를 메시지 번호와 함께 표기합니다.
- README 및 역할 휴리스틱 문서를 업데이트해 메시지 축 변경과 범위 지정 기능이 정식으로 안정화되었음을 명시했습니다.

## v1.3.7 (2025-09-27)

- Genit 어댑터의 `playerText`/`emitPlayerLines` 필터를 보강해 회색 말풍선(`bg-muted/50`, `text-muted-foreground`)으로 표시되는 플레이어 행동·내적 독백이 JSON/Markdown 내보내기에 포함되도록 조정했습니다.
- `docs/dom-genit-structure.md`에 역할 판정 휴리스틱(플레이어/어시스턴트/내레이션 스코어링, muted 텍스트 처리)을 문서화하고, 오프닝 NPC 블록이 플레이어 턴 총계에 포함되지 않는 알려진 이슈를 기록했습니다.
- 나머지 플레이어 턴 총계는 25가 정상임을 명확히 하고, 오프닝 메시지 범위 선택 회귀는 후속 작업으로 분리했습니다.

## v1.3.5 (2025-09-26)

- ExportRange가 플레이어 턴 구간을 다시 산정하면서 NPC 응답이 누락되거나 범위 끝이 잘리는 회귀를 해결했습니다. 북마크 선택 → 범위 적용 → 내보내기 흐름에 대한 단위/통합 테스트를 추가해 회귀를 빠르게 감지합니다.
- 모달/프리뷰 요약을 문자열 `innerHTML` 삽입 대신 DOM API 조립 + 기본 정규화를 거치도록 바꿔 잠재적인 스크립트 삽입과 의도치 않은 마크업 주입을 차단했습니다.
- MutationObserver, 북마크 클릭 리스너의 start/stop 수명주기를 명시적으로 관리하고 페이지에서 벗어날 때 정리하도록 해 중복 등록과 잔류 상태를 방지했습니다.

## v1.3.2 (2025-09-26)

- Tampermonkey 메타헤더와 런타임 패널 배지가 모두 `package.json`의 버전을 참조하도록 버전 소스를 단일화했습니다. `GM_info`가 없을 때는 `GMH.VERSION`이 자동으로 `0.0.0-dev`를 노출해 개발 환경에서도 동작 상태를 확인할 수 있습니다.
- `npm run bump:patch|minor|major` 스크립트를 추가해 버전 업 → 메타데이터 동기화 → dist 빌드 → 태그 푸시까지 원클릭으로 수행하도록 릴리스 흐름을 정리했습니다.
- 플레이어 북마크 히스토리를 최대 5개까지 유지하고 ExportRange가 사용자 지정 시작/끝 값을 재설정하지 않도록 범위 계산 플로우를 보완했습니다. 관련 단위 테스트를 추가해 북마크 기반 범위 지정이 회귀하지 않도록 검증합니다.
- Genit DOM 어댑터가 플레이어/어시스턴트/내레이션 블록을 다시 분류하며, INFO·요약 블록이 플레이어 대사에 섞이지 않도록 셀렉터 필터를 강화했습니다.

## v1.3.0 (2025-09-26)

- Export 패널의 플레이어 턴 범위를 “최근 턴 = 1” 기준으로 재정의하고 `시작지정`/`끝지정` 북마크 버튼, 미리보기 강조, manifest 메타데이터를 연동해 부분 내보내기 워크플로를 개선했습니다. **북마크 버튼은 아직 실험 단계**로, 대화 맨 위/아래 메시지나 추가 스크롤 이후에는 값이 어긋날 수 있으며, 불안정한 동작은 다음 릴리스에서 우선적으로 보완할 예정입니다.
- README와 패널 툴팁에 범위 북마크 기능이 실험적이라는 경고를 추가해 사용자 기대치를 명시했습니다.
- Playwright mock 스모크 테스트에 패널 접힘/포커스/백그라운드 상호작용 케이스를 추가해 키보드 트랩 회귀를 방지했습니다.

## v1.2.1 (2025-09-25)

- 패널 단축키 포커스 예약을 정리해 ESC 이후 입력창 포커스 복원이 재차 끊기지 않도록 안정화
- Playwright 스모크 테스트가 헤드리스 환경에서도 안정적으로 통과하도록 클릭 프로브 위치와 스케줄링을 조정

## v1.2.0 (2025-09-25)

- 패널 상단 그립/하단 손잡이를 추가해 드래그 도킹과 리사이즈를 지원하고 위치·크기를 브라우저별로 기억하도록 개선
- 자동 접힘 시간·집중 모드·드래그/리사이즈 허용 여부를 ⚙ 설정 모달에서 즉시 토글할 수 있도록 UI를 확장
- 패널 포커스 복원, Collapse 시 클릭 스루 보장, `prefers-reduced-motion` 대응 등 접근성·키보드 UX를 강화
- Playwright 스모크 테스트에 접힘/포커스 회귀 케이스를 추가하고 Panel Settings 단위 테스트를 보강

## v1.1.0 (2025-09-25)

- 새 UI 패널/모달 체계를 기본값으로 활성화하고 킬스위치가 없을 때 자동으로 플래그를 재설정하도록 개선
- Stable/Beta 이중 채널을 단일 사용자 스크립트로 통합하고 베타 산출물/빌드 파이프라인을 정리
- README와 테스트를 업데이트해 설치 안내, 킬스위치 가이드, 단일 배포 흐름을 반영

## v1.0.0 (2025-09-26)

- GitHub Actions CI를 도입해 빌드·Vitest 단위 테스트·Playwright 스모크 테스트를 자동 실행하고 DOM 변화 감시 예약 스케줄을 추가
- Playwright 로그인 상태(global setup)와 세션/데모 이중 스모크 테스트를 추가해 테스트 계정·공개 데모 환경 모두에서 패널 동작을 검증
- Genit 홈 자산 해시를 기록하는 fingerprint 스크립트를 추가해 외부 DOM 업데이트 신호를 수집
- 태그 푸시 시 dist/genit-memory-helper.user.js를 빌드 후 GitHub Release에 업로드하는 자동 릴리스 파이프라인 구성
- Node 기반 build 스크립트 및 테스트 픽스처를 추가해 Tampermonkey 사용자 스크립트 산출물을 표준 dist 디렉터리에 생성

## v0.93 (2025-09-25)

- GMH 네임스페이스를 도입해 Core/Privacy/UI/Export 모듈을 분리하고 창 전역에 읽기 전용으로 노출
- Genit 전용 DOM 어댑터를 `GMH.Adapters.genit`으로 분리해 플랫폼 확장 스캐폴드를 마련
- 프라이버시 확인창을 미리보기 모달로 확장하고 자동 레다크션 샘플을 제공
- 상태 패널에 톤/아이콘 기반 피드백을 추가하고 “원클릭 내보내기(전체 로딩→내보내기)” 버튼을 지원

## v0.92 (2025-09-24)

- SAFE/STANDARD/RESEARCH 프라이버시 프로필과 자동 레다크션 파이프라인 추가
- 내보내기/복사 전 개인정보 확인창, 미성년자 성적 맥락 차단, 감사용 manifest 동시 저장
- 커스텀 블랙/화이트리스트 입력 및 패널 상태 메시지에 레다크션 요약 표기
- README/PRIVACY 문서에 보안 가이드라인 업데이트

## v0.91 (2025-09-23)

- 데이터 속성 우선 탐지 및 롤/텍스트 폴백으로 DOM 탐색 안정화 강화
- 자동 스크롤 프로파일(기본/안정/빠름)과 패널 재시도·스냅샷 버튼 추가
- 상태 메시지 전역화 및 DOM 스냅샷 다운로드 기능 도입

## v0.9 (2025-09-22)

- DOM 어댑터 레이어 추가로 셀렉터 의존 분리 및 텍스트 중심 파이프라인 강화
- 스크롤 컨테이너 탐지/패널 장착에 기능 기반 폴백과 옵저버 디바운스 적용
- README 업데이트: v0.9 변경 사항과 자동 스크롤 안정화 안내

## v0.8 (2025-09-21)

- 자동 스크롤 패널 추가: 끝까지 로딩 및 플레이어 턴 목표 확보 지원
- 플레이어 턴 기반 메타데이터 정리(턴 수/sceneId) 및 UI 문구 통일
- README 사용 지침과 사용자 패널 상태 메시지 업데이트

## v0.7 (2025-09-20)

- 대화 파서를 턴 기반 AST로 리팩터링하여 화자/내레이션 정규화 개선
- JSON/TXT/Markdown 3종 내보내기 및 최근 15턴/전체 MD 복사 액션 추가
- 요약/재요약 프롬프트 문구를 "로그 파일" 기준으로 정리

## v0.6 (2025-09-19)

- 요약 가이드 버튼 추가
- 재요약 가이드 버튼 추가
- 클립보드 복사 기능 개선

## v0.5 (2025-09-18)

- 역할 태깅(player|npc|narration) 안정화
- JSON 내보내기 기능 추가
- 메모리 블록 빌드 개선

## v0.4 (2025-09-18)

- INFO/씬 멀티 파싱 지원
- 대화 turns 배열 추가
- UI 패널 개선

## v0.3 (2025-09-18)

- 배우 카드, 기록코드 파싱 기능 추가

## v0.2 (2025-09-18)

- 기본 JSON 파싱 기능

## v0.1 (2025-09-18)

- 초기 버전: 기본 UI + 대화 로그 추출
