# 🗺️ Genit Memory Helper 개선 로드맵

**버전**: 1.0 (최종 확정)
**작성일**: 2025-10-06
**현재 진행**: v1.8.0 Phase 0 시작됨 (Codex)
**기반**: 5개 독립 리뷰 통합 분석 + Codex 피드백 반영

---

## 📋 로드맵 개요

### 전체 타임라인 (5-6개월)

```
v1.7.4 (현재)
    ↓
v1.8.0 [Hotfix]           ← 1주 (4-6h) ← 🔥 진행 중
    ↓
v1.9.0 [Refactor]         ← 3-4주 (20-25h)
    ↓
v2.0.0 [TypeScript]       ← 2-3개월 (60-80h)
    ↓
v2.1.0 [Polish]           ← 1개월 (30-40h)
    ↓
v2.2.0 [Performance]      ← 2-3주 (10-15h)
```

**총 예상 시간**: 124-166 hours (주말 작업 기준)

### 우선순위 매트릭스

| 패치 | 목표 | 핵심 이슈 | 긴급도 |
|------|------|----------|--------|
| **v1.8.0** | 데이터 손실 방지 + 보안 | 중복 대사, Modal XSS, MutationObserver | 🔴 HIGH |
| **v1.9.0** | 유지보수성 향상 | index.js 분리, JSDoc | 🟡 MEDIUM |
| **v2.0.0** | 타입 안전성 | TypeScript 전환 | 🟡 MEDIUM |
| **v2.1.0** | 품질 향상 | 테스트 커버리지 70% | 🟢 LOW |
| **v2.2.0** | 성능 최적화 | 자동 로더 캐싱 | 🟢 LOW |

---

## 🚨 v1.8.0 - Hotfix Patch (긴급 수정)

**목표**: 데이터 손실 방지 + 런타임 안정성 강화
**기간**: 1주 (4-6시간)
**상태**: 🔥 **진행 중** (Codex)
**릴리스 조건**: 모든 테스트 통과 + 신규 회귀 테스트 추가

### Issue #1: 중복 대사 누락 수정 ⭐ 최우선

**문제**: `collectStructuredMessage`의 `seen` Set이 전체 메시지에서 모든 라인을 중복 제거
- 예: "안녕" (플레이어) → "안녕" (NPC) → 두 번째 "안녕" 스킵됨

**파일**:
- `src/adapters/genit.js:423-447` (emitInfo)
- `src/adapters/genit.js:719-733` (collectStructuredMessage)

**해결책**:

**변경 1**: `emitInfo` - INFO 본문만 별도 배열로 관리
```javascript
// src/adapters/genit.js:423-447
const emitInfo = (block, pushLine, collector = null) => {
  const infoNode = firstMatch(selectors.infoCode, block);
  if (!infoNode) return;

  // INFO 본문만 저장 (중복 제거)
  const infoLinesOut = [];
  const infoSeen = new Set();

  pushLine('INFO');  // legacy 출력용

  const infoLines = textSegmentsFromNode(infoNode);
  infoLines.forEach((seg) => {
    const trimmed = (seg || '').trim();
    if (!trimmed) return;
    if (infoSeen.has(trimmed)) return;  // 중복 제거
    infoSeen.add(trimmed);
    infoLinesOut.push(trimmed);
    pushLine(trimmed);
  });

  markInfoNodeTree(infoNode);

  if (collector) {
    const infoCardWrapper =
      infoNode instanceof Element
        ? infoNode.closest('.bg-card, .info-card, .info-block') ||
          infoNode.closest('pre') ||
          infoNode
        : infoNode.parentElement || block;
    collector.push({
      type: 'info',
      flavor: 'meta',
      role: 'system',
      speaker: 'INFO',
      lines: infoLinesOut,  // ✅ 본문만
      legacyLines: ['INFO', ...infoLinesOut],  // ✅ ['INFO', ...본문]
      legacyFormat: 'meta',
    }, { node: infoCardWrapper });
  }
};
```

**변경 2**: `collectStructuredMessage` - `seen` Set 제거
```javascript
// src/adapters/genit.js:719-733
const collectStructuredMessage = (block) => {
  if (!block) return null;
  const playerGuess = guessPlayerNames()[0] || '플레이어';
  const collector = createStructuredCollector({ playerName: playerGuess }, { rootNode: block });
  const localLines = [];

  // seen Set 제거 - 일반 대사는 중복 허용
  const pushLine = (line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    localLines.push(trimmed);
  };

  try {
    emitTranscriptLines(block, pushLine, collector);
  } catch (err) {
    warnWithHandler(err, 'adapter', '[GMH] structured emit failed');
    emitTranscriptLines(block, pushLine);
  }

  const parts = collector.list();
  // ... 나머지 동일
};
```

**테스트**: `tests/unit/adapter-genit.spec.js`
```javascript
describe('collectStructuredMessage - duplicate handling', () => {
  it('should preserve consecutive duplicate dialogue', () => {
    const block = createMockBlock([
      { role: 'player', text: '안녕' },
      { role: 'npc', text: '안녕' },
    ]);
    const message = adapter.collectStructuredMessage(block);
    const allLines = message.parts.flatMap(part => part.lines || []);
    expect(allLines.filter(line => line === '안녕')).toHaveLength(2);
  });

  it('should deduplicate INFO lines correctly', () => {
    const block = createMockBlock([
      { role: 'info', text: '중요\n중요\n경고' },
    ]);
    const message = adapter.collectStructuredMessage(block);
    const infoPart = message.parts.find(p => p.type === 'info');
    expect(infoPart.lines).toEqual(['중요', '경고']);
    expect(infoPart.legacyLines).toEqual(['INFO', '중요', '경고']);
  });

  it('should not duplicate INFO header in lines', () => {
    const block = createMockBlock([
      { role: 'info', text: '내용1\n내용2' },
    ]);
    const message = adapter.collectStructuredMessage(block);
    const infoPart = message.parts.find(p => p.type === 'info');
    expect(infoPart.lines).not.toContain('INFO');
    expect(infoPart.lines).toEqual(['내용1', '내용2']);
    expect(infoPart.legacyLines[0]).toBe('INFO');
  });
});
```

**예상 시간**: 1.5-2시간

---

### Issue #2: Modal 안전성 테스트 추가

**현황**: 기존 `sanitizeMarkupFragment`는 이미 안전함 (`<template>` 사용)
- 스크립트 실행 안 됨
- 위험 태그/속성 제거
- DocumentFragment 반환 (다중 노드 유지)

**해결책**: **코드 수정 없이 테스트만 추가**

**테스트**: `tests/unit/modal.spec.js` (신규)
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createModal } from '../../src/ui/modal.js';

describe('Modal sanitization', () => {
  let modal;
  let testDocument;

  beforeEach(() => {
    testDocument = document.implementation.createHTMLDocument('test');
    modal = createModal({ documentRef: testDocument, windowRef: window });
  });

  afterEach(() => {
    if (modal?.close) modal.close();
  });

  it('should sanitize inline script tags', async () => {
    const malicious = '<div>Safe</div><script>alert(1)</script>';
    const promise = modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.innerHTML).not.toContain('<script');
    expect(modalBody.innerHTML).toContain('Safe');

    modal.close();
    await promise;
  });

  it('should remove on* event handlers', async () => {
    const malicious = '<img src="x" onerror="alert(1)">';
    const promise = modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const img = testDocument.querySelector('.gmh-modal__body img');
    expect(img?.getAttribute('onerror')).toBeNull();

    modal.close();
    await promise;
  });

  it('should remove javascript: URLs', async () => {
    const malicious = '<a href="javascript:alert(1)">Click</a>';
    const promise = modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const link = testDocument.querySelector('.gmh-modal__body a');
    expect(link?.getAttribute('href')).toBeNull();

    modal.close();
    await promise;
  });

  it('should preserve safe HTML structure', async () => {
    const safe = '<div><p>Paragraph</p><strong>Bold</strong></div>';
    const promise = modal.open({
      title: 'Test',
      content: safe,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.querySelector('p')).toBeTruthy();
    expect(modalBody.querySelector('strong')).toBeTruthy();

    modal.close();
    await promise;
  });

  it('should preserve multiple nodes (DocumentFragment)', async () => {
    const multiNode = '<div>First</div><div>Second</div><div>Third</div>';
    const promise = modal.open({
      title: 'Test',
      content: multiNode,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    const divs = Array.from(modalBody.children).filter(el => el.tagName === 'DIV');
    expect(divs.length).toBeGreaterThanOrEqual(3);

    modal.close();
    await promise;
  });

  it('should remove srcdoc attribute', async () => {
    const malicious = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
    const promise = modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.querySelector('iframe')).toBeNull();

    modal.close();
    await promise;
  });
});
```

**예상 시간**: 1시간

---

### Issue #3: MutationObserver 무한 재부팅 방지

**문제**: genit.ai SPA 라우팅 시 패널 삭제 → `boot()` 재실행 → 리스너 중복 등록

**파일**: `src/index.js:825-834`

**해결책**:
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
  try {
    bookmarkListener.stop();
  } catch (err) {
    const level = errorHandler.LEVELS?.WARN || 'warn';
    errorHandler.handle(err, 'bookmark', level);
  }
  try {
    messageIndexer.stop();
  } catch (err) {
    const level = errorHandler.LEVELS?.WARN || 'warn';
    errorHandler.handle(err, 'adapter', level);
  }
};
```

**검증**: genit.ai에서 페이지 이동 5회 → console.log 카운터 확인

**예상 시간**: 30분

---

### Issue #4: localStorage 검증 추가

**문제**: 악의적 확장 프로그램이 설정 조작 가능

**파일**: `src/privacy/settings.js:55-67`

**해결책**:
```javascript
const validateBlacklist = (data) => {
  if (!Array.isArray(data)) return false;
  if (data.length > 1000) return false;  // DOS 방지
  return data.every(item => {
    if (typeof item !== 'string') return false;
    if (item.length > 200) return false;
    if (/<|>|javascript:/i.test(item)) return false;
    return true;
  });
};

const validateWhitelist = (data) => validateBlacklist(data);

const load = () => {
  try {
    const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
    if (rawBlacklist) {
      try {
        const parsed = JSON.parse(rawBlacklist);
        if (validateBlacklist(parsed)) {
          blacklist = parsed;
        } else {
          console.warn('[GMH Privacy] Invalid blacklist, using defaults');
          blacklist = [];
        }
      } catch (err) {
        blacklist = [];
      }
    }

    const rawWhitelist = readItem(STORAGE_KEYS.privacyWhitelist);
    if (rawWhitelist) {
      try {
        const parsed = JSON.parse(rawWhitelist);
        if (validateWhitelist(parsed)) {
          whitelist = parsed;
        } else {
          console.warn('[GMH Privacy] Invalid whitelist, using defaults');
          whitelist = [];
        }
      } catch (err) {
        whitelist = [];
      }
    }
  } catch (err) {
    if (logger?.warn) logger.warn('[GMH Privacy] Failed to load settings', err);
  }
};
```

**테스트**: `tests/unit/privacy-settings.spec.js`
```javascript
it('should reject malicious blacklist', () => {
  localStorage.setItem('gmh_privacy_blacklist', JSON.stringify(['<script>']));
  const result = store.load();
  expect(result.blacklist).toEqual([]);  // 기본값 사용
});

it('should reject oversized blacklist', () => {
  const huge = new Array(1001).fill('test');
  localStorage.setItem('gmh_privacy_blacklist', JSON.stringify(huge));
  const result = store.load();
  expect(result.blacklist).toEqual([]);
});
```

**예상 시간**: 1시간

---

### Issue #5: 북마크 리스너 중복 start() 제거

**문제**: `bookmarkListener.start()`가 두 번 호출됨

**파일**: `src/index.js:284, 792`

**해결책**:
```javascript
// Line 284-285 삭제
// bookmarkListener.start();  ← 제거

// boot()에서만 호출
function boot() {
  if (panelMounted) return;
  try {
    mountPanel();
    GMH.Core.MessageIndexer.start();
    bookmarkListener.start();  // ← 여기서만
    panelMounted = true;
  } catch (e) {
    const level = errorHandler.LEVELS?.ERROR || 'error';
    errorHandler.handle(e, 'ui/panel', level);
  }
}
```

**예상 시간**: 15분

---

### v1.8.0 체크리스트

- [ ] #1 중복 대사 수정
  - [ ] emitInfo: infoLinesOut 배열 추가
  - [ ] collectStructuredMessage: seen Set 제거
  - [ ] 회귀 테스트 3개
- [ ] #2 Modal 안전성 테스트 6개
- [ ] #3 MutationObserver 플래그
- [ ] #4 localStorage 검증 + 테스트
- [ ] #5 북마크 리스너 중복 제거
- [ ] 전체 테스트 통과 (`npm test`)
- [ ] Smoke 테스트 (`npm run test:smoke`)
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v1.8.0` + push

---

## 🔧 v1.9.0 - Refactor Patch (아키텍처 개선)

**목표**: 유지보수성 향상 + TypeScript 전환 기반 마련
**기간**: 3-4주 (20-25시간)
**릴리스 조건**: JSDoc 커버리지 50% + 테스트 통과

### Issue #6: index.js 분리 (912줄 → ~200줄)

**목표 구조**:
```
src/
├── composition/
│   ├── adapter-composition.js
│   ├── privacy-composition.js
│   ├── ui-composition.js
│   ├── share-composition.js
│   └── bootstrap.js
├── index.js  ← <200줄
```

**예상 시간**: 8-10시간

---

### Issue #7: JSDoc 타입 주석 추가

**대상**: 상위 30개 공개 API

**tsconfig.json 추가**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": false
  }
}
```

**package.json**:
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "pretest": "npm run typecheck && npm run build"
  }
}
```

**예상 시간**: 6-8시간

---

### Issue #8: 내레이션 필터 개선

**파일**: `src/adapters/genit.js:596-608`

**수정**:
```javascript
const shouldSkipNarrationLine = (text, element) => {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 1 && looksLikeName(text)) {
    // DOM 컨텍스트 확인
    const isMutedStyle = element?.closest?.('.text-muted-foreground') !== null;
    if (isMutedStyle) {
      return false;  // "정적", "침묵" 보존
    }
    return true;  // 실제 이름은 스킵
  }

  return false;
};
```

**예상 시간**: 2시간

---

### Issue #9: Export Range 세션 전환 초기화

**파일**: `src/features/auto-loader.js:215-234`

**수정**:
```javascript
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

**예상 시간**: 2시간

---

### Issue #10: 고차 함수로 Wrapper 통합

**파일**: `src/index.js:210-233`

**수정**:
```javascript
// src/utils/factories.js
export const withPlayerNames = (exportFn) =>
  (session, raw, options = {}) =>
    exportFn(session, raw, {
      playerNames: getPlayerNames(),
      ...options,
    });

// src/index.js
const toJSONExportLegacy = withPlayerNames(toJSONExport);
```

**예상 시간**: 2시간

---

## 🚀 v2.0.0 - TypeScript Major (대규모 전환)

**목표**: 전체 코드베이스 TypeScript 전환
**기간**: 2-3개월 (60-80시간)
**릴리스 조건**: 100% TS 전환 + strict mode

### Phase 1: 타입 정의 (1-2주)

- `src/types/index.ts` 생성
- Rollup TypeScript 플러그인 설정
- tsconfig.json 구성

**예상 시간**: 6-8시간

---

### Phase 2: Utils 모듈 전환 (2-3주)

```
src/utils/text.js      → .ts
src/utils/dom.js       → .ts
src/utils/validation.js → .ts
```

**예상 시간**: 6-8시간

---

### Phase 3: Core 모듈 전환 (3-4주)

의존성 순서:
1. `src/core/namespace.ts`
2. `src/core/utils.ts`
3. `src/core/state.ts`
4. `src/core/error-handler.ts`
5. `src/core/export-range.ts`
6. `src/core/message-indexer.ts`

**예상 시간**: 12-15시간

---

### Phase 4: Features/Privacy/Export (4-6주)

**예상 시간**: 20-25시간

---

### Phase 5: Adapters/UI (4-6주)

- Tampermonkey 타입: `npm install -D @types/tampermonkey`

**예상 시간**: 20-25시간

---

### Phase 6: strict mode (1-2주)

**예상 시간**: 8-10시간

---

## 🎨 v2.1.0 - Polish Patch (품질 향상)

**목표**: 테스트 커버리지 70% + UI 개선
**기간**: 1개월 (30-40시간)

### Issue #18: Modern/Legacy UI 통합

**전략**:
1. 사용률 조사
2. Legacy < 5% → Deprecated
3. 공통 로직 추출

**예상 시간**: 12-15시간

---

### Issue #19: 테스트 커버리지 70% 달성

**우선순위**:
1. `src/privacy/*` (데이터 보호)
2. `src/export/*` (데이터 품질)
3. `src/features/share.ts` (핵심 워크플로우)

**Istanbul 설정**:
```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage"
  }
}
```

**예상 시간**: 15-20시간

---

### Issue #20: 에러 처리 표준화

**수정**:
```typescript
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
```

**예상 시간**: 3-4시간

---

## ⚡ v2.2.0 - Performance Patch (성능 최적화)

**목표**: 자동 로더 성능 3배 향상
**기간**: 2-3주 (10-15시간)

### Issue #21: 자동 로더 캐싱

**수정**:
```typescript
const createMessageCache = (): MessageCache => {
  const snapshot = new WeakMap<Element, ParsedMessage>();
  let lastParse = 0;

  return {
    snapshot,
    lastParse,
    invalidate() {
      this.lastParse = Date.now();
    },
  };
};
```

**성능 목표**: 2.6분 → 50초 (3배 향상)

**예상 시간**: 4-5시간

---

### Issue #22: 매직 넘버 상수화

**수정**:
```typescript
// src/constants.ts
export const CONSTANTS = {
  MAX_PROLOGUE_HOPS: 400,
  AUTO_LOADER_CYCLE_DELAY_MS: 700,
  PREVIEW_TURN_LIMIT: 5,
  MAX_BLACKLIST_ITEMS: 1000,
} as const;
```

**예상 시간**: 1-2시간

---

### Issue #23: 프라이버시 레다크션 최적화

**수정**: 7개 regex → 단일 패스 통합

**성능 목표**: 50ms → 20ms (2.5배 향상)

**예상 시간**: 3-4시간

---

## 📊 전체 요약

### 마일스톤별 성과 예측

| 마일스톤 | 전체 등급 | 주요 개선 |
|---------|---------|---------|
| **v1.8.0** | B+ → A- | 데이터 손실 0%, 보안 강화 |
| **v1.9.0** | A- → A | 유지보수 시간 40% 감소 |
| **v2.0.0** | A → A+ | 타입 안전성 95%, 런타임 에러 80% 감소 |
| **v2.1.0** | A+ | 테스트 커버리지 70% |
| **v2.2.0** | A+ | 성능 3배 향상 |

### 리스크 관리

| 마일스톤 | 주요 리스크 | 롤백 계획 |
|---------|-----------|----------|
| **v1.8.0** | 버그 수정이 새 버그 유발 | v1.7.4로 revert |
| **v1.9.0** | index.js 분리 시 import 깨짐 | v1.8.0로 revert |
| **v2.0.0** | TS 전환 중 기능 손실 | v1.9.0로 revert |
| **v2.1.0** | UI 통합 사용자 혼란 | v2.0.0로 revert |
| **v2.2.0** | 성능 개선이 버그 유발 | v2.1.0로 revert |

---

## 🚀 실행 가이드

### 현재 진행 중: v1.8.0 (Codex)

```bash
git checkout -b hotfix/v1.8.0

# 1. 중복 대사 수정 (1.5-2h)
#    - src/adapters/genit.js:423 (emitInfo)
#    - src/adapters/genit.js:724 (collectStructuredMessage)
#    - tests/unit/adapter-genit.spec.js

# 2. Modal 테스트 (1h)
#    - tests/unit/modal.spec.js

# 3. MutationObserver (30m)
#    - src/index.js:825-834

# 4. localStorage (1h)
#    - src/privacy/settings.js

# 5. 북마크 (15m)
#    - src/index.js:284, 792

# 완료 후
npm test
npm run test:smoke
git tag v1.8.0
git push --tags
```

### 각 마일스톤 릴리스 시

1. 전체 테스트 통과 확인
2. CHANGELOG.md 업데이트
3. package.json 버전 업데이트
4. Git tag 생성 및 push
5. GitHub Release 생성

---

## 📚 참고 문서

### 기반 리뷰 (reviews/2025-10-06-2/)
1. `codex-review.md` - 데이터 품질 버그
2. `comprehensive-project-review.md` - 보안 + 아키텍처
3. `project-review.md` - 런타임 안정성
4. `meta-review.md` - 통합 분석
5. `codex-meta-review.md` - 메타 분석

### 로드맵 버전 히스토리
- v1: 최초 5개 리뷰 통합
- v2: Codex 1차 피드백 반영
- v3: Codex 2차 피드백 반영 (최종)

### 개발 환경

```bash
npm install
npm run typecheck  # v1.9.0 이후
npm test
npm run test:smoke
USE_ROLLUP=1 npm run build  # v2.0.0 이후
```

---

**작성자**: Claude (Sonnet 4.5)
**기반**: 5개 독립 리뷰 + Codex 피드백 (2회)
**상태**: ✅ 최종 확정 - v1.8.0 진행 중
