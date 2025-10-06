# 🗺️ Genit Memory Helper 최종 개선 로드맵 (v2 - Codex 피드백 반영)
**작성일**: 2025-10-06
**수정일**: 2025-10-06 (Codex 피드백 반영)
**기반 문서**: 5개 독립 리뷰 통합 분석 + Codex 피드백

---

## 📝 Codex 피드백 반영 사항

### 1. Modal XSS 이슈 재평가 ✅
**Codex 피드백**:
> `src/ui/modal.js:16` 현재 `sanitizeMarkupFragment`는 `<template>`을 사용해 스크립트가 실행되지 않으며 노드·속성 필터도 이미 포함되어 있습니다.

**실제 코드 확인** (`src/ui/modal.js:20-42`):
```javascript
const sanitizeMarkupFragment = (markup) => {
  const template = doc.createElement('template');
  template.innerHTML = String(markup ?? '');  // ✅ <template> 내에서는 스크립트 실행 안 됨
  template.content
    .querySelectorAll('script, style, iframe, object, embed, link, meta')
    .forEach((node) => node.remove());  // ✅ 이미 위험 태그 제거
  template.content.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '');
      if (name.startsWith('on')) element.removeAttribute(attr.name);  // ✅ on* 제거
      if (/(javascript:|data:text\/html)/i.test(value)) element.removeAttribute(attr.name);  // ✅ 위험 URL 제거
      if (name === 'srcdoc') element.removeAttribute(attr.name);  // ✅ srcdoc 제거
    });
  });
  return template.content;  // ✅ DocumentFragment 반환 (다중 노드 유지)
};
```

**결론**:
- ✅ 이미 안전함 (`<template>` 특성상 스크립트 실행 안 됨)
- ✅ 필터링도 충분함
- ❌ DOMParser 대체안은 불필요 + 첫 번째 노드만 반환해서 다중 노드 손실

**수정안**:
- 현재 구현 유지
- **테스트만 추가**하여 안전성 검증

---

### 2. 중복 대사 누락 이슈 재설계 ✅
**Codex 피드백**:
> 중복 대사 보존 이슈는 `src/adapters/genit.js:725` 인근의 `localLines` 수집에서 네임스페이스 전체에 대한 Set 필터링이 이루어지는 구조가 핵심입니다. "INFO만 중복 제거" 예시는 실제 구현 위치와 맞지 않으므로, `collector.push` 이전에 (node, lineIndex) 키를 사용하거나 INFO 파트 전용 세트로 갈라서 적용하는 식으로 조정하는 편이 안전합니다.

**실제 코드 확인** (`src/adapters/genit.js:719-733`):
```javascript
const collectStructuredMessage = (block) => {
  // ...
  const localLines = [];
  const seen = new Set();  // ⚠️ 전체 메시지 블록에 단일 Set 사용
  const pushLine = (line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;  // ⚠️ 모든 라인 중복 제거 (INFO + 플레이어 + NPC + 내레이션)
    seen.add(trimmed);
    localLines.push(trimmed);
  };
  try {
    emitTranscriptLines(block, pushLine, collector);  // INFO, 플레이어, NPC, 내레이션 모두 호출
  } catch (err) { /* ... */ }
  // ...
};
```

**문제점**:
- `seen` Set이 **전체 메시지 블록**에서 모든 라인을 중복 제거
- 예: "안녕" (플레이어) → "안녕" (NPC 답변) → 두 번째 "안녕"이 스킵됨
- INFO 중복 제거가 목적이지만, 실제로는 정상 대사도 중복 시 누락

**수정안** (Codex 권장: INFO 파트 전용 세트):

**Option A - 최소 변경 (권장)**:
`emitInfo` 함수 내부에서만 중복 제거, `collectStructuredMessage`에서는 `seen` Set 제거

```javascript
// src/adapters/genit.js:423-447
const emitInfo = (block, pushLine, collector = null) => {
  const infoNode = firstMatch(selectors.infoCode, block);
  if (!infoNode) return;

  // INFO 전용 중복 제거 Set
  const infoSeen = new Set();
  const pushInfoLine = (line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    if (infoSeen.has(trimmed)) return;  // INFO만 중복 제거
    infoSeen.add(trimmed);
    pushLine(trimmed);  // 실제 pushLine 호출
  };

  pushInfoLine('INFO');
  const infoLines = textSegmentsFromNode(infoNode);
  infoLines.forEach((seg) => pushInfoLine(seg));
  markInfoNodeTree(infoNode);

  if (collector) {
    const infoCardWrapper = /* ... */;
    collector.push({
      type: 'info',
      flavor: 'meta',
      role: 'system',
      speaker: 'INFO',
      lines: [...infoSeen],  // 중복 제거된 INFO 라인
      legacyLines: ['INFO', ...infoSeen],
      legacyFormat: 'meta',
    }, { node: infoCardWrapper });
  }
};

// src/adapters/genit.js:719-733
const collectStructuredMessage = (block) => {
  if (!block) return null;
  const playerGuess = guessPlayerNames()[0] || '플레이어';
  const collector = createStructuredCollector({ playerName: playerGuess }, { rootNode: block });
  const localLines = [];

  // ✅ seen Set 제거 - 일반 대사는 중복 허용
  const pushLine = (line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    localLines.push(trimmed);  // 중복 제거 없이 모두 추가
  };

  try {
    emitTranscriptLines(block, pushLine, collector);
  } catch (err) {
    warnWithHandler(err, 'adapter', '[GMH] structured emit failed');
    emitTranscriptLines(block, pushLine);
  }
  // ... 나머지 동일
};
```

**Option B - (node, lineIndex) 키 사용**:
더 복잡하지만 정밀한 제어 가능 (필요 시 적용)

**검증**:
- 테스트 케이스 1: "안녕" → "안녕" (연속 발화) → 2개 모두 export 확인
- 테스트 케이스 2: INFO에 동일 텍스트 2개 → 1개만 export 확인
- 회귀 테스트: 기존 snapshot 비교

---

### 3. 나머지 항목 확인 ✅

**Codex 피드백**:
> 그 외 Phase 0의 나머지 항목(localStorage 검증, MutationObserver 플래그, 북마크 start 중복 방지)은 코드 현실과 일치하며 그대로 진행 가능해 보입니다. Tests 추가 계획도 적절합니다.

- ✅ localStorage 검증
- ✅ MutationObserver 플래그
- ✅ 북마크 start 중복 방지
- ✅ Tests 추가 계획

**변경 없이 진행**

---

## 🚨 v1.8.0 - Hotfix Patch (긴급 수정) - 수정본

**목표**: 데이터 손실 방지 + 런타임 안정성 강화
**기간**: 1주 (4-6시간) ← Modal XSS 수정 제외로 시간 단축
**릴리스 조건**: 모든 기존 테스트 통과 + 신규 회귀 테스트 3개 추가

### 포함 이슈

#### #1 중복 대사 누락 수정 (Codex 최우선) - **재설계**
**파일**: `src/adapters/genit.js`

**변경 1**: `emitInfo` 함수 내부에서만 중복 제거
```javascript
// src/adapters/genit.js:423-447 수정
const emitInfo = (block, pushLine, collector = null) => {
  const infoNode = firstMatch(selectors.infoCode, block);
  if (!infoNode) return;

  // INFO 전용 중복 제거 Set
  const infoSeen = new Set();
  const pushInfoLine = (line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    if (infoSeen.has(trimmed)) return;
    infoSeen.add(trimmed);
    pushLine(trimmed);
  };

  pushInfoLine('INFO');
  const infoLines = textSegmentsFromNode(infoNode);
  infoLines.forEach((seg) => pushInfoLine(seg));
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
      lines: [...infoSeen],  // 중복 제거된 INFO 라인
      legacyLines: ['INFO', ...infoSeen],
      legacyFormat: 'meta',
    }, { node: infoCardWrapper });
  }
};
```

**변경 2**: `collectStructuredMessage`에서 `seen` Set 제거
```javascript
// src/adapters/genit.js:719-733 수정
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

**검증**:
- 테스트 케이스 1: "안녕" → "안녕" (연속 발화) → 2개 모두 export 확인
  ```javascript
  // tests/unit/adapter-genit.spec.js
  it('should preserve consecutive duplicate dialogue', () => {
    const block = createMockBlock([
      { role: 'player', text: '안녕' },
      { role: 'npc', text: '안녕' },
    ]);
    const message = adapter.collectStructuredMessage(block);
    const allLines = message.parts.flatMap(part => part.lines || []);
    expect(allLines.filter(line => line === '안녕')).toHaveLength(2);
  });
  ```
- 테스트 케이스 2: INFO 중복 제거 확인
  ```javascript
  it('should deduplicate INFO lines', () => {
    const block = createMockBlock([
      { role: 'info', text: '중요\n중요\n경고' },
    ]);
    const message = adapter.collectStructuredMessage(block);
    const infoPart = message.parts.find(p => p.type === 'info');
    expect(infoPart.lines).toEqual(['중요', '경고']);  // 중복 '중요' 제거
  });
  ```
- 회귀 테스트: 기존 `adapter-genit.spec.js` 통과 확인

**예상 시간**: 1.5-2시간

---

#### #2 Modal 안전성 테스트 추가 - **수정**
**파일**: `tests/unit/modal.spec.js` (신규)

**Codex 피드백 반영**: 기존 구현은 이미 안전하므로 **코드 수정 없이 테스트만 추가**

```javascript
// tests/unit/modal.spec.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createModal } from '../../src/ui/modal.js';

describe('Modal sanitization', () => {
  let modal;
  let testDocument;

  beforeEach(() => {
    testDocument = document.implementation.createHTMLDocument('test');
    modal = createModal({ documentRef: testDocument, windowRef: window });
  });

  it('should sanitize inline script tags', async () => {
    const malicious = '<div>Safe</div><script>alert(1)</script>';
    const result = await modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    const modalContent = testDocument.querySelector('.gmh-modal');
    expect(modalContent.innerHTML).not.toContain('<script');
    expect(modalContent.innerHTML).toContain('Safe');
  });

  it('should remove on* event handlers', async () => {
    const malicious = '<img src="x" onerror="alert(1)">';
    await modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    const img = testDocument.querySelector('img');
    expect(img?.getAttribute('onerror')).toBeNull();
  });

  it('should remove javascript: URLs', async () => {
    const malicious = '<a href="javascript:alert(1)">Click</a>';
    await modal.open({
      title: 'Test',
      content: malicious,
      actions: [{ label: 'OK', value: true }],
    });

    const link = testDocument.querySelector('a');
    expect(link?.getAttribute('href')).toBeNull();
  });

  it('should preserve safe HTML structure', async () => {
    const safe = '<div><p>Paragraph</p><strong>Bold</strong></div>';
    await modal.open({
      title: 'Test',
      content: safe,
      actions: [{ label: 'OK', value: true }],
    });

    const modalContent = testDocument.querySelector('.gmh-modal');
    expect(modalContent.querySelector('p')).toBeTruthy();
    expect(modalContent.querySelector('strong')).toBeTruthy();
  });

  it('should preserve multiple nodes (DocumentFragment)', async () => {
    const multiNode = '<div>First</div><div>Second</div><div>Third</div>';
    await modal.open({
      title: 'Test',
      content: multiNode,
      actions: [{ label: 'OK', value: true }],
    });

    const modalContent = testDocument.querySelector('.gmh-modal-body');
    const divs = modalContent.querySelectorAll('div');
    expect(divs.length).toBeGreaterThanOrEqual(3);  // 다중 노드 보존 확인
  });
});
```

**검증**:
- 기존 `sanitizeMarkupFragment` 함수는 수정 없음
- 테스트만 추가하여 안전성 검증
- DocumentFragment 반환 → 다중 노드 보존 확인

**예상 시간**: 1시간

---

#### #3 MutationObserver 무한 재부팅 방지 (Claude) - **변경 없음**
**파일**: `src/index.js:825-834`

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

**검증**:
- 수동 테스트: genit.ai에서 페이지 이동 5회 → console.log 카운터 확인
- 회귀 테스트: 기존 smoke test 통과

**예상 시간**: 30분

---

#### #4 localStorage 검증 추가 (Comprehensive) - **변경 없음**
**파일**: `src/privacy/settings.js:55-67`

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

const validateWhitelist = (data) => {
  // blacklist와 동일한 검증 로직
  return validateBlacklist(data);
};

// load() 함수 수정
const load = () => {
  try {
    const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
    if (rawBlacklist) {
      try {
        const parsed = JSON.parse(rawBlacklist);
        if (validateBlacklist(parsed)) {
          blacklist = parsed;
        } else {
          console.warn('[GMH Privacy] Invalid blacklist data, using defaults');
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
          console.warn('[GMH Privacy] Invalid whitelist data, using defaults');
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

**검증**:
- 테스트 케이스:
  - 정상: `["test@example.com"]` → 통과
  - 공격: `["<script>alert(1)</script>"]` → 거부
  - DOS: 1001개 배열 → 거부
  - 긴 문자열: `["A".repeat(201)]` → 거부
- 단위 테스트: `tests/unit/privacy-settings.spec.js`에 추가

**예상 시간**: 1시간

---

#### #5 북마크 리스너 중복 start() 제거 (Claude) - **변경 없음**
**파일**: `src/index.js:284, 792`

**수정안**:
```javascript
// Line 284-285 삭제 (즉시 실행 제거)
// bookmarkListener.start();  ← 제거

// boot()에서만 호출
function boot() {
  if (panelMounted) return;
  try {
    mountPanel();
    GMH.Core.MessageIndexer.start();
    bookmarkListener.start();  // ← 여기서만 호출
    panelMounted = true;
  } catch (e) {
    const level = errorHandler.LEVELS?.ERROR || 'error';
    errorHandler.handle(e, 'ui/panel', level);
  }
}
```

**검증**:
- `src/core/bookmark-listener.js`에서 중복 방지 로직 확인:
  ```javascript
  // 예상 구현 (확인 필요)
  let started = false;

  function start() {
    if (started) return;  // 중복 방지
    started = true;
    // ... 리스너 등록
  }
  ```
- Smoke test 통과 확인

**예상 시간**: 15분

---

### v1.8.0 체크리스트 - **수정본**

- [ ] #1 중복 대사 수정 (INFO 전용 Set + seen 제거) + 회귀 테스트 2개
- [ ] #2 Modal 안전성 테스트 5개 추가 (코드 수정 없음)
- [ ] #3 MutationObserver 플래그 추가
- [ ] #4 localStorage 검증 + 테스트 4개
- [ ] #5 북마크 리스너 중복 제거 + 중복 방지 로직 확인
- [ ] 전체 테스트 스위트 통과 (`npm test`)
- [ ] Smoke 테스트 통과 (`npm run test:smoke`)
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v1.8.0` 생성 + push

**예상 시간**: 4-6시간 (Modal XSS 코드 수정 제외로 2시간 단축)

**롤백 계획**: Git tag `v1.7.4`로 revert

---

## 🔧 v1.9.0 - Refactor Patch (아키텍처 개선)

**변경 없음** - 기존 로드맵 유지

### 포함 이슈

#### #6 index.js 분리 (Comprehensive 최우선)
#### #7 JSDoc 타입 주석 추가 (Codex 방식)
#### #8 내레이션 필터 개선 (Codex)
#### #9 Export Range 세션 전환 초기화 (Codex)
#### #10 고차 함수로 Wrapper 통합 (Claude)

**예상 시간**: 20-25시간

---

## 🚀 v2.0.0 - TypeScript Major (대규모 전환)

**변경 없음** - 기존 로드맵 유지

### Phase 1-6: TypeScript 전환

**예상 시간**: 60-80시간

---

## 🎨 v2.1.0 - Polish Patch (품질 향상)

**변경 없음** - 기존 로드맵 유지

### 포함 이슈

#### #18 Modern/Legacy UI 통합
#### #19 테스트 커버리지 70% 달성
#### #20 에러 처리 표준화

**예상 시간**: 30-40시간

---

## ⚡ v2.2.0 - Performance Patch (성능 최적화)

**변경 없음** - 기존 로드맵 유지

### 포함 이슈

#### #21 자동 로더 캐싱
#### #22 매직 넘버 상수화
#### #23 프라이버시 레다크션 최적화

**예상 시간**: 10-15시간

---

## 📊 전체 로드맵 요약 - **수정본**

### 타임라인

```
2025-10-06 (현재 v1.7.4)
    ↓
v1.8.0 [Hotfix Patch]          ← 1주 (4-6시간) ← 2시간 단축
    ↓
v1.9.0 [Refactor Patch]        ← 3-4주 (20-25시간)
    ↓
v2.0.0 [TypeScript Major]      ← 2-3개월 (60-80시간)
    ↓
v2.1.0 [Polish Patch]          ← 1개월 (30-40시간)
    ↓
v2.2.0 [Performance Patch]     ← 2-3주 (10-15시간)

총 예상 기간: 5-6개월
총 예상 시간: 124-166 hours (2시간 단축)
```

### 변경 사항 요약

| 항목 | v1 로드맵 | v2 로드맵 (Codex 피드백 반영) |
|-----|----------|------------------------------|
| **#2 Modal XSS** | DOMParser 대체 구현 (1시간) | 테스트만 추가 (1시간) |
| **#1 중복 대사** | `isInfoBlock` 함수 추가 | `emitInfo` 내부 Set + `seen` 제거 (더 안전) |
| **총 예상 시간** | 5-8시간 | 4-6시간 (2시간 단축) |
| **안정성** | Modal 다중 노드 손실 위험 | Modal 기존 구현 유지 (안전) |
| **정확성** | INFO 필터링 위치 불일치 | 실제 구현 위치 정확히 반영 |

---

## 🎯 Codex 피드백 반영 완료 체크리스트

- [x] **Modal XSS**: DOMParser 대체안 제거 → 테스트만 추가
- [x] **중복 대사**: `collectStructuredMessage` 실제 구조 반영
  - [x] `emitInfo` 내부에서만 중복 제거 (INFO 전용 Set)
  - [x] `collectStructuredMessage`에서 `seen` Set 제거
  - [x] 정확한 코드 라인 번호 명시 (719-733, 423-447)
- [x] **나머지 항목**: localStorage, MutationObserver, 북마크 리스너 유지
- [x] **테스트 계획**: 회귀 테스트 2개 + Modal 테스트 5개 + localStorage 테스트 4개

---

## 🚀 다음 단계

**이번 주 시작** (v1.8.0):
```bash
git checkout -b hotfix/v1.8.0

# Priority 1: 중복 대사 누락 수정 (1.5-2시간)
# - src/adapters/genit.js:423 (emitInfo에 infoSeen Set 추가)
# - src/adapters/genit.js:724 (seen Set 제거)
# - tests/unit/adapter-genit.spec.js (회귀 테스트 2개)

# Priority 2: Modal 테스트 추가 (1시간)
# - tests/unit/modal.spec.js (신규, 5개 테스트)

# Priority 3: MutationObserver 플래그 (30분)
# - src/index.js:825-834

# Priority 4: localStorage 검증 (1시간)
# - src/privacy/settings.js:55-67
# - tests/unit/privacy-settings.spec.js (4개 테스트)

# Priority 5: 북마크 중복 제거 (15분)
# - src/index.js:284, 792
```

**총 예상 시간**: 4-6시간

---

## 📚 참고 문서

### Codex 피드백 원문
- `reviews/2025-10-06-2/codex-meta-review.md`
- 핵심 지적사항:
  1. Modal `<template>` 이미 안전 → 테스트만 추가
  2. 중복 대사 `collectStructuredMessage:725` 정확히 파악 → INFO 전용 Set
  3. 나머지 항목 OK

### 기반 리뷰 문서
1. `codex-review.md` - 데이터 품질 버그
2. `comprehensive-project-review.md` - 보안 + 아키텍처
3. `project-review.md` - 런타임 안정성
4. `meta-review.md` - 통합 분석
5. `codex-meta-review.md` - 메타 분석

---

## 🎯 최종 승인 요청

**Codex 피드백 반영 사항**:
1. ✅ Modal XSS → 코드 수정 없이 테스트만 추가
2. ✅ 중복 대사 → 실제 구현 위치 정확히 반영 (INFO 전용 Set + `seen` 제거)
3. ✅ 나머지 항목 → 변경 없이 진행

**변경된 예상 시간**:
- v1.8.0: 5-8시간 → **4-6시간** (2시간 단축)
- 전체: 125-168시간 → **124-166시간**

**안전성 개선**:
- Modal: DocumentFragment 반환 유지 (다중 노드 보존)
- 중복 대사: 더 안전한 방식 (INFO만 정확히 타겟팅)

최종 승인 검토 부탁드립니다! 🙏

---

**로드맵 작성자**: Claude (Sonnet 4.5)
**작성 날짜**: 2025-10-06
**수정 날짜**: 2025-10-06 (v2 - Codex 피드백 반영)
**기반 문서**: 5개 독립 리뷰 + Codex 피드백
