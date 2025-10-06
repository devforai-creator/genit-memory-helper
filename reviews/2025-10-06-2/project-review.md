# Genit Memory Helper 프로젝트 리뷰
**날짜**: 2025-10-06
**버전**: 1.7.4
**리뷰어**: Claude Code

---

## 📊 프로젝트 현황

### 코드베이스 규모
- **총 소스 파일**: 44개 (src/*.js)
- **총 코드 라인**: ~8,588 줄
- **모듈 구조**: 8개 주요 디렉토리
- **테스트**: 17개 spec 파일 (unit + smoke)
- **의존성**: 47개 import 구문, 29개 export function

### 주요 모듈별 크기
```
834줄  src/adapters/genit.js           # 가장 큰 파일
767줄  src/ui/panel-visibility.js
529줄  src/features/auto-loader.js
479줄  src/features/share.js
471줄  src/core/export-range.js
407줄  src/ui/range-controls.js
406줄  src/ui/privacy-gate.js
378줄  src/features/snapshot.js
```

---

## 🔍 1. Overengineering 평가

### ✅ **결론: 적절한 수준의 엔지니어링**

#### 정당한 복잡성
1. **의존성 주입 패턴**: 44개 파일 대부분이 factory 함수 사용
   - **이유**: Tampermonkey 환경에서 `window`, `localStorage`, `GM_*` API를 주입해야 테스트 가능
   - **예시**: `src/index.js:235-240` - PanelSettings 생성 시 storage, logger 주입
   - **평가**: ✅ **필수적** - 테스트 없이는 유지보수 불가능

2. **모듈 분리 (8개 디렉토리)**
   ```
   src/
   ├── adapters/   # 플랫폼별 DOM 선택자
   ├── core/       # 상태 관리, 에러 핸들링
   ├── export/     # 내보내기 포맷
   ├── features/   # 비즈니스 로직
   ├── privacy/    # 개인정보 레다크션
   ├── ui/         # 패널 UI
   └── utils/      # 유틸리티
   ```
   - **이유**: 단일 파일 8,588줄은 불가능
   - **평가**: ✅ **필수적** - Rollup으로 번들링하므로 런타임 오버헤드 없음

3. **어댑터 레지스트리 패턴** (`src/adapters/registry.js`)
   - **현재**: genit.ai 어댑터만 존재
   - **미래**: Claude.ai, ChatGPT 등 확장 가능성
   - **평가**: ⚠️ **YAGNI 경계선** - 현재는 불필요하지만 확장 계획이 있다면 OK

#### 과도한 추상화 (개선 여지)

1. **복잡한 함수 시그니처**
   ```javascript
   // src/features/share.js:1-30
   export function createShareWorkflow({
     captureStructuredSnapshot,      // 1
     normalizeTranscript,             // 2
     buildSession,                    // 3
     exportRange,                     // 4
     projectStructuredMessages,       // 5
     cloneSession,                    // 6
     applyPrivacyPipeline,            // 7
     privacyConfig,                   // 8
     privacyProfiles,                 // 9
     formatRedactionCounts,           // 10
     setPanelStatus,                  // 11
     toMarkdownExport,                // 12
     toJSONExport,                    // 13
     toTXTExport,                     // 14
     // ... 총 27개 파라미터
   }) { /* ... */ }
   ```
   - **문제**: 파라미터 27개 - 호출 시 실수 가능성 높음
   - **권장**: 관련 파라미터를 객체로 그룹화
     ```javascript
     createShareWorkflow({
       parsers: { captureStructuredSnapshot, normalizeTranscript, buildSession },
       exporters: { toMarkdownExport, toJSONExport, toTXTExport },
       privacy: { applyPrivacyPipeline, config, profiles },
       // ...
     })
     ```

2. **Wrapper 함수 과다** (`src/index.js:210-233`)
   ```javascript
   const toJSONExportLegacy = (session, normalizedRaw, options = {}) =>
     toJSONExport(session, normalizedRaw, {
       playerNames: getPlayerNames(),
       ...options,
     });
   ```
   - **문제**: `toJSONExport`, `toStructuredMarkdown` 등 6개 함수가 모두 이 패턴
   - **권장**: 고차 함수로 통합
     ```javascript
     const withPlayerNames = (exportFn) => (session, raw, options = {}) =>
       exportFn(session, raw, { playerNames: getPlayerNames(), ...options });
     ```

---

## ⚠️ 2. 잠재적 충돌 & 버그 포인트

### 🔴 **High Priority**

#### 2.1 MutationObserver 경쟁 상태 (`src/index.js:825-834`)
```javascript
const mo = new MutationObserver(() => {
  if (moScheduled) return;
  moScheduled = true;
  requestAnimationFrame(() => {
    moScheduled = false;
    if (!document.querySelector('#genit-memory-helper-panel')) boot();
  });
});
mo.observe(document.documentElement, { subtree: true, childList: true });
```

**문제점**:
1. **무한 재부팅**: 패널이 사라질 때마다 `boot()` 재실행
   - genit.ai가 SPA 라우팅으로 DOM을 교체하면 패널이 삭제됨 → `boot()` → 패널 재생성 → 삭제... 반복
2. **중복 리스너**: `boot()` 호출 시마다 `messageIndexer.start()`, `bookmarkListener.start()` 재실행
   - `src/core/message-indexer.js`와 `src/core/bookmark-listener.js`에서 `stop()` 호출 여부 불명확

**재현 시나리오**:
```
1. 사용자가 genit.ai 채팅 페이지 A 진입 → boot() 실행
2. 사용자가 페이지 B로 라우팅 → SPA가 DOM 교체 → 패널 삭제
3. MutationObserver가 감지 → boot() 재실행
4. 이전 리스너들이 정리되지 않으면 메모리 누수
```

**권장 해결책**:
```javascript
let panelMounted = false;
const mo = new MutationObserver(() => {
  if (moScheduled || panelMounted) return;  // ← panelMounted 체크 추가
  // ...
});

function boot() {
  if (panelMounted) return;  // ← 중복 실행 방지
  try {
    mountPanel();
    GMH.Core.MessageIndexer.start();
    bookmarkListener.start();
    panelMounted = true;  // ← 플래그 설정
  } catch (e) { /* ... */ }
}

// teardown 시 플래그 초기화
window.addEventListener('beforeunload', () => {
  panelMounted = false;
  // ...
});
```

#### 2.2 북마크 동기화 충돌 (`src/core/bookmark-listener.js`)
```javascript
// src/index.js:276-285
const bookmarkListener = createBookmarkListener({
  document,
  ElementClass: typeof Element !== 'undefined' ? Element : undefined,
  messageIndexer,
  turnBookmarks,
  console: ENV.console,
});

bookmarkListener.start();  // ← 라인 284
// ...
boot() {
  bookmarkListener.start();  // ← 라인 792 (중복 호출)
}
```

**문제점**: `bookmarkListener.start()`가 두 번 호출됨
- 첫 번째: 라인 284 (즉시 실행)
- 두 번째: 라인 792 (`boot()` 내부)

**예상 동작**:
- `createBookmarkListener`에서 중복 실행 방지 로직이 있는지 확인 필요
- 없다면 이벤트 리스너가 중복 등록되어 북마크 클릭 시 핸들러 2회 실행

**확인 필요**:
```bash
grep -n "let.*started" src/core/bookmark-listener.js
# 또는
grep -n "this.running" src/core/bookmark-listener.js
```

#### 2.3 Privacy Pipeline 블로킹 로직 (`src/privacy/pipeline.js:181`)
```javascript
const blocked = typeof hasMinorSexualContext === 'function'
  ? hasMinorSexualContext(rawText)
  : false;
```

**문제점**: `hasMinorSexualContext`의 구현이 누락됨
- `src/privacy/index.js`에서 export되지만 실제 구현 파일 미확인
- 키워드 기반 검사라면 **오탐**(false positive) 가능성:
  - 정당한 교육/상담 내용 차단
  - 이미 사용자 alert에서 언급됨 (`src/features/share.js:102`)

**확인 필요**:
```bash
grep -rn "export.*hasMinorSexualContext" src/privacy/
```

### 🟡 **Medium Priority**

#### 2.4 Export Range 범위 계산 (`src/core/export-range.js:471줄`)
- **복잡성**: 471줄 중 북마크, 인덱스, ordinal 계산 로직이 복잡
- **리스크**: 범위 선택 시 off-by-one 에러 가능성
- **테스트**: `tests/unit/export-range.spec.js` 존재 → ✅ 검증됨

#### 2.5 State Transition 검증 (`src/core/state.js:13-21`)
```javascript
export const STATE_TRANSITIONS = {
  idle: ['idle', 'scanning', 'redacting', 'error'],
  scanning: ['scanning', 'redacting', 'preview', 'done', 'error', 'idle'],
  // ...
};
```

**문제점**: `idle → idle` 허용 (자기 자신으로 전환)
- **의도**: 상태 초기화?
- **리스크**: 무한 루프 시 감지 불가능
- **권장**: 자기 전환 시 경고 로그 추가

---

## 🐛 3. 발견된 버그

### 3.1 어댑터 선택 로직 (`src/index.js:707-718`)
```javascript
GMH.Core.pickAdapter = function pickAdapter(loc = location, doc = document) {
  const candidates = Array.isArray(GMH.Core.adapters) ? GMH.Core.adapters : [];
  for (const adapter of candidates) {
    try {
      if (adapter?.match?.(loc, doc)) return adapter;
    } catch (err) { /* ... */ }
  }
  return GMH.Adapters.genit;  // ← 폴백
};

let ACTIVE_ADAPTER = null;
function getActiveAdapter() {
  if (!ACTIVE_ADAPTER) {
    ACTIVE_ADAPTER = GMH.Core.pickAdapter(location, document);
  }
  return ACTIVE_ADAPTER;
}
```

**문제점**: `ACTIVE_ADAPTER`가 한 번 설정되면 변경 불가능
- **시나리오**: 사용자가 genit.ai → 다른 사이트 이동 (SPA)
- **결과**: 여전히 genit 어댑터 사용 (잘못된 선택자 적용)

**권장**:
```javascript
function getActiveAdapter() {
  // 매번 재선택하거나, URL 변경 감지 시 ACTIVE_ADAPTER = null
  const currentAdapter = GMH.Core.pickAdapter(location, document);
  if (ACTIVE_ADAPTER !== currentAdapter) {
    ACTIVE_ADAPTER = currentAdapter;
    // 기존 리스너 정리 후 재시작
    messageIndexer.stop();
    messageIndexer.start();
  }
  return ACTIVE_ADAPTER;
}
```

### 3.2 WeakSet 사용 시 GC 타이밍 (`src/adapters/genit.js:24`)
```javascript
let infoNodeRegistry = new WeakSet();
```

**문제점**: `infoNodeRegistry`에 추가한 노드가 DOM에서 제거되면 자동 GC
- **시나리오**: genit.ai가 메시지를 재렌더링하면 동일 내용의 새 노드 생성
- **결과**: 이전에 "INFO 코드로 인식"했던 노드가 WeakSet에서 사라져 중복 처리 가능

**테스트 필요**: 메시지 재렌더링 시 중복 파싱 여부 확인

---

## 🎯 4. TypeScript 마이그레이션 평가

### ✅ **지금이 최적의 시점**

#### 현재 상황
1. **TypeScript 이미 설치됨**: `package.json:28` - `"typescript": "^5.5.4"`
2. **일부 코드는 이미 TS**: Playwright 테스트 (`.spec.ts`)
3. **JSDoc 타입 힌트 부재**: 소스 코드에서 JSDoc 거의 사용하지 않음

#### 마이그레이션 시점 판단 기준

| 조건 | 현재 상태 | 평가 |
|------|-----------|------|
| 코드베이스 크기 | 8,588줄 | ⚠️ 이미 큼 - 더 커지기 전 진행 권장 |
| 함수 시그니처 복잡도 | 27개 파라미터 함수 존재 | 🔴 **즉시 필요** |
| 런타임 에러 발생 빈도 | 추정: 중간 (DI 패턴으로 `undefined` 에러 가능) | 🟡 TS로 사전 방지 가능 |
| 테스트 커버리지 | 17개 spec 파일 | ✅ 마이그레이션 안전성 확보 |
| 팀 크기 | 1인 개발자 | 🟡 혼자서도 점진적 마이그레이션 가능 |

#### 권장 마이그레이션 전략

**Phase 1: 타입 정의 (1-2주)**
```typescript
// src/types/index.ts
export interface GMHConfig {
  console: Pick<Console, 'log' | 'warn' | 'error'>;
  window: Window;
  localStorage: Storage;
}

export interface PrivacyProfile {
  label: string;
  enabled: Record<string, boolean>;
  customLists?: Record<string, string[]>;
}

export interface ExportSession {
  meta: Record<string, unknown>;
  turns: Turn[];
  warnings: string[];
  source?: string;
}
```

**Phase 2: 유틸리티부터 변환 (2-3주)**
```
src/utils/text.js      → src/utils/text.ts
src/utils/dom.js       → src/utils/dom.ts
src/utils/validation.js → src/utils/validation.ts
```
- **이유**: 의존성이 적고 순수 함수 위주

**Phase 3: Core 모듈 (3-4주)**
```
src/core/state.js
src/core/error-handler.js
src/core/export-range.js
```

**Phase 4: 나머지 (4-6주)**
- Adapters, Features, UI

**총 예상 기간**: 2-3개월 (주말 작업 기준)

#### 즉시 얻을 수 있는 이점

1. **파라미터 실수 방지**
   ```typescript
   // AS-IS (JavaScript)
   createShareWorkflow({
     captureStructuredSnapshot,
     normalizeTranscript,
     buildSession,
     // ... 나머지 24개 파라미터를 깜빡함
   }); // ← 런타임 에러: "exportRange is not defined"

   // TO-BE (TypeScript)
   createShareWorkflow({
     captureStructuredSnapshot,
     normalizeTranscript,
     buildSession,
   }); // ← 컴파일 에러: "exportRange 프로퍼티가 누락되었습니다"
   ```

2. **어댑터 선택자 타입 안전성**
   ```typescript
   interface GenitSelectors {
     chatContainers: string[];
     messageRoot: string[];
     playerScopes: string[];
     // ...
   }

   // src/index.js:114에서 오타 방지
   registerAdapterConfig('genit', {
     selectors: {
       chatContainers: [...],
       messageRoots: [...],  // ← 오타! (Root → Roots)
     }
   }); // TS 에러: "messageRoots는 GenitSelectors 타입에 없습니다"
   ```

3. **null/undefined 체크 강제**
   ```typescript
   function getActiveAdapter(): GenitAdapter {
     if (!ACTIVE_ADAPTER) {
       ACTIVE_ADAPTER = GMH.Core.pickAdapter(location, document);
     }
     return ACTIVE_ADAPTER!; // ← non-null assertion 명시적으로 표기
   }
   ```

#### 마이그레이션 리스크

🟢 **Low Risk**:
- 모든 빌드 도구 이미 설치됨 (Rollup, Vite, Vitest)
- `"type": "module"` 이미 사용 중 (`package.json:6`)
- 테스트 17개로 회귀 테스트 가능

⚠️ **주의 사항**:
- Tampermonkey는 TS 컴파일 결과물(`.js`)만 인식
- 빌드 파이프라인 복잡성 증가 (`tsc` 추가)
- `USE_ROLLUP=1` 플래그와 TS 컴파일 순서 조정 필요

---

## 📋 5. 권장 액션 아이템

### 🔴 **즉시 수정 필요**
1. **MutationObserver 중복 부팅 방지** (`src/index.js:825-834`)
   - 예상 작업 시간: 30분
   - 파일: `src/index.js`

2. **북마크 리스너 중복 start() 제거** (`src/index.js:284, 792`)
   - 예상 작업 시간: 15분
   - 확인 필요: `src/core/bookmark-listener.js`에 중복 방지 로직 유무

### 🟡 **단기 개선 (1-2주)**
3. **복잡한 함수 파라미터 리팩토링**
   - `createShareWorkflow` (27개 파라미터)
   - `createPrivacyPipeline`
   - 예상 작업 시간: 4-6시간

4. **Wrapper 함수 통합**
   - `toJSONExportLegacy` 등 6개 함수를 고차 함수로 교체
   - 예상 작업 시간: 2-3시간

### 🟢 **중기 개선 (1-3개월)**
5. **TypeScript 마이그레이션**
   - Phase 1 (타입 정의): 1-2주
   - Phase 2 (Utils): 2-3주
   - Phase 3 (Core): 3-4주
   - Phase 4 (나머지): 4-6주

6. **어댑터 레지스트리 검토**
   - 현재 genit만 지원 → 다른 플랫폼 확장 계획 없으면 제거 고려
   - 예상 작업 시간: 3-4시간 (제거 시) / 유지 시 0시간

---

## 🎯 6. 최종 평가

### Overengineering 점수: **6/10**
- **4점**: 필수적인 복잡성 (DI, 모듈화, 테스트 가능성)
- **2점**: 과도한 추상화 (27개 파라미터, wrapper 함수 과다)
- **평가**: 적절한 수준이지만 일부 리팩토링 필요

### 충돌/버그 리스크: **7/10** (높음)
- **High**: MutationObserver 무한 재부팅, 북마크 중복 리스너
- **Medium**: 어댑터 선택 캐싱, WeakSet GC 타이밍
- **Low**: Export Range off-by-one (테스트로 검증됨)

### TypeScript 마이그레이션 우선순위: **9/10** (매우 높음)
- **이유**:
  1. 코드베이스가 8,588줄로 이미 큼 (더 커지기 전 진행 권장)
  2. 복잡한 함수 시그니처 (27개 파라미터)로 인한 런타임 에러 위험
  3. 인프라 이미 준비됨 (TS 5.5.4 설치, 테스트 존재)
  4. 점진적 마이그레이션 가능 (`.js`와 `.ts` 혼용 가능)

### 종합 의견
**이 프로젝트는 over-engineered가 아니라, 올바른 방향으로 잘 설계되었으나 TypeScript로의 전환이 시급한 상태입니다.**

주요 근거:
- ✅ 모듈 분리가 명확하고 SRP(Single Responsibility Principle) 준수
- ✅ 테스트 커버리지 존재 (17개 spec)
- ✅ 의존성 주입으로 테스트 가능성 확보
- ⚠️ 복잡한 함수 시그니처는 TS 없이 관리 어려움
- ⚠️ 런타임 타입 에러 위험 (DI 패턴으로 `undefined` 가능성)
- 🔴 MutationObserver 버그는 즉시 수정 필요

**권장 다음 단계**:
1. 이번 주: MutationObserver + 북마크 리스너 버그 수정
2. 다음 달: TypeScript 마이그레이션 Phase 1-2 시작 (타입 정의 + Utils)
3. 2-3개월 후: 전체 코드베이스 TS 전환 완료

---

## 📚 참고 자료

### 관련 파일
- `src/index.js:825-834` - MutationObserver 버그
- `src/features/share.js:1-30` - 복잡한 파라미터
- `src/core/state.js:13-21` - State transition 정의
- `package.json:28` - TypeScript 의존성

### 테스트 실행
```bash
npm test                  # 단위 테스트
npm run test:smoke        # Smoke 테스트 (credentials 필요)
USE_ROLLUP=1 npm run build  # Rollup 번들 테스트
```

### 디버깅 플래그
```javascript
localStorage.setItem('gmh_debug_blocking', '1');  // Privacy blocking 로그
localStorage.setItem('gmh_debug_range', '1');     // Export range 디버깅
localStorage.setItem('gmh_kill', '1');            // 신규 UI 비활성화
```
