# 🗺️ Genit Memory Helper 최종 개선 로드맵
**작성일**: 2025-10-06
**기반 문서**: 5개 독립 리뷰 통합 분석
**로드맵 형식**: 마일스톤 기반 패치 릴리스

---

## 📊 리뷰 통합 분석 요약

### 5개 리뷰 핵심 통찰

| 리뷰 문서 | 핵심 발견 | 강조점 |
|----------|---------|--------|
| **codex-review.md** | 중복 대사 누락, 내레이션 필터 오류, Range 갱신 편차 | 데이터 품질 |
| **comprehensive-project-review.md** | Modal XSS, localStorage 검증, index.js 비대화 | 보안 + 아키텍처 |
| **project-review.md** | MutationObserver 재부팅, 북마크 중복, 27개 파라미터 | 런타임 안정성 |
| **meta-review.md** | 3개 리뷰 교차검증, 통합 우선순위 | 실행 계획 |
| **codex-meta-review.md** | export 품질 강조, 보안 진단 재검증 필요 | 데이터 무결성 |

### 공통 합의 사항

✅ **Overengineering 아님**: 기능 복잡도 대비 적절, 일부 개선 필요
✅ **TypeScript 전환 필수**: 지금이 최적 시점
✅ **보안 이슈 존재**: 치명적이지 않지만 즉시 수정 권장
✅ **테스트 강화 필요**: 현재 ~30% → 목표 70%

### 발견된 전체 이슈 (중복 제거)

**🔴 HIGH (14개)**:
1. 중복 대사 누락 (Codex)
2. Modal XSS (Comprehensive)
3. localStorage 검증 누락 (Comprehensive)
4. MutationObserver 무한 재부팅 (Claude)
5. 북마크 리스너 중복 start() (Claude)
6. 내레이션 필터 오류 (Codex)
7. Export Range 갱신 편차 (Codex)
8. 자동 로더 반복 파싱 (Comprehensive + Codex)
9. 이벤트 리스너 정리 부재 (Comprehensive)
10. index.js 비대화 912줄 (Comprehensive + Claude)
11. Modern/Legacy UI 중복 (Comprehensive)
12. 복잡한 함수 파라미터 27개 (Claude)
13. 에러 처리 불일치 (Comprehensive)
14. 테스트 커버리지 부족 (All)

**🟡 MEDIUM (8개)**:
15. Wrapper 함수 과다 (Claude)
16. 매직 넘버 사용 (Comprehensive + Claude)
17. 어댑터 선택 캐싱 (Claude)
18. WeakSet GC 타이밍 (Claude)
19. 상태 전환 복잡도 (Comprehensive)
20. 클립보드 실패 처리 (Comprehensive)
21. 어댑터 레지스트리 필요성 재검토 (Claude)
22. JSDoc 0% (All)

---

## 🎯 마일스톤 기반 패치 계획

### 전체 타임라인 개요

```
현재 (v1.7.4)
    ↓
v1.8.0 [Hotfix Patch]          ← 1주 (긴급 버그/보안)
    ↓
v1.9.0 [Refactor Patch]        ← 3-4주 (아키텍처 개선)
    ↓
v2.0.0 [TypeScript Major]      ← 2-3개월 (TS 전환)
    ↓
v2.1.0 [Polish Patch]          ← 1개월 (품질 향상)
    ↓
v2.2.0 [Performance Patch]     ← 2-3주 (성능 최적화)
```

**총 예상 기간**: 4-5개월
**핵심 원칙**: 각 패치마다 테스트 통과 + 하위 호환성 유지

---

## 🚨 v1.8.0 - Hotfix Patch (긴급 수정)

**목표**: 데이터 손실 방지 + 보안 취약점 제거
**기간**: 1주 (5-8시간)
**릴리스 조건**: 모든 기존 테스트 통과 + 신규 회귀 테스트 3개 추가

### 포함 이슈

#### #1 중복 대사 누락 수정 (Codex 최우선)
**파일**: `src/adapters/genit.js:725-730`

**현재 문제**:
```javascript
// collectStructuredMessage에서 Set 기반 중복 제거
const textSet = new Set();
blocks.forEach(block => {
  const text = block.textContent.trim();
  if (text) textSet.add(text);  // ← 동일 대사 연속 발화 시 손실
});
```

**수정안**:
```javascript
// INFO 영역만 중복 제거, 일반 대사는 보존
const isInfoBlock = (block) => {
  return block.querySelector('code.language-INFO') !== null;
};

const textList = [];
const infoTextSet = new Set();

blocks.forEach((block, index) => {
  const text = block.textContent.trim();
  if (!text) return;

  if (isInfoBlock(block)) {
    // INFO는 중복 제거
    if (!infoTextSet.has(text)) {
      infoTextSet.add(text);
      textList.push(text);
    }
  } else {
    // 일반 대사는 모두 보존
    textList.push(text);
  }
});
```

**검증**:
- 테스트 케이스: "안녕" → "안녕" (연속 발화) → 2개 모두 export 확인
- 회귀 테스트: `tests/unit/adapter-genit.spec.js`에 추가

**예상 시간**: 1-2시간

---

#### #2 Modal XSS 방어 (Comprehensive 긴급)
**파일**: `src/ui/modal.js:20-42`

**현재 문제**:
```javascript
const sanitizeMarkupFragment = (markup) => {
  const template = doc.createElement('template');
  template.innerHTML = String(markup ?? '');  // ⚠️ 인라인 스크립트 실행됨
  // 이후 제거해도 이미 실행됨
};
```

**수정안**:
```javascript
const sanitizeMarkupFragment = (markup) => {
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(String(markup ?? ''), 'text/html');

  // 위험 태그 제거
  parsedDoc.querySelectorAll('script, style, iframe, object, embed, link, meta, form')
    .forEach(node => node.remove());

  // 위험 속성 제거
  parsedDoc.querySelectorAll('*').forEach(element => {
    Array.from(element.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      // on* 이벤트 핸들러, javascript: URL 제거
      if (name.startsWith('on') ||
          /(javascript:|data:text\/html)/i.test(attr.value)) {
        element.removeAttribute(attr.name);
      }
    });
  });

  return parsedDoc.body.firstChild || doc.createTextNode('');
};
```

**검증**:
- 테스트 케이스: `<img src=x onerror=alert(1)>` → 속성 제거 확인
- 단위 테스트: `tests/unit/modal.spec.js` 신규 작성

**예상 시간**: 1시간

---

#### #3 MutationObserver 무한 재부팅 방지 (Claude)
**파일**: `src/index.js:825-834`

**현재 문제**:
```javascript
const mo = new MutationObserver(() => {
  if (moScheduled) return;
  moScheduled = true;
  requestAnimationFrame(() => {
    moScheduled = false;
    if (!document.querySelector('#genit-memory-helper-panel')) boot();
    // ↑ genit.ai SPA 라우팅 시 패널 삭제 → boot() 재실행 → 리스너 중복
  });
});
```

**수정안**:
```javascript
let panelMounted = false;
let bootInProgress = false;

const mo = new MutationObserver(() => {
  if (moScheduled || panelMounted || bootInProgress) return;
  moScheduled = true;
  requestAnimationFrame(() => {
    moScheduled = false;
    if (!document.querySelector('#genit-memory-helper-panel')) boot();
  });
});

function boot() {
  if (panelMounted || bootInProgress) return;
  bootInProgress = true;

  try {
    mountPanel();
    GMH.Core.MessageIndexer.start();
    bookmarkListener.start();
    panelMounted = true;
  } catch (e) {
    const level = errorHandler.LEVELS?.ERROR || 'error';
    errorHandler.handle(e, 'ui/panel', level);
  } finally {
    bootInProgress = false;
  }
}

// teardown 시 플래그 초기화
const teardown = () => {
  panelMounted = false;
  bootInProgress = false;
  // ... 기존 teardown 로직
};
```

**검증**:
- 수동 테스트: genit.ai에서 페이지 이동 5회 → `console.log` 카운터 확인
- 회귀 테스트: 기존 smoke test 통과

**예상 시간**: 30분

---

#### #4 localStorage 검증 추가 (Comprehensive)
**파일**: `src/privacy/settings.js:55-67`

**현재 문제**:
```javascript
const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
if (rawBlacklist) {
  try {
    const parsed = JSON.parse(rawBlacklist);  // ⚠️ 검증 없음
    blacklist = Array.isArray(parsed) ? parsed : [];
```

**수정안**:
```javascript
const validateBlacklist = (data) => {
  if (!Array.isArray(data)) return false;
  if (data.length > 1000) return false;  // DOS 방지
  return data.every(item => {
    if (typeof item !== 'string') return false;
    if (item.length > 200) return false;  // 과도한 길이 방지
    if (/<|>|javascript:/i.test(item)) return false;  // 명백한 공격 패턴
    return true;
  });
};

const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
if (rawBlacklist) {
  try {
    const parsed = JSON.parse(rawBlacklist);
    if (validateBlacklist(parsed)) {
      blacklist = parsed;
    } else {
      console.warn('[GMH] Invalid blacklist data, using defaults');
      blacklist = [];
    }
```

**검증**:
- 테스트 케이스:
  - 정상: `["test@example.com"]` → 통과
  - 공격: `["<script>alert(1)</script>"]` → 거부
  - DOS: 1001개 배열 → 거부
- 단위 테스트: `tests/unit/privacy-settings.spec.js`에 추가

**예상 시간**: 1시간

---

#### #5 북마크 리스너 중복 start() 제거 (Claude)
**파일**: `src/index.js:284, 792`

**현재 문제**:
```javascript
// Line 284
bookmarkListener.start();

// Line 792 (boot 함수 내부)
function boot() {
  // ...
  bookmarkListener.start();  // ← 중복 호출
}
```

**수정안**:
```javascript
// Line 284-285 삭제
// bookmarkListener.start();  ← 제거

// boot()에서만 호출
function boot() {
  if (panelMounted) return;
  // ...
  GMH.Core.MessageIndexer.start();
  bookmarkListener.start();  // ← 여기서만 호출
  panelMounted = true;
}
```

**검증**:
- `src/core/bookmark-listener.js`에서 중복 방지 로직 확인
- Smoke test 통과 확인

**예상 시간**: 15분

---

### v1.8.0 체크리스트

- [ ] #1 중복 대사 수정 + 회귀 테스트
- [ ] #2 Modal XSS 방어 + 단위 테스트
- [ ] #3 MutationObserver 플래그 추가
- [ ] #4 localStorage 검증 + 테스트
- [ ] #5 북마크 리스너 중복 제거
- [ ] 전체 테스트 스위트 통과 (`npm test`)
- [ ] Smoke 테스트 통과 (`npm run test:smoke`)
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v1.8.0` 생성 + push

**롤백 계획**: Git tag `v1.7.4`로 revert

---

## 🔧 v1.9.0 - Refactor Patch (아키텍처 개선)

**목표**: 유지보수성 향상 + TypeScript 전환 기반 마련
**기간**: 3-4주 (20-25시간)
**릴리스 조건**: 테스트 통과 + JSDoc 커버리지 50% 이상

### 포함 이슈

#### #6 index.js 분리 (Comprehensive 최우선)
**파일**: `src/index.js` (912줄 → ~200줄)

**목표 구조**:
```
src/
├── composition/
│   ├── adapter-composition.js      # 어댑터 설정 (126-200줄)
│   ├── privacy-composition.js      # 프라이버시 조립 (369-433줄)
│   ├── ui-composition.js           # UI 와이어링 (640-692줄)
│   ├── share-composition.js        # 공유 워크플로우 (580-614줄)
│   └── bootstrap.js                 # 부트스트랩 순서 조율
├── index.js                        # <200줄 (조합 + 마운트만)
```

**단계별 작업**:
1. `src/composition/` 디렉토리 생성
2. `adapter-composition.js` 생성 및 마이그레이션
   ```javascript
   export function composeAdapters({ registry, errorHandler, ENV }) {
     registerAdapterConfig('genit', { /* ... */ });
     const genitAdapter = createGenitAdapter({ /* ... */ });
     return { adapters: [genitAdapter], getActiveAdapter };
   }
   ```
3. `privacy-composition.js`, `ui-composition.js`, `share-composition.js` 생성
4. `bootstrap.js`에서 조립 순서 정의
5. `index.js`를 간소화하여 composition 호출만

**검증**:
- 빌드 성공 (`USE_ROLLUP=1 npm run build`)
- 테스트 통과
- 기능 동작 확인 (genit.ai에서 수동 테스트)

**예상 시간**: 8-10시간

---

#### #7 JSDoc 타입 주석 추가 (Codex 방식)
**대상**: 상위 30개 공개 API

**우선순위 모듈**:
```javascript
// 1. src/features/share.js
/**
 * Creates share workflow coordinator for privacy-aware export.
 * @param {Object} deps - Dependency injection container
 * @param {() => StructuredSnapshot} deps.captureStructuredSnapshot - Snapshot capture function
 * @param {(raw: string) => string} deps.normalizeTranscript - Text normalization
 * @param {(normalized: string) => Session} deps.buildSession - Session builder
 * @param {ExportRange} deps.exportRange - Range calculator
 * @param {(session: Session, profileKey: string) => PrivacyResult} deps.applyPrivacyPipeline - Privacy redaction
 * @returns {ShareWorkflowAPI}
 */
export function createShareWorkflow(deps) { /* ... */ }

// 2. src/privacy/pipeline.js
/**
 * @typedef {Object} PrivacyResult
 * @property {string} profile - Active profile key
 * @property {Session} sanitizedSession - Redacted session
 * @property {string} sanitizedRaw - Redacted raw text
 * @property {Object<string, number>} counts - Redaction counts by category
 * @property {boolean} blocked - Whether content was blocked
 */

// 3. src/core/state.js
/**
 * @typedef {'idle'|'scanning'|'redacting'|'preview'|'exporting'|'done'|'error'} AppState
 */
```

**타입 정의 파일 생성**: `src/types.js`
```javascript
/**
 * @typedef {Object} Session
 * @property {SessionMeta} meta
 * @property {Turn[]} turns
 * @property {string[]} warnings
 * @property {string} [source]
 */

/**
 * @typedef {Object} Turn
 * @property {'player'|'npc'|'narration'} role
 * @property {string} speaker
 * @property {string} text
 * @property {'user'|'llm'|'system'} channel
 * @property {number} sceneId
 */
```

**tsconfig.json 추가**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": false,
    "types": ["vitest/globals", "tampermonkey"]
  },
  "include": ["src/**/*.js"],
  "exclude": ["node_modules", "dist"]
}
```

**package.json 스크립트 추가**:
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "pretest": "npm run typecheck && npm run build"
  }
}
```

**검증**:
- `npm run typecheck` 통과 (warning 허용, error 0개)
- IDE에서 타입 힌트 표시 확인

**예상 시간**: 6-8시간

---

#### #8 내레이션 필터 개선 (Codex)
**파일**: `src/adapters/genit.js:596-608`

**현재 문제**:
```javascript
const shouldSkipNarrationLine = (text, element) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1 && looksLikeName(text)) {
    return true;  // "정적", "침묵" 같은 1단어도 필터링됨
  }
  return false;
};
```

**수정안**:
```javascript
const shouldSkipNarrationLine = (text, element) => {
  const words = text.split(/\s+/).filter(Boolean);

  // 1단어 + 이름처럼 보이는 경우
  if (words.length === 1 && looksLikeName(text)) {
    // DOM 컨텍스트 확인: .text-muted-foreground는 내레이션 가능성
    const isMutedStyle = element?.closest?.('.text-muted-foreground') !== null;
    if (isMutedStyle) {
      // "정적", "침묵" 같은 단어는 보존
      return false;
    }
    // 실제 이름으로 판단되면 스킵
    return true;
  }

  return false;
};
```

**검증**:
- 테스트 케이스:
  - "정적" (in `.text-muted-foreground`) → 보존
  - "김철수" (in normal context) → 스킵
- 회귀 테스트: 기존 snapshot 출력 비교

**예상 시간**: 2시간

---

#### #9 Export Range 세션 전환 초기화 (Codex)
**파일**: `src/features/auto-loader.js:215-234`

**현재 문제**:
```javascript
const newTotals = {
  message: Math.max(totals.message || 0, stats.totalMessages),
  user: Math.max(totals.user || 0, stats.userMessages),
  llm: Math.max(totals.llm || 0, stats.llmMessages),
};
// ↑ 새 대화로 전환해도 이전 카운터가 남음
```

**수정안 옵션 A** (보수적):
```javascript
// URL 또는 adapter 변경 감지 시 초기화
let previousUrl = location.href;

const detectSessionChange = () => {
  const currentUrl = location.href;
  if (currentUrl !== previousUrl) {
    previousUrl = currentUrl;
    return true;
  }
  return false;
};

// collectTurnStats 내부
if (detectSessionChange()) {
  exportRange?.setTotals?.({ message: 0, user: 0, llm: 0, entry: 0 });
}
```

**수정안 옵션 B** (적극적):
```javascript
// 메시지 수가 급격히 감소하면 새 세션으로 판단
const newTotals = {
  message: stats.totalMessages,
  user: stats.userMessages,
  llm: stats.llmMessages,
};

// 이전보다 50% 이상 감소 시 리셋
if (newTotals.message < (totals.message || 0) * 0.5) {
  exportRange?.setTotals?.(newTotals);
} else {
  // 기존 로직: 증가만 허용
  exportRange?.setTotals?.({
    message: Math.max(totals.message || 0, newTotals.message),
    // ...
  });
}
```

**권장**: 옵션 A (URL 기반) - 더 명확함

**검증**:
- 수동 테스트: genit.ai에서 다른 대화로 이동 → Range 리셋 확인
- 단위 테스트: URL 변경 시나리오

**예상 시간**: 2시간

---

#### #10 고차 함수로 Wrapper 통합 (Claude)
**파일**: `src/index.js:210-233`

**현재 문제**:
```javascript
const toJSONExportLegacy = (session, normalizedRaw, options = {}) =>
  toJSONExport(session, normalizedRaw, {
    playerNames: getPlayerNames(),
    ...options,
  });

const toStructuredMarkdownLegacy = (options = {}) =>
  toStructuredMarkdown({
    playerNames: getPlayerNames(),
    playerMark: PLAYER_MARK,
    ...options,
  });
// ... 총 6개 wrapper
```

**수정안**:
```javascript
// src/utils/factories.js 신규 파일
export const withPlayerNames = (exportFn) =>
  (session, raw, options = {}) =>
    exportFn(session, raw, {
      playerNames: getPlayerNames(),
      ...options,
    });

export const withPlayerContext = (exportFn) =>
  (options = {}) =>
    exportFn({
      playerNames: getPlayerNames(),
      playerMark: PLAYER_MARK,
      ...options,
    });

// src/index.js
import { withPlayerNames, withPlayerContext } from './utils/factories.js';

const toJSONExportLegacy = withPlayerNames(toJSONExport);
const toStructuredMarkdownLegacy = withPlayerContext(toStructuredMarkdown);
const toStructuredJSONLegacy = withPlayerContext(toStructuredJSON);
const toStructuredTXTLegacy = withPlayerContext(toStructuredTXT);
```

**검증**:
- 테스트 통과 (기능 동일)
- 코드 라인 감소: 24줄 → 8줄

**예상 시간**: 2시간

---

### v1.9.0 체크리스트

- [ ] #6 index.js 분리 완료
- [ ] #7 JSDoc 30개 API 추가 + typecheck 통과
- [ ] #8 내레이션 필터 개선 + 회귀 테스트
- [ ] #9 Export Range 초기화 로직 추가
- [ ] #10 Wrapper 고차 함수 통합
- [ ] 전체 빌드 성공 (`USE_ROLLUP=1 npm run build`)
- [ ] 테스트 스위트 통과
- [ ] JSDoc 커버리지 50% 달성
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v1.9.0` 생성

**롤백 계획**: Git tag `v1.8.0`로 revert

---

## 🚀 v2.0.0 - TypeScript Major (대규모 전환)

**목표**: 전체 코드베이스 TypeScript 전환
**기간**: 2-3개월 (60-80시간)
**릴리스 조건**: 100% TS 전환 + strict mode + 테스트 통과

### Phase 1: 타입 정의 및 빌드 설정 (1-2주)

#### #11 타입 정의 파일 작성
**신규 파일**: `src/types/index.ts`

```typescript
// Core types
export interface Session {
  meta: SessionMeta;
  turns: Turn[];
  warnings: string[];
  source?: string;
}

export interface Turn {
  role: 'player' | 'npc' | 'narration';
  speaker: string;
  text: string;
  channel: 'user' | 'llm' | 'system';
  sceneId: number;
  __gmhEntries?: Entry[];
  __gmhSourceBlocks?: Element[];
  __gmhIndex?: number;
  __gmhOrdinal?: number;
}

export interface SessionMeta {
  timestamp?: string;
  version?: string;
  adapter?: string;
  selection?: SelectionMeta;
  [key: string]: unknown;
}

export interface SelectionMeta {
  active: boolean;
  range: RangeInfo;
  indices: {
    start: number | null;
    end: number | null;
  };
}

export interface RangeInfo {
  start: number | null;
  end: number | null;
  count: number | null;
  total: number | null;
  active?: boolean;
  startIndex?: number;
  endIndex?: number;
}

// Privacy types
export type PrivacyProfileKey = 'minimal' | 'safe' | 'research' | 'custom';

export interface PrivacyProfile {
  label: string;
  enabled: Record<string, boolean>;
  customLists?: Record<string, string[]>;
}

export interface PrivacyResult {
  profile: PrivacyProfileKey;
  sanitizedSession: Session;
  sanitizedRaw: string;
  structured: StructuredSnapshot | null;
  playerNames: string[];
  counts: Record<string, number>;
  totalRedactions: number;
  blocked: boolean;
}

// Export types
export type ExportFormat =
  | 'json'
  | 'md'
  | 'txt'
  | 'structured-json'
  | 'structured-md'
  | 'structured-txt';

export interface ExportBundle {
  content: string;
  filename: string;
  mime: string;
}

// State types
export type AppState =
  | 'idle'
  | 'scanning'
  | 'redacting'
  | 'preview'
  | 'exporting'
  | 'done'
  | 'error';

export interface StatePayload {
  label?: string;
  message?: string;
  tone?: 'info' | 'progress' | 'success' | 'warning' | 'error' | 'muted';
  progress?: {
    value?: number;
    indeterminate?: boolean;
  };
}

// Factory types
export interface GMHConfig {
  console: Pick<Console, 'log' | 'warn' | 'error' | 'debug'>;
  window: Window;
  localStorage: Storage;
  document: Document;
}

export interface ErrorHandler {
  handle(error: Error | string, context: string, level?: string): void;
  LEVELS: {
    INFO: 'info';
    WARN: 'warn';
    ERROR: 'error';
  };
}

// Structured snapshot types
export interface StructuredSnapshot {
  messages: StructuredMessage[];
  legacyLines: string[];
  entryOrigin: Element[];
  errors: string[];
  generatedAt: number;
}

export interface StructuredMessage {
  speaker: string;
  parts: StructuredPart[];
  legacyLines?: string[];
}

export interface StructuredPart {
  type: 'dialogue' | 'narration' | 'info' | 'list' | 'image';
  speaker?: string;
  lines?: string[];
  legacyLines?: string[];
  items?: string[];
  text?: string;
  alt?: string;
  title?: string;
}
```

**예상 시간**: 4-6시간

---

#### #12 Rollup TypeScript 플러그인 설정
**파일**: `rollup.config.js`

```javascript
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.ts',  // .js → .ts
  output: {
    file: 'dist/genit-memory-helper.user.js',
    format: 'iife',
    name: 'GMH',
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false,
    }),
    nodeResolve(),
  ],
};
```

**tsconfig.json 업데이트**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "allowJs": true,        // Phase 2-3 동안 JS 허용
    "checkJs": false,       // TS 파일만 체크
    "noEmit": false,        // Rollup이 emit 담당
    "strict": false,        // Phase 4에서 활성화
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**검증**:
- `USE_ROLLUP=1 npm run build` 성공
- 생성된 `.user.js` 파일 동작 확인

**예상 시간**: 2시간

---

### Phase 2: Utils 모듈 전환 (2-3주)

#### #13 Utils 모듈 TS 전환
**대상 파일**:
```
src/utils/text.js      → src/utils/text.ts
src/utils/dom.js       → src/utils/dom.ts
src/utils/validation.js → src/utils/validation.ts
```

**예시**: `src/utils/text.ts`
```typescript
/**
 * Normalizes newlines to \n
 */
export function normNL(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Strips markdown code fences
 */
export function stripTicks(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/^```[\s\S]*?```$/gm, '').trim();
}

/**
 * Collapses multiple spaces to single space
 */
export function collapseSpaces(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

// ... 나머지 함수들
```

**검증**:
- 기존 테스트 통과 (import 경로만 변경)
- TypeScript 타입 에러 0개

**예상 시간**: 6-8시간

---

### Phase 3: Core 모듈 전환 (3-4주)

#### #14 Core 모듈 TS 전환
**대상 파일** (의존성 순서):
```
1. src/core/namespace.ts
2. src/core/utils.ts
3. src/core/state.ts
4. src/core/error-handler.ts
5. src/core/turn-bookmarks.ts
6. src/core/export-range.ts
7. src/core/message-indexer.ts
8. src/core/bookmark-listener.ts
```

**예시**: `src/core/state.ts`
```typescript
import type { AppState, StatePayload } from '../types/index.js';

type StateListener = (state: AppState, meta: {
  previous: AppState | null;
  payload: StatePayload | null;
}) => void;

export const GMH_STATE: Record<string, AppState> = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  REDACTING: 'redacting',
  PREVIEW: 'preview',
  EXPORTING: 'exporting',
  DONE: 'done',
  ERROR: 'error',
} as const;

export const STATE_TRANSITIONS: Record<AppState, AppState[]> = {
  idle: ['idle', 'scanning', 'redacting', 'error'],
  scanning: ['scanning', 'redacting', 'preview', 'done', 'error', 'idle'],
  redacting: ['redacting', 'preview', 'exporting', 'done', 'error', 'idle'],
  preview: ['preview', 'exporting', 'idle', 'done', 'error'],
  exporting: ['exporting', 'done', 'error', 'idle'],
  done: ['done', 'idle', 'scanning', 'redacting'],
  error: ['error', 'idle', 'scanning', 'redacting'],
};

interface StateManager {
  current: AppState;
  previous: AppState | null;
  payload: StatePayload | null;
  getState(): AppState;
  subscribe(listener: StateListener): () => void;
  setState(nextState: AppState, payload?: StatePayload): boolean;
  reset(): void;
}

interface CreateStateManagerOptions {
  console?: Pick<Console, 'warn' | 'error'>;
  debug?: (...args: unknown[]) => void;
}

export const createStateManager = (
  options: CreateStateManagerOptions = {}
): StateManager => {
  // ... 기존 로직, 타입 명시
};
```

**검증**:
- 각 파일 전환 후 `npm run typecheck`
- 테스트 통과 확인

**예상 시간**: 12-15시간

---

### Phase 4: Features, Privacy, Export 전환 (4-6주)

#### #15 Features/Privacy/Export 모듈 TS 전환
**대상**:
```
src/privacy/*
src/export/*
src/features/*
```

**예시**: `src/features/share.ts`
```typescript
import type {
  Session,
  PrivacyResult,
  ExportFormat,
  ExportBundle,
  AppState,
  StatePayload,
  RangeInfo,
} from '../types/index.js';

export interface ShareWorkflowDeps {
  captureStructuredSnapshot: (options?: { force?: boolean }) => StructuredSnapshot;
  normalizeTranscript: (raw: string) => string;
  buildSession: (normalized: string) => Session;
  exportRange: ExportRange;
  projectStructuredMessages: (
    snapshot: StructuredSnapshot,
    rangeInfo: RangeInfo
  ) => StructuredMessage[];
  cloneSession: (session: Session) => Session;
  applyPrivacyPipeline: (
    session: Session,
    rawText: string,
    profileKey: string,
    snapshot?: StructuredSnapshot | null
  ) => PrivacyResult;
  privacyConfig: PrivacyConfig;
  privacyProfiles: Record<string, PrivacyProfile>;
  formatRedactionCounts: (counts: Record<string, number>) => string;
  setPanelStatus?: (message: string, tone?: string) => void;
  // ... 나머지 의존성
  stateApi: StateManager;
  stateEnum: typeof GMH_STATE;
  confirmPrivacyGate: (options: PrivacyGateOptions) => Promise<boolean>;
  getEntryOrigin?: () => Element[];
  collectSessionStats: (session: Session) => SessionStats;
}

export interface ShareWorkflowAPI {
  parseAll(): ParseAllResult;
  prepareShare(options: PrepareShareOptions): Promise<ShareResult | null>;
  performExport(prepared: ShareResult, format: ExportFormat): Promise<boolean>;
  copyRecent(prepareShareFn: PrepareShareFn): Promise<void>;
  copyAll(prepareShareFn: PrepareShareFn): Promise<void>;
  reparse(): void;
}

export function createShareWorkflow(deps: ShareWorkflowDeps): ShareWorkflowAPI {
  // ... 기존 로직, 타입 명시
}
```

**검증**:
- 타입 에러 해결
- 테스트 통과

**예상 시간**: 20-25시간

---

### Phase 5: Adapters, UI 전환 (4-6주)

#### #16 Adapters/UI 모듈 TS 전환
**대상**:
```
src/adapters/*
src/ui/*
```

**주의사항**:
- DOM 타입: `Element`, `HTMLElement`, `Document` 활용
- Tampermonkey API 타입: `@types/tampermonkey` 설치
  ```bash
  npm install -D @types/tampermonkey
  ```

**예시**: `src/adapters/genit.ts`
```typescript
import type { Adapter, AdapterConfig } from '../types/adapter.js';

export interface GenitAdapterOptions {
  registry?: AdapterRegistry;
  playerMark?: string;
  getPlayerNames?: () => string[];
  isPrologueBlock?: (element: Element) => boolean;
  errorHandler?: ErrorHandler;
}

export const createGenitAdapter = (
  options: GenitAdapterOptions = {}
): Adapter => {
  // ... 기존 로직
};
```

**검증**:
- 가장 복잡한 파일이므로 단계적 전환
- 각 함수별 타입 검증

**예상 시간**: 20-25시간

---

### Phase 6: 엄격 모드 활성화 (1-2주)

#### #17 strict mode 활성화
**tsconfig.json 수정**:
```json
{
  "compilerOptions": {
    "strict": true,
    "allowJs": false,  // 순수 TS만
    // ...
  }
}
```

**수정 필요 사항**:
- `null` / `undefined` 체크 강화
- `any` 타입 제거
- 함수 파라미터 `optional` 명시

**예상 시간**: 8-10시간

---

### v2.0.0 체크리스트

- [ ] Phase 1: 타입 정의 + 빌드 설정
- [ ] Phase 2: Utils 모듈 전환
- [ ] Phase 3: Core 모듈 전환
- [ ] Phase 4: Features/Privacy/Export 전환
- [ ] Phase 5: Adapters/UI 전환
- [ ] Phase 6: strict mode 활성화
- [ ] 모든 TS 에러 해결
- [ ] 전체 테스트 통과
- [ ] Smoke 테스트 통과
- [ ] 빌드 성공 (`USE_ROLLUP=1 npm run build`)
- [ ] CHANGELOG.md 메이저 업데이트
- [ ] Git tag `v2.0.0` 생성

**롤백 계획**: Git tag `v1.9.0`로 revert (단, 대규모 변경이므로 롤백 어려움)

---

## 🎨 v2.1.0 - Polish Patch (품질 향상)

**목표**: 테스트 커버리지 70% + UI 개선
**기간**: 1개월 (30-40시간)

### 포함 이슈

#### #18 Modern/Legacy UI 통합 (Comprehensive)
**파일**: `src/ui/panel-modern.js`, `src/ui/panel-legacy.js`

**전략**:
1. 사용률 조사
   ```javascript
   // localStorage flag 분석
   const usage = {
     modern: localStorage.getItem('gmh_flag_newUI') === '1',
     legacy: localStorage.getItem('gmh_flag_newUI') !== '1',
   };
   ```
2. Legacy 사용자 < 5% → Deprecated 공지
3. 공통 로직 추출
   ```typescript
   // src/ui/panel-core.ts
   export function createPanelCore(options: PanelOptions) {
     // 공통 로직
   }

   // src/ui/panel-modern.ts
   import { createPanelCore } from './panel-core.js';
   export function createModernPanel(options) {
     const core = createPanelCore(options);
     // Modern 전용 스타일
   }
   ```

**검증**:
- 기존 사용자 경험 유지
- 코드 중복 50% 감소

**예상 시간**: 12-15시간

---

#### #19 테스트 커버리지 70% 달성
**현재**: ~30%
**목표**: 70%

**우선순위 모듈**:
```
1. src/privacy/* (가장 중요 - 데이터 보호)
2. src/export/* (데이터 품질)
3. src/features/share.ts (핵심 워크플로우)
4. src/adapters/genit.ts (DOM 파싱)
```

**신규 테스트**:
```typescript
// tests/unit/privacy-pipeline.spec.ts
describe('Privacy Pipeline', () => {
  it('should redact email addresses', () => {
    const result = applyPrivacyPipeline(session, 'test@example.com', 'safe');
    expect(result.sanitizedRaw).not.toContain('test@example.com');
    expect(result.counts.EMAIL).toBe(1);
  });

  it('should block minor sexual context', () => {
    const result = applyPrivacyPipeline(session, '... 미성년자 ...', 'safe');
    expect(result.blocked).toBe(true);
  });
});
```

**Istanbul 설정**:
```json
// package.json
{
  "scripts": {
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.0.5"
  }
}
```

**검증**:
- `npm run test:coverage` 실행
- 커버리지 리포트 70% 이상

**예상 시간**: 15-20시간

---

#### #20 에러 처리 표준화 (Comprehensive)
**현재 문제**: 3가지 패턴 혼재

**표준안**:
```typescript
// src/core/error-handler.ts에 통합
export class GMHError extends Error {
  constructor(
    message: string,
    public context: string,
    public level: 'info' | 'warn' | 'error' = 'error'
  ) {
    super(message);
    this.name = 'GMHError';
  }
}

// 사용
try {
  // ...
} catch (err) {
  throw new GMHError(
    err.message,
    'privacy/load',
    'error'
  );
}
```

**마이그레이션**:
- 모든 `console.warn` → `errorHandler.handle`
- Silent catch 제거 또는 명시적 로그 추가

**예상 시간**: 3-4시간

---

### v2.1.0 체크리스트

- [ ] #18 Modern/Legacy UI 통합 또는 Deprecated
- [ ] #19 테스트 커버리지 70% 달성
- [ ] #20 에러 처리 표준화
- [ ] Istanbul 커버리지 리포트 생성
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v2.1.0` 생성

---

## ⚡ v2.2.0 - Performance Patch (성능 최적화)

**목표**: 자동 로더 성능 2배 향상
**기간**: 2-3주 (10-15시간)

### 포함 이슈

#### #21 자동 로더 캐싱 (Comprehensive + Codex)
**파일**: `src/features/auto-loader.js:149-196`

**현재 문제**:
```typescript
// 매 스크롤마다 전체 DOM 파싱
// 1000 메시지 × 60 사이클 = 60,000회 쿼리
```

**수정안**:
```typescript
interface MessageCache {
  snapshot: WeakMap<Element, ParsedMessage>;
  lastParse: number;
  invalidate(): void;
}

const createMessageCache = (): MessageCache => {
  const snapshot = new WeakMap<Element, ParsedMessage>();
  let lastParse = 0;

  return {
    snapshot,
    lastParse,
    invalidate() {
      // snapshot은 WeakMap이므로 자동 GC
      this.lastParse = Date.now();
    },
  };
};

// collectTurnStats에서 활용
const collectTurnStats = (cache: MessageCache) => {
  const now = Date.now();
  if (now - cache.lastParse < 500) {
    // 500ms 이내 재파싱 방지
    return cachedStats;
  }

  // 새로운 메시지만 파싱
  messages.forEach(msg => {
    if (!cache.snapshot.has(msg)) {
      const parsed = parseMessage(msg);
      cache.snapshot.set(msg, parsed);
    }
  });

  cache.lastParse = now;
  return computeStats(cache.snapshot);
};
```

**검증**:
- 성능 테스트: 1000 메시지 로드 시간 측정
  - 현재: ~2.6분
  - 목표: ~50-60초 (3배 향상)

**예상 시간**: 4-5시간

---

#### #22 매직 넘버 상수화 (Comprehensive + Claude)
**대상**:
```typescript
// src/constants.ts 신규 파일
export const CONSTANTS = {
  // DOM 탐색
  MAX_PROLOGUE_HOPS: 400,

  // Auto-loader
  AUTO_LOADER_CYCLE_DELAY_MS: 700,
  AUTO_LOADER_SCROLL_STEP_PX: 500,

  // Preview
  PREVIEW_TURN_LIMIT: 5,

  // Validation
  MAX_BLACKLIST_ITEMS: 1000,
  MAX_BLACKLIST_ITEM_LENGTH: 200,
} as const;

// 사용
while (current && hops < CONSTANTS.MAX_PROLOGUE_HOPS) {
  // ...
}
```

**검증**:
- 상수 사용 일관성 확인
- 테스트 통과

**예상 시간**: 1-2시간

---

#### #23 프라이버시 레다크션 최적화 (Comprehensive)
**파일**: `src/privacy/redaction.js`

**현재**: 7개 regex 직렬 실행

**최적화**:
```typescript
// 단일 패스 통합
const COMBINED_PATTERN = new RegExp(
  [
    EMAIL_PATTERN.source,
    PHONE_PATTERN.source,
    CARD_PATTERN.source,
    // ...
  ].join('|'),
  'gi'
);

export function redactText(
  text: string,
  profileKey: string,
  counts: Record<string, number>
): string {
  return text.replace(COMBINED_PATTERN, (match) => {
    // 매치 타입 식별
    if (EMAIL_PATTERN.test(match)) {
      counts.EMAIL = (counts.EMAIL || 0) + 1;
      return '[이메일]';
    }
    // ...
  });
}
```

**검증**:
- 성능 테스트: 10,000자 텍스트 레다크션 시간
  - 현재: ~50ms
  - 목표: ~20ms (2.5배 향상)

**예상 시간**: 3-4시간

---

### v2.2.0 체크리스트

- [ ] #21 자동 로더 캐싱 구현
- [ ] #22 매직 넘버 상수화
- [ ] #23 프라이버시 레다크션 최적화
- [ ] 성능 벤치마크 측정 및 문서화
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v2.2.0` 생성

---

## 📊 전체 로드맵 요약

### 타임라인

```
2025-10-06 (현재 v1.7.4)
    ↓
    ├── Week 1: v1.8.0 Hotfix (긴급 수정)
    │   └── 5-8 hours
    ↓
    ├── Week 2-5: v1.9.0 Refactor (아키텍처)
    │   └── 20-25 hours
    ↓
    ├── Month 2-4: v2.0.0 TypeScript (대전환)
    │   └── 60-80 hours
    ↓
    ├── Month 5: v2.1.0 Polish (품질)
    │   └── 30-40 hours
    ↓
    └── Month 5-6: v2.2.0 Performance (최적화)
        └── 10-15 hours

총 예상 기간: 5-6개월
총 예상 시간: 125-168 hours (주말 작업 기준)
```

### 우선순위 매트릭스

| 이슈 | 영향도 | 긴급도 | 난이도 | 우선순위 |
|-----|-------|-------|-------|---------|
| #1 중복 대사 누락 | HIGH | HIGH | LOW | 🔴 P0 |
| #2 Modal XSS | HIGH | HIGH | LOW | 🔴 P0 |
| #3 MutationObserver | HIGH | HIGH | LOW | 🔴 P0 |
| #4 localStorage 검증 | MEDIUM | HIGH | LOW | 🔴 P0 |
| #5 북마크 중복 | MEDIUM | MEDIUM | LOW | 🟡 P1 |
| #6 index.js 분리 | HIGH | MEDIUM | HIGH | 🟡 P1 |
| #7 JSDoc | HIGH | MEDIUM | MEDIUM | 🟡 P1 |
| #8 내레이션 필터 | MEDIUM | MEDIUM | LOW | 🟡 P1 |
| #9 Range 초기화 | MEDIUM | MEDIUM | LOW | 🟡 P1 |
| #10 Wrapper 통합 | LOW | LOW | LOW | 🟢 P2 |
| #11-17 TypeScript | HIGH | MEDIUM | HIGH | 🟡 P1 |
| #18 UI 통합 | MEDIUM | LOW | MEDIUM | 🟢 P2 |
| #19 테스트 | HIGH | MEDIUM | HIGH | 🟡 P1 |
| #20 에러 표준화 | LOW | LOW | LOW | 🟢 P2 |
| #21 캐싱 | MEDIUM | LOW | MEDIUM | 🟢 P2 |
| #22 상수화 | LOW | LOW | LOW | 🟢 P3 |
| #23 레다크션 | LOW | LOW | MEDIUM | 🟢 P3 |

### 성공 지표

| 마일스톤 | 코드 품질 | 보안 | 성능 | 유지보수성 |
|---------|---------|------|------|----------|
| **v1.8.0** | B+ → A- | C → B+ | B | B+ |
| **v1.9.0** | A- → A | B+ → A- | B | B+ → A- |
| **v2.0.0** | A → A+ | A- → A | B | A- → A+ |
| **v2.1.0** | A+ | A → A+ | B | A+ |
| **v2.2.0** | A+ | A+ | B → A | A+ |

### 리스크 관리

| 마일스톤 | 주요 리스크 | 완화 전략 | 롤백 계획 |
|---------|-----------|---------|----------|
| **v1.8.0** | 버그 수정이 새 버그 유발 | 회귀 테스트 필수 | v1.7.4로 revert |
| **v1.9.0** | index.js 분리 시 import 깨짐 | 단계별 검증 | v1.8.0로 revert |
| **v2.0.0** | TS 전환 중 기능 손실 | Phase별 점진적 전환 | v1.9.0로 revert (어려움) |
| **v2.1.0** | UI 통합으로 사용자 혼란 | Deprecated 공지 기간 | v2.0.0로 revert |
| **v2.2.0** | 성능 개선이 버그 유발 | 벤치마크 회귀 테스트 | v2.1.0로 revert |

---

## 🎯 실행 가이드

### 개발자를 위한 체크리스트

#### v1.8.0 시작 전
- [ ] 현재 v1.7.4에서 모든 테스트 통과 확인
- [ ] `git checkout -b hotfix/v1.8.0` 브랜치 생성
- [ ] 5개 리뷰 문서 재검토

#### 각 이슈 작업 시
- [ ] 이슈 번호로 feature 브랜치 생성 (`git checkout -b fix/#1-duplicate-dialogue`)
- [ ] 수정 전 실패 테스트 작성 (TDD)
- [ ] 코드 수정
- [ ] 테스트 통과 확인
- [ ] Commit 메시지: `fix: #1 중복 대사 누락 수정`
- [ ] PR 생성 → `hotfix/v1.8.0`로 merge

#### 마일스톤 릴리스 시
- [ ] 전체 테스트 통과 확인
- [ ] CHANGELOG.md 업데이트
- [ ] `package.json` 버전 업데이트
- [ ] `git tag v1.8.0` 생성
- [ ] `git push --tags`
- [ ] GitHub Release 생성

### 권장 작업 환경

```bash
# 개발 환경 설정
npm install
npm run typecheck  # v1.9.0 이후

# 테스트
npm test           # 단위 테스트
npm run test:smoke # Smoke 테스트 (credentials 필요)

# 빌드
npm run build               # 일반 빌드
USE_ROLLUP=1 npm run build  # Rollup 번들 (v2.0.0 이후)

# 커버리지
npm run test:coverage       # v2.1.0 이후
```

---

## 📚 참고 문서

### 기반 리뷰 문서
1. `codex-review.md` - 데이터 품질 버그
2. `comprehensive-project-review.md` - 보안 + 아키텍처
3. `project-review.md` - 런타임 안정성
4. `meta-review.md` - 통합 분석
5. `codex-meta-review.md` - 메타 분석

### 외부 참고
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [Rollup TypeScript Plugin](https://github.com/rollup/plugins/tree/master/packages/typescript)
- [Vitest Coverage](https://vitest.dev/guide/coverage.html)
- [Tampermonkey API](https://www.tampermonkey.net/documentation.php)

---

## 🚀 최종 의견

이 로드맵은 **5개 독립 리뷰의 통합 분석**을 기반으로 작성되었습니다.

### 핵심 원칙
1. **데이터 무결성 최우선** - 중복 대사 누락 같은 품질 이슈를 가장 먼저 해결
2. **보안 취약점 즉시 제거** - XSS, localStorage 검증 긴급 처리
3. **점진적 TypeScript 전환** - Codex 방식(하위→상위)으로 안전하게 진행
4. **하위 호환성 유지** - 각 패치마다 기존 사용자 경험 보존

### 예상 효과
- **v1.8.0**: 데이터 손실 0%, 보안 취약점 제거
- **v1.9.0**: 유지보수 시간 40% 감소, IDE 지원 향상
- **v2.0.0**: 타입 안전성 95%, 런타임 에러 80% 감소
- **v2.1.0**: 테스트 커버리지 70%, 신규 기여자 진입 장벽 50% 감소
- **v2.2.0**: 자동 로더 성능 3배 향상

이 프로젝트는 이미 훌륭한 기반을 갖추고 있으며, 제시된 로드맵을 따르면 **프로덕션 레벨 A+ 오픈소스 프로젝트**로 발전할 수 있습니다. 🎉

---

**로드맵 작성자**: Claude (Sonnet 4.5)
**작성 날짜**: 2025-10-06
**기반 문서**: 5개 독립 리뷰 통합
**업데이트 주기**: 각 마일스톤 완료 시 재평가
