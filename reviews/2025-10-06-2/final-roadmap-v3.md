# 🗺️ Genit Memory Helper 최종 개선 로드맵 (v3 - Codex 피드백 최종 반영)
**작성일**: 2025-10-06
**수정일**: 2025-10-06 (Codex 피드백 2차 반영)
**기반 문서**: 5개 독립 리뷰 통합 분석 + Codex 피드백 (2회)

---

## 📝 Codex 피드백 2차 반영 사항

### 1. emitInfo 'INFO' 중복 문제 해결 ✅

**Codex 피드백**:
> `emitInfo` 재구성은 방향이 맞는데, 제안된 스니펫 그대로 적용하면 `infoSeen`에 'INFO'가 남아 `collector.push` 시 `lines/legacyLines`에 'INFO'가 두 번 포함됩니다. Set 대신 `infoLinesOut` 배열을 별도로 유지하거나, `lines: [...infoSeen].filter((line) => line !== 'INFO')`처럼 처리해서 기존 출력 형태(`lines`에는 본문만, `legacyLines`에는 `['INFO', ...본문]`)가 유지되도록 조정해 주세요.

**문제점**:
```javascript
// v2 로드맵 제안 (문제 있음)
const infoSeen = new Set();
const pushInfoLine = (line) => {
  // ...
  infoSeen.add(trimmed);  // 'INFO'도 Set에 추가됨
};
pushInfoLine('INFO');  // ⚠️ infoSeen에 'INFO' 포함

collector.push({
  lines: [...infoSeen],  // ⚠️ ['INFO', 'line1', 'line2'] - 잘못됨
  legacyLines: ['INFO', ...infoSeen],  // ⚠️ ['INFO', 'INFO', 'line1', 'line2'] - 중복!
});
```

**수정안 Option A** (배열 별도 유지 - 권장):
```javascript
// src/adapters/genit.js:423-447
const emitInfo = (block, pushLine, collector = null) => {
  const infoNode = firstMatch(selectors.infoCode, block);
  if (!infoNode) return;

  // INFO 본문만 저장할 배열
  const infoLinesOut = [];
  const infoSeen = new Set();

  pushLine('INFO');  // legacy 출력용

  const infoLines = textSegmentsFromNode(infoNode);
  infoLines.forEach((seg) => {
    const trimmed = (seg || '').trim();
    if (!trimmed) return;
    if (infoSeen.has(trimmed)) return;  // 중복 제거
    infoSeen.add(trimmed);
    infoLinesOut.push(trimmed);  // 본문만 배열에 추가
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
      lines: infoLinesOut,  // ✅ 본문만 (INFO 제외)
      legacyLines: ['INFO', ...infoLinesOut],  // ✅ ['INFO', ...본문]
      legacyFormat: 'meta',
    }, { node: infoCardWrapper });
  }
};
```

**수정안 Option B** (filter 사용):
```javascript
collector.push({
  type: 'info',
  flavor: 'meta',
  role: 'system',
  speaker: 'INFO',
  lines: [...infoSeen].filter((line) => line !== 'INFO'),  // INFO 제거
  legacyLines: ['INFO', ...[...infoSeen].filter((line) => line !== 'INFO')],
  legacyFormat: 'meta',
}, { node: infoCardWrapper });
```

**권장**: Option A (배열 별도 유지) - 더 명확하고 효율적

---

### 2. Modal 테스트 클래스 수정 ✅

**Codex 피드백**:
> `tests/unit/modal.spec.js` 예시에서 `.gmh-modal-body` 클래스를 찾고 있는데 실제 DOM 클래스는 `.gmh-modal__body`입니다. 검사 대상 선택자를 맞춰야 테스트가 통과합니다.

**실제 코드 확인** (`src/ui/modal.js:148`):
```javascript
const body = doc.createElement('div');
body.className = 'gmh-modal__body gmh-modal__body--scroll';  // ✅ BEM 스타일
```

**수정 전** (v2 로드맵):
```javascript
const modalContent = testDocument.querySelector('.gmh-modal-body');  // ❌ 잘못된 클래스
```

**수정 후**:
```javascript
const modalContent = testDocument.querySelector('.gmh-modal__body');  // ✅ 올바른 클래스
```

---

## 🚨 v1.8.0 - Hotfix Patch (긴급 수정) - 최종본

**목표**: 데이터 손실 방지 + 런타임 안정성 강화
**기간**: 1주 (4-6시간)
**릴리스 조건**: 모든 기존 테스트 통과 + 신규 회귀 테스트 3개 추가

### 포함 이슈

#### #1 중복 대사 누락 수정 (Codex 최우선) - **최종 수정**

**변경 1**: `emitInfo` 함수 재구성 (INFO 본문만 배열로 관리)
```javascript
// src/adapters/genit.js:423-447
const emitInfo = (block, pushLine, collector = null) => {
  const infoNode = firstMatch(selectors.infoCode, block);
  if (!infoNode) return;

  // INFO 본문만 저장할 배열 (중복 제거)
  const infoLinesOut = [];
  const infoSeen = new Set();

  pushLine('INFO');  // legacy 출력용 (localLines에만 추가)

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
      lines: infoLinesOut,  // ✅ ['line1', 'line2'] - 본문만
      legacyLines: ['INFO', ...infoLinesOut],  // ✅ ['INFO', 'line1', 'line2']
      legacyFormat: 'meta',
    }, { node: infoCardWrapper });
  }
};
```

**변경 2**: `collectStructuredMessage`에서 `seen` Set 제거 (변경 없음)
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

**검증**:
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

it('should deduplicate INFO lines correctly', () => {
  const block = createMockBlock([
    { role: 'info', text: '중요\n중요\n경고' },
  ]);
  const message = adapter.collectStructuredMessage(block);
  const infoPart = message.parts.find(p => p.type === 'info');

  // lines: 본문만 (중복 제거)
  expect(infoPart.lines).toEqual(['중요', '경고']);

  // legacyLines: ['INFO', ...본문]
  expect(infoPart.legacyLines).toEqual(['INFO', '중요', '경고']);
});

it('should not duplicate INFO header in lines', () => {
  const block = createMockBlock([
    { role: 'info', text: '내용1\n내용2' },
  ]);
  const message = adapter.collectStructuredMessage(block);
  const infoPart = message.parts.find(p => p.type === 'info');

  // lines에 'INFO' 포함 안 됨
  expect(infoPart.lines).not.toContain('INFO');
  expect(infoPart.lines).toEqual(['내용1', '내용2']);

  // legacyLines에만 'INFO' 포함
  expect(infoPart.legacyLines[0]).toBe('INFO');
  expect(infoPart.legacyLines).toEqual(['INFO', '내용1', '내용2']);
});
```

**예상 시간**: 1.5-2시간

---

#### #2 Modal 안전성 테스트 추가 - **최종 수정**
**파일**: `tests/unit/modal.spec.js` (신규)

```javascript
// tests/unit/modal.spec.js
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

    // Modal이 렌더링될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 50));

    const modalContent = testDocument.querySelector('.gmh-modal__body');  // ✅ 수정됨
    expect(modalContent.innerHTML).not.toContain('<script');
    expect(modalContent.innerHTML).toContain('Safe');

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

    const img = testDocument.querySelector('.gmh-modal__body img');  // ✅ 수정됨
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

    const link = testDocument.querySelector('.gmh-modal__body a');  // ✅ 수정됨
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

    const modalBody = testDocument.querySelector('.gmh-modal__body');  // ✅ 수정됨
    expect(modalBody.querySelector('p')).toBeTruthy();
    expect(modalBody.querySelector('strong')).toBeTruthy();
    expect(modalBody.querySelector('p').textContent).toBe('Paragraph');

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

    const modalBody = testDocument.querySelector('.gmh-modal__body');  // ✅ 수정됨
    const divs = Array.from(modalBody.children).filter(el => el.tagName === 'DIV');
    expect(divs.length).toBeGreaterThanOrEqual(3);  // 다중 노드 보존 확인
    expect(divs[0].textContent).toBe('First');
    expect(divs[1].textContent).toBe('Second');
    expect(divs[2].textContent).toBe('Third');

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

    const modalBody = testDocument.querySelector('.gmh-modal__body');  // ✅ 수정됨
    // iframe 자체가 제거되어야 함
    expect(modalBody.querySelector('iframe')).toBeNull();

    modal.close();
    await promise;
  });
});
```

**변경 사항**:
- ✅ `.gmh-modal-body` → `.gmh-modal__body` (모든 곳)
- ✅ BEM 네이밍 컨벤션 준수
- ✅ 추가 테스트: `srcdoc` 속성 제거 검증

**예상 시간**: 1시간

---

#### #3 MutationObserver 무한 재부팅 방지 - **변경 없음**
**파일**: `src/index.js:825-834`

(v2 로드맵과 동일)

**예상 시간**: 30분

---

#### #4 localStorage 검증 추가 - **변경 없음**
**파일**: `src/privacy/settings.js:55-67`

(v2 로드맵과 동일)

**예상 시간**: 1시간

---

#### #5 북마크 리스너 중복 start() 제거 - **변경 없음**
**파일**: `src/index.js:284, 792`

(v2 로드맵과 동일)

**예상 시간**: 15분

---

### v1.8.0 체크리스트 - **최종본**

- [ ] #1 중복 대사 수정
  - [ ] `emitInfo` 재구성: `infoLinesOut` 배열 별도 관리
  - [ ] `collectStructuredMessage`: `seen` Set 제거
  - [ ] 회귀 테스트 3개 추가 (연속 대사, INFO 중복 제거, INFO 헤더 중복 방지)
- [ ] #2 Modal 안전성 테스트
  - [ ] 클래스 선택자 수정 (`.gmh-modal__body`)
  - [ ] 테스트 6개 추가 (script, onerror, javascript:, safe HTML, 다중 노드, srcdoc)
- [ ] #3 MutationObserver 플래그 추가
- [ ] #4 localStorage 검증 + 테스트 4개
- [ ] #5 북마크 리스너 중복 제거
- [ ] 전체 테스트 스위트 통과 (`npm test`)
- [ ] Smoke 테스트 통과 (`npm run test:smoke`)
- [ ] CHANGELOG.md 업데이트
- [ ] Git tag `v1.8.0` 생성 + push

**예상 시간**: 4-6시간

**롤백 계획**: Git tag `v1.7.4`로 revert

---

## 🔧 v1.9.0 - Refactor Patch (아키텍처 개선)

**변경 없음** - v2 로드맵 유지

---

## 🚀 v2.0.0 - TypeScript Major (대규모 전환)

**변경 없음** - v2 로드맵 유지

---

## 🎨 v2.1.0 - Polish Patch (품질 향상)

**변경 없음** - v2 로드맵 유지

---

## ⚡ v2.2.0 - Performance Patch (성능 최적화)

**변경 없음** - v2 로드맵 유지

---

## 📊 Codex 피드백 2차 반영 완료

### 변경 사항 요약

| 항목 | v2 로드맵 (1차 피드백) | v3 로드맵 (2차 피드백 반영) |
|-----|----------------------|--------------------------|
| **emitInfo 'INFO' 중복** | `infoSeen` Set 직접 사용 | `infoLinesOut` 배열 별도 관리 |
| **collector.push lines** | `[...infoSeen]` (INFO 포함) | `infoLinesOut` (본문만) |
| **collector.push legacyLines** | `['INFO', ...infoSeen]` (중복) | `['INFO', ...infoLinesOut]` (정상) |
| **Modal 테스트 선택자** | `.gmh-modal-body` (잘못됨) | `.gmh-modal__body` (정확) |
| **테스트 통과 여부** | ❌ 실패 예상 | ✅ 통과 예상 |

### 기대 출력 형태 (수정 후)

```javascript
// INFO 파트 출력 예시
{
  type: 'info',
  speaker: 'INFO',
  lines: ['내용1', '내용2'],  // ✅ 본문만, 중복 제거
  legacyLines: ['INFO', '내용1', '내용2'],  // ✅ 헤더 + 본문, 중복 없음
}

// 동일 내용 입력 시
// 입력: '중요\n중요\n경고'
// lines: ['중요', '경고']  // ✅ 중복 '중요' 제거
// legacyLines: ['INFO', '중요', '경고']  // ✅ 정상
```

---

## 🎯 최종 승인 체크리스트

**Codex 피드백 2차 반영**:
- [x] ✅ emitInfo 'INFO' 중복 문제 해결
  - [x] `infoLinesOut` 배열 별도 관리
  - [x] `lines`에는 본문만 포함
  - [x] `legacyLines`에는 `['INFO', ...본문]` 형태 유지
  - [x] 회귀 테스트 추가 (INFO 헤더 중복 방지 검증)
- [x] ✅ Modal 테스트 클래스 수정
  - [x] `.gmh-modal-body` → `.gmh-modal__body`
  - [x] BEM 네이밍 준수
  - [x] 모든 테스트 케이스에 반영

**안정성**:
- ✅ 기존 출력 형태 완벽 유지 (`lines` vs `legacyLines`)
- ✅ 중복 제거 로직 INFO 파트에만 적용
- ✅ 일반 대사 중복 허용 (데이터 손실 없음)
- ✅ 테스트 선택자 실제 DOM 구조와 일치

**예상 시간**:
- v1.8.0: 4-6시간 (변경 없음)
- 전체: 124-166시간 (변경 없음)

---

## 🚀 다음 단계 (v1.8.0)

**이번 주 시작**:
```bash
git checkout -b hotfix/v1.8.0

# 1. 중복 대사 수정 (1.5-2h)
#    ✅ emitInfo: infoLinesOut 배열 추가
#    ✅ collectStructuredMessage: seen 제거
#    ✅ 회귀 테스트 3개 (연속 대사, INFO 중복, INFO 헤더)

# 2. Modal 테스트 (1h)
#    ✅ .gmh-modal__body 선택자 사용
#    ✅ 테스트 6개 추가

# 3. MutationObserver (30m)
# 4. localStorage (1h)
# 5. 북마크 (15m)
```

**총 시간**: 4-6시간

---

## 📚 Codex 피드백 히스토리

### 1차 피드백 (반영 완료)
1. ✅ Modal XSS → 테스트만 추가
2. ✅ 중복 대사 → `collectStructuredMessage:725` 정확히 파악
3. ✅ 나머지 항목 OK

### 2차 피드백 (반영 완료)
1. ✅ emitInfo 'INFO' 중복 → `infoLinesOut` 배열 별도 관리
2. ✅ Modal 테스트 선택자 → `.gmh-modal__body` 수정

---

**최종 승인 준비 완료!** 🙏

---

**로드맵 작성자**: Claude (Sonnet 4.5)
**작성 날짜**: 2025-10-06
**최종 수정**: 2025-10-06 (v3 - Codex 피드백 2차 반영)
**기반 문서**: 5개 독립 리뷰 + Codex 피드백 (2회)
