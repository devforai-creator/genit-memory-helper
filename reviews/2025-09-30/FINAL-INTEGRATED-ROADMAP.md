# 🗺️ Genit Memory Helper 통합 실행 로드맵 (최종안)

**작성**: Claude (Gemini, Codex 메타-리뷰 통합)
**날짜**: 2025-09-30
**승인 대기**: Codex, Gemini, 사용자

---

## 📋 Executive Summary

3개 AI 에이전트(Gemini, Codex, Claude)의 리뷰와 메타-리뷰를 통합한 최종 실행 로드맵입니다.

### 핵심 합의사항

| 에이전트 | 주요 기여 | 최우선 과제 |
|---------|---------|-----------|
| **Codex** | 2개 CRITICAL 버그 발견 (데이터 손실) | Markdown 펜스, 중복 라인 |
| **Claude** | 5개 영역 종합 분석, 단계별 로드맵 | 성능 병목 (자동 로더) |
| **Gemini** | 전략적 방향, 문서화 생태계 | .env, TypeScript 비전 |

### 우선순위 원칙

1. **데이터 무결성** > 보안 > 성능 > 품질 > 비전
2. **사용자 직접 경험 이슈** 우선 (Codex 버그)
3. **검증된 문제만 포함** (과장된 이슈 제외)
4. **실행 가능성** (구체적 파일명, 작업량, 영향도)

---

## 🚨 Phase 0: 긴급 버그 수정 (Week 0 - 이번 주)

**목표**: 사용자 데이터 손실 및 기능 오류 즉시 해결
**총 작업량**: ~5시간
**담당**: 긴급

### 작업 목록

#### 1. ✅ Markdown 코드 펜스 렌더링 버그 수정 [30분] 🔴

**발견자**: Codex
**파일**: `src/export/writers-structured.js:28`
**현상**:
```javascript
out.push(`\u0060\u0060\u0060${language}`);  // ← \u0060\u0060\u0060js 로 출력됨
```
**출력 예시**:
```
\u0060\u0060\u0060javascript
console.log("test");
```
(코드 블록이 렌더링 안 됨)

**수정**:
```javascript
out.push('```' + language);  // 실제 백틱 사용
```

**영향**: 사용자 직접 체감, 내보낸 Markdown 파일 품질
**검증**:
```bash
npm run build
# 수동 테스트: 코드 블록 포함 대화 내보내기 → Markdown 뷰어에서 렌더링 확인
```

---

#### 2. ✅ 중복 라인 제거 버그 수정 [2시간] 🔴

**발견자**: Codex
**파일**: `src/features/snapshot.js:112-161`
**현상**:
```javascript
const seenLine = new Set();  // 전역 추적
// ...
if (!trimmed || seenLine.has(trimmed)) return;  // ← 반복 대사 누락
```

**예시**:
- 턴 1: "안녕하세요" → 포함됨
- 턴 5: "안녕하세요" → 누락됨 ❌

**수정 방안 (Codex 제안)**:
```javascript
// Option A: 블록별 중복 제거 (기존 localSeen 활용)
// Option B: (originIndex, text) 튜플로 키 생성
const seenLine = new Set();
turns.forEach((turn, idx) => {
  const key = `${idx}:${trimmed}`;  // 인덱스 포함
  if (!seenLine.has(key)) {
    // ... 추가
  }
});
```

**영향**: 데이터 무결성, 범위 계산 정확도, entryOrigin 일치
**검증**:
```bash
# 1. 수정
# 2. 테스트 추가 (아래 Task 3 참고)
# 3. 기존 tests/unit/export-range.spec.js 실행
npm test
```

---

#### 3. ✅ 회귀 테스트 추가 [2시간] 🟠

**발견자**: Codex 제안

**3-1. Markdown 코드 블록 테스트**
**파일**: `tests/unit/structured-export.spec.js` (확장)
```javascript
describe('Structured Markdown code blocks', () => {
  it('should render code fences with actual backticks', () => {
    const session = {
      turns: [{
        role: 'assistant',
        parts: [{
          type: 'code',
          language: 'javascript',
          text: 'console.log("test");'
        }]
      }]
    };
    const result = toStructuredMarkdown(session);

    // 백틱이 실제로 포함되어야 함
    expect(result).toContain('```javascript');
    expect(result).not.toContain('\\u0060');
  });
});
```

**3-2. 중복 라인 보존 테스트**
**파일**: `tests/unit/structured-snapshot.spec.js` (신규)
```javascript
import { createStructuredSnapshotReader } from '../../src/features/snapshot.js';
import { createGenitAdapter } from '../../src/adapters/genit.js';

describe('Structured snapshot duplicate line handling', () => {
  it('should preserve identical lines from different messages', () => {
    // Setup: 어댑터와 스냅샷 리더 생성
    const adapter = createGenitAdapter({ /* deps */ });
    const getActiveAdapter = () => adapter;
    const reader = createStructuredSnapshotReader({
      getActiveAdapter,
      documentRef: document,
    });

    // Mock: 2개 메시지 블록이 모두 "안녕하세요" 포함하는 DOM 준비
    // (테스트 픽스처 필요)

    // Execute: 스냅샷 캡처
    const snapshot = reader.captureStructuredSnapshot();

    // Verify: legacyLines에 두 "안녕하세요" 모두 포함되어야 함
    const greetings = snapshot.legacyLines.filter(line => line.includes('안녕하세요'));
    expect(greetings.length).toBeGreaterThanOrEqual(2);

    // entryOrigin도 두 항목 모두 존재해야 함
    expect(snapshot.entryOrigin.length).toBe(snapshot.legacyLines.length);

    // messages 배열에도 두 메시지 모두 있어야 함
    expect(snapshot.messages.length).toBeGreaterThanOrEqual(2);
  });
});
```

**영향**: 회귀 방지, CI/CD 안정성

---

#### 4. ✅ Modal 새니타이저 검증 테스트 추가 [30분] 🟢

**발견자**: Claude (과장 인정했지만 테스트는 필요)
**파일**: `tests/unit/modal.spec.js` (신규)

**배경**:
- Codex 지적: template 메커니즘으로 이미 안전함
- 하지만 명시적 테스트 없음 → 리팩터링 시 실수 가능

**테스트**:
```javascript
describe('Modal sanitization', () => {
  it('should remove script tags from template content', () => {
    const modal = createModal({ documentRef: document, windowRef: window });
    const malicious = '<div>Hello <script>alert("xss")</script></div>';

    // sanitizeMarkupFragment는 내부 함수이므로 간접 테스트
    // open 시 content에 script 포함 안 되어야 함
    modal.open({
      content: malicious,
      actions: [{ label: 'OK', value: true }]
    });

    const modalBody = document.querySelector('.gmh-modal__body');
    expect(modalBody.innerHTML).not.toContain('<script>');
  });
});
```

**영향**: 향후 리팩터링 안전성

---

### Phase 0 완료 기준

```bash
# 1. 코드 수정 완료
# 2. 모든 기존 테스트 통과
npm run build
npm test

# 3. 스모크 테스트 통과
npm run test:smoke

# 4. 수동 검증
# - Structured Markdown 내보내기 → 코드 블록 렌더링 확인
# - 동일한 인사말 반복하는 대화 내보내기 → 모든 턴 포함 확인

# 5. 릴리스 (유지보수자 전용 - AI 에이전트는 실행 금지)
# npm run bump:patch  # v1.6.3
# Changelog:
# - Fix: Markdown code fence rendering (Codex)
# - Fix: Duplicate line deduplication (Codex)
# - Test: Add regression tests for export accuracy
```

**예상 소요**: 1일 (집중 작업 시) ~ 2일 (여유 있게)

---

## 🔧 Phase 1: 성능 & 안정성 개선 (Week 1)

**목표**: 검증된 성능 병목 해결 및 데이터 검증 강화
**총 작업량**: ~6시간

### 작업 목록

#### 1. ✅ 자동 로더 성능 최적화 (캐싱) [2시간] 🔴

**발견자**: Claude (Codex/Gemini도 동의)
**파일**: `src/features/auto-loader.js:149-196`
**현상**: `collectTurnStats()`가 매 스크롤 사이클마다 전체 DOM 파싱

**수정**:
```javascript
// auto-loader.js 상단에 캐시 추가
let statsCache = { data: null, turnCount: 0 };

function collectTurnStats() {
  try {
    // 기존 파싱 로직 (실제 코드 149-196줄)
    messageIndexer?.refresh?.({ immediate: true });
    const raw = readTranscriptText();
    const normalized = normalizeTranscript(raw);
    const session = buildSession(normalized);

    // 턴 수가 변하지 않으면 캐시 반환
    const currentTurnCount = session.turns.length;
    if (statsCache.turnCount === currentTurnCount && statsCache.data) {
      return statsCache.data;
    }

    // 통계 계산
    const userMessages = session.turns.filter((t) => t.channel === 'user').length;
    const llmMessages = session.turns.filter((t) => t.channel === 'llm').length;

    // exportRange 업데이트 로직 (기존 코드 유지)
    // ...

    const stats = {
      session,
      userMessages,
      llmMessages,
      totalMessages: session.turns.length,
    };

    // 캐시 업데이트
    statsCache = { data: stats, turnCount: currentTurnCount };
    return stats;
  } catch (error) {
    return {
      session: null,
      userMessages: 0,
      llmMessages: 0,
      totalMessages: 0,
      error,
    };
  }
}
```

**영향**: 자동 로드 속도 3-5배 향상 (2.6분 → ~50초 추정)
**검증**:
```bash
# 스모크 테스트 실행 시간 측정
time npm run test:smoke  # 개선 전후 비교
```

---

#### 2. ✅ Tree-shaking 활성화 [1시간] 🟠

**발견자**: Claude
**파일**: `rollup.config.js:35`

**수정**:
```javascript
export default {
  // ...
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
  },
};
```

**영향**: 번들 크기 10-20% 감소 (~320KB → ~270KB 추정)
**검증**:
```bash
npm run build
ls -lh genit-memory-helper.user.js  # 파일 크기 확인
npm test  # 기능 정상 동작 확인
```

**주의**: 사이드 이펙트 있는 모듈 확인 필요 (있을 경우 moduleSideEffects 조정)

---

#### 3. ✅ localStorage 길이 제한 추가 (DoS 방지) [1시간] 🟠

**발견자**: Claude (Codex도 필요성 인정)
**파일**: `src/privacy/settings.js:55-80`

**수정**:
```javascript
const validateList = (items) => {
  if (!Array.isArray(items)) return false;
  if (items.length > 1000) {  // 최대 1000개 항목
    console.warn('[GMH] Privacy list too large, truncating');
    return false;
  }
  return items.every(item =>
    typeof item === 'string' && item.length < 200  // 항목당 200자
  );
};

const load = () => {
  // ... 기존 코드
  const parsed = JSON.parse(rawBlacklist);
  if (!validateList(parsed)) {
    console.warn('[GMH] Invalid blacklist, resetting');
    blacklist = [];
    return;
  }
  blacklist = parsed;
};
```

**영향**: DoS 공격 방어, 성능 저하 방지
**검증**:
```bash
# 개발자 콘솔에서 테스트
localStorage.setItem('gmh_privacy_blacklist', JSON.stringify(Array(2000).fill('test')));
// 경고 메시지 출력 + 초기화 확인
```

---

#### 4. ✅ .env.example 추가 [30분] 🟢

**발견자**: Gemini
**파일**: `.env.example` (신규)

**내용**:
```bash
# Genit Memory Helper - Test Environment Variables
# Copy this file to .env and fill in your test credentials

# Required for smoke tests (npm run test:smoke)
GENIT_TEST_URL=https://genit.ai/c/your-test-conversation-id
GENIT_USER=your-test-email@example.com
GENIT_PASS=your-test-password

# Optional: Public demo URL (no login required)
GENIT_DEMO_URL=https://genit.ai/demo

# Optional: Custom login selectors (if defaults don't work)
# GENIT_LOGIN_EMAIL_SELECTOR=input[type="email"]
# GENIT_LOGIN_PASSWORD_SELECTOR=input[type="password"]
# GENIT_LOGIN_SUBMIT_SELECTOR=button[type="submit"]
```

**추가 작업**: `README.md`에 환경 변수 설정 섹션 추가

**영향**: 신규 기여자 온보딩 시간 단축

---

#### 5. ✅ 에러 핸들링 표준화 [1시간] 🟠

**발견자**: Claude
**현상**: 8개 위치에서 직접 `console.warn/error` 사용

**수정**:
```bash
# 발견
grep -rn "console\.(warn|error)" src/ --include="*.js"

# 각 위치를 ErrorHandler로 교체
# Before:
console.warn('[GMH] failed to load', err);

# After:
errorHandler.handle(err, 'module/action', ERROR_LEVELS.WARN);
```

**파일**: `src/index.js`, `src/adapters/genit.js` 등

**영향**: 일관된 에러 로깅, 중앙화된 추적

---

### Phase 1 완료 기준

```bash
npm run build
npm test
npm run test:smoke

# 성능 측정
# - 자동 로드 시간 (수동 측정)
# - 번들 크기 (ls -lh)

# 릴리스 (선택)
# v1.7.0 - Performance improvements
# - Perf: Cache turn stats in auto-loader (3-5x faster)
# - Perf: Enable tree-shaking (15% smaller bundle)
# - Security: Add localStorage size limits
# - DX: Add .env.example for test setup
# - Refactor: Standardize error handling
```

---

## 📚 Phase 2: 문서화 & 코드 품질 (Week 2-3)

**목표**: 개발자 경험 개선, 유지보수성 향상
**총 작업량**: ~10시간

### 작업 목록

#### 1. ✅ JSDoc 추가 (상위 20개 API) [3시간] 🟠

**발견자**: Claude + Gemini 공통 제안

**대상 함수**:
1. `createShareWorkflow` (src/features/share.js)
2. `createAutoLoader` (src/features/auto-loader.js)
3. `createPrivacyPipeline` (src/privacy/pipeline.js)
4. `createExportRange` (src/core/export-range.js)
5. `applyPrivacyPipeline` (src/privacy/pipeline.js)
6. `buildSession` (src/export/parsers.js)
7. `normalizeTranscript` (src/export/parsers.js)
8. `parseTurns` (src/export/parsers.js)
9. `toStructuredMarkdown` (src/export/writers-structured.js)
10. `createGenitAdapter` (src/adapters/genit.js)
11. (나머지 10개)

**예시**:
```javascript
/**
 * Creates a share workflow coordinator for privacy-aware export operations.
 *
 * @param {Object} deps - Dependency injection container
 * @param {() => StructuredSnapshot} deps.captureStructuredSnapshot - Captures current DOM state
 * @param {(raw: string) => string} deps.normalizeTranscript - Normalizes text transcripts
 * @param {(text: string) => Session} deps.buildSession - Builds session object from transcript
 * @param {ExportRange} deps.exportRange - Range calculator for message selection
 * @param {Object} deps.privacyConfig - Active privacy configuration
 * @param {Object} deps.clipboard - Clipboard API wrapper (GM_setClipboard or fallback)
 * @returns {ShareWorkflowAPI} Workflow control methods (prepareShare, copyPrompt, etc.)
 *
 * @example
 * const workflow = createShareWorkflow({
 *   captureStructuredSnapshot: adapter.captureSnapshot,
 *   normalizeTranscript: (raw) => raw.replace(/\r\n/g, '\n'),
 *   // ... other dependencies
 * });
 *
 * const result = await workflow.prepareShare({
 *   format: 'json',
 *   range: 'all'
 * });
 */
export function createShareWorkflow(deps) { ... }
```

**영향**: IDE 자동완성, 타입 힌트, 기여자 온보딩
**검증**: VSCode에서 함수 호버 시 문서 표시 확인

---

#### 2. ✅ 매직 넘버 → config.js 추출 [1시간] 🟢

**발견자**: Claude

**신규 파일**: `src/config.js`
```javascript
export const CONFIG = {
  TIMING: {
    BOOT_DELAY_MS: 1200,        // DOM 안정화 대기
    AUTO_LOAD_CYCLE_MS: 700,    // API 부하 균형
    SETTLE_TIMEOUT_MS: 2000,    // 스크롤 안정 대기
    ERROR_DEBOUNCE_MS: 500,     // 에러 핸들러 디바운스
  },
  LIMITS: {
    DOM_TRAVERSAL_MAX: 400,     // 무한 루프 방지
    ERROR_LOG_MAX: 100,         // 에러 로그 크기
    PRIVACY_LIST_MAX: 1000,     // 프라이버시 목록 최대
    PRIVACY_ITEM_MAX: 200,      // 항목당 최대 길이
  },
  UI: {
    MIN_GAP_PX: 12,             // 패널 최소 간격
    PANEL_Z_INDEX: 999999,      // 패널 z-index
  },
};
```

**수정 파일**: `src/index.js`, `src/features/auto-loader.js`, `src/privacy/settings.js` 등

**영향**: 설정 중앙화, 가독성 향상

---

#### 3. ✅ 모듈별 헤더 코멘트 추가 [4시간] 🟠

**발견자**: Claude

**예시** (src/features/share.js 상단):
```javascript
/**
 * @module features/share
 * @description
 * Share workflow coordinator for privacy-aware export operations.
 *
 * This module orchestrates the complete export process:
 * 1. Capture structured snapshot from DOM
 * 2. Apply privacy redaction based on active profile
 * 3. Show privacy gate confirmation to user
 * 4. Generate export in requested format (JSON/MD/TXT)
 * 5. Trigger download or copy to clipboard
 *
 * @requires core/export-range - Range selection logic
 * @requires privacy/pipeline - Redaction pipeline
 * @requires ui/privacy-gate - User confirmation modal
 * @requires export/writers-* - Format converters
 */
```

**대상**: 46개 파일 전체 (우선순위: core > features > ui > adapters)

**영향**: 코드베이스 탐색 용이, 의존성 이해

---

#### 4. ✅ docs/role-classification-heuristics.md 업데이트 [30분] 🟢

**발견자**: Codex
**현상**: 문서의 PLAYER_MARK 상수가 실제 코드와 불일치

**수정**:
```markdown
# Before (문서)
PLAYER_MARK = '⟦Player⟧'

# After (실제 코드 반영)
PLAYER_MARK = '⟦PLAYER⟧ '  # 대문자 + 후행 공백
```

**영향**: 트러블슈팅 정확도

---

#### 5. ✅ AGENTS.md 업데이트 [1시간] 🟢

**발견자**: Gemini

**추가 섹션**:
```markdown
## AI 에이전트 협업 프로세스

### 다중 리뷰 워크플로우

이 프로젝트는 여러 AI 에이전트의 상호 보완적 리뷰를 활용합니다:

1. **Gemini**: 전략 기획 (장기 비전, 문서화 생태계)
2. **Claude**: 시스템 분석 (보안/성능/품질 종합)
3. **Codex**: 코드 감사 (버그 발견, 정확성 검증)

### 메타-리뷰 프로세스

각 에이전트는:
- 독립적으로 초기 리뷰 작성
- 다른 에이전트의 리뷰를 분석 (메타-리뷰)
- 발견 사항을 통합하여 최종 로드맵 도출

### 리뷰 산출물 위치

- `reviews/GEMINI_review.md` - Gemini 초기 리뷰
- `reviews/codex-review-*.md` - Codex 버그 리포트
- `reviews/claude-comprehensive-review.md` - Claude 종합 분석
- `reviews/*-meta-review.md` - 각 에이전트의 메타-리뷰
- `reviews/FINAL-INTEGRATED-ROADMAP.md` - 통합 로드맵
```

**영향**: AI 협업 프로세스 문서화, 재현 가능한 품질 관리

---

### Phase 2 완료 기준

```bash
# 1. JSDoc 커버리지 확인
# (도구 없으므로 수동 확인: 상위 20개 API 완료)

# 2. 문서 검증
# - AGENTS.md 읽어보기
# - docs/role-classification-heuristics.md 확인

# 3. 빌드 & 테스트
npm run build
npm test

# 릴리스 (선택)
# v1.8.0 - Documentation improvements
# - Docs: Add JSDoc to top 20 APIs
# - Docs: Centralize config constants
# - Docs: Add module-level comments
# - Docs: Update AGENTS.md with multi-agent workflow
# - Fix: Correct PLAYER_MARK in docs
```

---

## 🏗️ Phase 3: 아키텍처 리팩터링 (Week 4-6)

**목표**: 유지보수성 극대화, 복잡도 감소
**총 작업량**: ~20시간

### 작업 목록

#### 1. ✅ index.js 분리 [8시간] 🟠

**발견자**: Claude + Gemini 공통 제안
**현상**: index.js 912줄 (77개 import)

**목표**: index.js < 200줄

**신규 디렉토리**: `src/composition/`
```
src/composition/
├── adapter-composition.js   # 어댑터 설정 (126-200줄 이동)
├── privacy-composition.js   # 프라이버시 파이프라인 조립 (369-433줄)
├── ui-composition.js        # UI 와이어링 (640-692줄)
└── share-composition.js     # Share 워크플로우 조립 (580-614줄)
```

**예시** (adapter-composition.js):
```javascript
import { createGenitAdapter } from '../adapters/genit.js';
import { registerAdapterConfig } from '../adapters/registry.js';

export function composeAdapters({ registry, playerMark, getPlayerNames }) {
  // 기존 index.js 126-200줄 로직 이동
  registerAdapterConfig('genit', { /* ... */ });
  const genitAdapter = createGenitAdapter({ registry, playerMark, getPlayerNames });
  return { genitAdapter };
}
```

**수정된 index.js**:
```javascript
import { composeAdapters } from './composition/adapter-composition.js';
import { composePrivacy } from './composition/privacy-composition.js';
import { composeUI } from './composition/ui-composition.js';
import { composeShare } from './composition/share-composition.js';

// ... 부팅 로직만 유지 (~150줄)
```

**영향**: 모듈 재사용 가능, 테스트 용이, 가독성 향상
**검증**:
```bash
npm run build
npm test
npm run test:smoke
```

---

#### 2. ✅ share.js 의존성 그룹화 [2시간] 🟢

**발견자**: Claude
**현상**: 28개 파라미터

**목표**: <10개 파라미터

**수정**:
```javascript
// Before
export function createShareWorkflow({
  captureStructuredSnapshot,
  normalizeTranscript,
  buildSession,
  // ... 25개 더
}) { }

// After
export function createShareWorkflow({
  exportContext: {
    toJSON, toMD, toTXT, toStructuredJSON, toStructuredMarkdown,
    buildExportBundle, buildExportManifest
  },
  privacyContext: {
    applyPrivacyPipeline, privacyConfig, privacyProfiles, formatRedactionCounts
  },
  stateContext: {
    stateApi, stateEnum, setPanelStatus
  },
  parserContext: {
    captureStructuredSnapshot, normalizeTranscript, buildSession,
    getEntryOrigin, collectSessionStats
  },
  uiContext: {
    confirmPrivacyGate, triggerDownload, clipboard, alert
  },
  exportRange,
  logger
}) { }
```

**영향**: 코드 가독성, 관련 기능 그룹핑

---

#### 3. ✅ 검증 헬퍼 통합 [1시간] 🟢

**발견자**: Claude

**신규 파일**: `src/utils/validation.js` (확장)
```javascript
/**
 * Validates factory dependencies and throws descriptive errors.
 *
 * @param {Object} deps - Dependency object
 * @param {Object.<string, (value: any) => boolean>} requirements - Validators
 * @throws {Error} When dependency is missing or invalid
 *
 * @example
 * requireDeps(deps, {
 *   captureSnapshot: (v) => typeof v === 'function',
 *   exportRange: (v) => v && typeof v.getRange === 'function',
 * });
 */
export function requireDeps(deps, requirements) {
  for (const [name, validator] of Object.entries(requirements)) {
    if (!validator(deps[name])) {
      throw new Error(`[GMH] Missing or invalid dependency: ${name}`);
    }
  }
}
```

**사용 예시** (share.js):
```javascript
import { requireDeps } from '../utils/validation.js';

export function createShareWorkflow(deps) {
  requireDeps(deps, {
    'exportContext.toJSON': (v) => typeof v === 'function',
    'privacyContext.applyPrivacyPipeline': (v) => typeof v === 'function',
    // ...
  });

  // 기존 로직
}
```

**영향**: 중복 검증 코드 제거 (~200줄 절약), 일관된 에러 메시지

---

#### 4. ✅ Clone 로직 통합 [1시간] 🟢

**발견자**: Claude
**현상**: `cloneSession`, `cloneTurns`가 2개 파일에 중복

**수정**: `src/core/utils.js`로 이동 (이미 존재하는 파일)
```javascript
/**
 * Deep clones a session object, preserving all metadata.
 * @param {Session} session - Session to clone
 * @returns {Session} Cloned session
 */
export function cloneSession(session) {
  // ... 기존 로직
}

/**
 * Deep clones an array of turns.
 * @param {Turn[]} turns - Turns to clone
 * @returns {Turn[]} Cloned turns
 */
export function cloneTurns(turns) {
  // ... 기존 로직
}
```

**수정 파일**:
- `src/privacy/pipeline.js` → import from utils
- `src/index.js` → import from utils

**영향**: 단일 진실의 원천 (SoT) 강화

---

### Phase 3 완료 기준

```bash
npm run build
npm test

# 아키텍처 검증
# - src/composition/ 디렉토리 존재
# - src/index.js < 200줄
# - src/features/share.js 파라미터 < 10개

# 릴리스
# v1.9.0 - Architecture improvements
# - Refactor: Split index.js into composition modules
# - Refactor: Group share.js dependencies by context
# - Refactor: Consolidate validation helpers
# - Refactor: Unify clone utilities
```

---

## 🧪 Phase 4: 테스트 커버리지 확대 (Week 7-10)

**목표**: 70% 커버리지 달성, 회귀 방지
**총 작업량**: ~40시간

### 우선순위 테스트 목록

#### 1. ✅ share-workflow.spec.js [8시간] 🔴

**파일**: `tests/unit/share-workflow.spec.js` (신규)

**테스트 시나리오**:
```javascript
describe('Share Workflow Integration', () => {
  it('should complete full export workflow', async () => {
    // parse → redact → gate → download
  });

  it('should fallback to classic when structured fails', async () => {
    // structured export error → classic format
  });

  it('should block when minor sexual content detected', async () => {
    // hasMinorSexualContext → blocked: true
  });

  it('should cancel when user rejects privacy gate', async () => {
    // user clicks cancel → workflow stops
  });

  it('should handle empty session gracefully', async () => {
    // turns: [] → no errors
  });

  it('should apply range selection correctly', async () => {
    // range: {start: 5, end: 10} → only those turns
  });

  it('should generate manifest with correct statistics', async () => {
    // manifest.redactionCounts, .turnCount 검증
  });
});
```

**영향**: 핵심 기능 안정성 보장

---

#### 2. ✅ auto-loader.spec.js [8시간] 🔴

**파일**: `tests/unit/auto-loader.spec.js` (신규)

**테스트 시나리오**:
```javascript
describe('Auto-Loader', () => {
  it('should stop after maxStableRounds without growth', async () => {
    // 3 사이클 동안 높이 변화 없음 → 중지
  });

  it('should stop when guard limit reached', async () => {
    // maxCycles = 60 도달 → 중지
  });

  it('should handle container not found', async () => {
    // adapter.findContainer() → null → 에러 핸들링
  });

  it('should update export range totals correctly', async () => {
    // 자동 로드 후 exportRange.total 업데이트
  });

  it('should stop cleanly when stop() called mid-cycle', async () => {
    // 스크롤 중 stop() → 메모리 누수 없음
  });

  it('should collect turn stats without errors', async () => {
    // collectTurnStats() → 예외 없음
  });
});
```

---

#### 3. ✅ privacy-pipeline.spec.js [6시간] 🟠

**파일**: `tests/unit/privacy-pipeline.spec.js` (신규)

**테스트 시나리오**:
```javascript
describe('Privacy Pipeline', () => {
  it('should sanitize structured snapshots', () => {
    // structured.messages[].parts[] 리덕션
  });

  it('should handle null/undefined player names', () => {
    // playerNames: null → 에러 없음
  });

  it('should clone session without mutation', () => {
    // 원본 session 변경 없음
  });

  it('should redact metadata fields', () => {
    // session.meta.* 리덕션
  });

  it('should preserve legacyLines for INFO parts only', () => {
    // part.type === 'info' → legacyLines 유지
  });
});
```

---

#### 4. ✅ parsers.spec.js [8시간] 🟠

**파일**: `tests/unit/parsers.spec.js` (신규)

**테스트 시나리오**:
```javascript
describe('Transcript Parsers', () => {
  it('should parse player/npc dialogue', () => {
    // 기본 대화 파싱
  });

  it('should detect narration blocks', () => {
    // [내레이션] → role: 'narration'
  });

  it('should filter meta lines', () => {
    // INFO, actor stats 제외
  });

  it('should normalize speaker names', () => {
    // '플레이어: ' → '플레이어'
  });

  it('should handle empty transcript', () => {
    // '' → turns: []
  });

  it('should detect player from aliases', () => {
    // playerAliases 매칭
  });
});
```

---

#### 5. ✅ 테스트 인프라 개선 [5시간] 🟠

**5-1. vitest.config.js 생성**:
```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',  // 조립 로직만 (테스트 어려움)
        'src/composition/**',  // 조립 로직
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
```

**5-2. 테스트 헬퍼** (`tests/helpers/builders.js`):
```javascript
export const buildTurn = (overrides = {}) => ({
  role: 'player',
  speaker: '플레이어',
  text: 'Test message',
  channel: 'user',
  ...overrides,
});

export const buildSession = (overrides = {}) => ({
  meta: {},
  turns: [],
  warnings: [],
  source: 'genit-memory-helper',
  ...overrides,
});

export const buildStructuredMessage = (overrides = {}) => ({
  role: 'assistant',
  speaker: 'AI',
  parts: [{ type: 'speech', lines: ['Hello'] }],
  ...overrides,
});
```

**5-3. 픽스처 확장**:
```
tests/fixtures/
├── genit_sample.html (기존 - 3개 메시지)
├── genit_large.html (신규 - 100개 메시지)
├── genit_code_blocks.html (신규 - 코드 블록 포함)
└── genit_duplicate_lines.html (신규 - 반복 대사)
```

---

#### 6. ✅ 커버리지 CI 통합 [2시간] 🟢

**파일**: `.github/workflows/test.yml` (수정)

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - run: npm run test:coverage  # 추가
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

**package.json 수정**:
```json
{
  "scripts": {
    "test": "vitest --run tests/unit",
    "test:coverage": "vitest --run --coverage tests/unit",  // 추가
    "test:watch": "vitest tests/unit"
  }
}
```

---

### Phase 4 완료 기준

```bash
# 1. 모든 테스트 통과
npm run test:coverage

# 2. 커버리지 검증
# Coverage Summary:
# Lines: 70%+ ✓
# Functions: 70%+ ✓
# Branches: 65%+ ✓
# Statements: 70%+ ✓

# 3. HTML 리포트 확인
open coverage/index.html

# 릴리스
# v2.0.0 - Major test coverage milestone
# - Test: Add comprehensive test suite (70% coverage)
# - Test: Add share workflow integration tests
# - Test: Add auto-loader behavior tests
# - Test: Add privacy pipeline tests
# - Test: Add parser accuracy tests
# - CI: Integrate coverage reporting
```

---

## 🌟 Phase 5: 장기 비전 (Week 11+)

**목표**: 프로젝트 확장성 및 협업 강화
**총 작업량**: TBD (프로젝트 진화에 따라)

### 작업 목록

#### 1. ✅ TypeScript 점진적 도입 [?? 주] 🟢

**제안자**: Gemini

**전략**:
1. `checkJs` 모드 활성화 (JSDoc 검증)
2. `.d.ts` 파일 생성 (외부 인터페이스)
3. 핵심 모듈부터 `.ts` 마이그레이션
4. 빌드 파이프라인 조정 (tsc → rollup)

**마일스톤**:
- M1: `tsconfig.json` + `checkJs` 활성화
- M2: `src/types/` 디렉토리 생성, 인터페이스 정의
- M3: core/, privacy/, export/ 마이그레이션
- M4: ui/, features/, adapters/ 마이그레이션
- M5: 완전 TypeScript 전환

**영향**: 타입 안전성, 대형 협업 가능
**조건**: Phase 2 (JSDoc) 완료 후 시작

---

#### 2. ✅ Modern/Legacy UI 전략 결정 [12-20시간] 🟠

**제안자**: Claude

**조사 필요**:
- Legacy UI 사용률 (localStorage 분석)
- 사용자 피드백 수집

**전략 A (사용률 < 10%)**:
- Legacy UI Deprecated 공지 (3개월 유예)
- v2.5.0에서 완전 제거

**전략 B (사용률 ≥ 10%)**:
- 공통 로직 추출 (`src/ui/base/`)
- 데코레이터 패턴으로 modern/legacy 스타일 적용
- 8개 중복 함수 → 4개 기본 + 2개 데코레이터

**영향**: 코드베이스 간소화, 유지보수 부담 감소

---

#### 3. ✅ ChatGPT 어댑터 추가 (확장성 검증) [20시간] 🟢

**제안자**: Gemini

**목표**: 어댑터 패턴 실전 검증

**신규 파일**: `src/adapters/chatgpt.js`
```javascript
export const createChatGPTAdapter = ({ registry }) => {
  return {
    id: 'chatgpt',
    label: 'ChatGPT',
    match: (loc) => /chat\.openai\.com/.test(loc.hostname),
    findContainer: (doc) => doc.querySelector('[data-testid="conversation-turn"]'),
    listMessageBlocks: (root) => root.querySelectorAll('[data-message-id]'),
    // ... 13개 메서드 구현
  };
};
```

**Tampermonkey 헤더 업데이트**:
```javascript
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
```

**영향**:
- 다중 플랫폼 지원 증명
- 커뮤니티 기여 유도 (다른 플랫폼 어댑터 PR)

---

#### 4. ✅ 플러그인 시스템 설계 [?? 주] 🟢

**제안자**: Claude

**목표**: 써드파티 확장 지원

**API 설계**:
```javascript
// src/plugin-api.js
export const GMH_PLUGIN_API = {
  version: '2.0.0',
  registerExportFormat: (name, writer) => { /* ... */ },
  registerRedactionRule: (name, pattern) => { /* ... */ },
  registerUIComponent: (slot, component) => { /* ... */ },
  addEventListener: (event, handler) => { /* ... */ },
};
```

**예시 플러그인**:
```javascript
// genit-memory-helper-pdf-export.user.js
GMH_PLUGIN_API.registerExportFormat('pdf', (session, options) => {
  // jsPDF 사용하여 PDF 생성
});
```

**영향**: 생태계 확장, 커뮤니티 활성화

---

## 📊 예상 효과 종합

| Phase | 작업량 | 주요 효과 | 측정 지표 |
|-------|--------|----------|-----------|
| **Phase 0** | 5시간 | 데이터 손실 해결 | 버그 리포트 감소 |
| **Phase 1** | 6시간 | 성능 3-5배, 번들 15% 감소 | 자동 로드 시간, 파일 크기 |
| **Phase 2** | 10시간 | 기여자 온보딩 50% 단축 | PR 첫 기여 시간 |
| **Phase 3** | 20시간 | 복잡도 78% 감소 | index.js 줄 수 |
| **Phase 4** | 40시간 | 회귀 방지, 신뢰도 향상 | 커버리지 70% |
| **Phase 5** | TBD | 확장성, 타입 안전성 | 플랫폼 수, 타입 에러 |

**총 작업량**: 81시간 (Phase 0-4)
**예상 완료**: 10주
**투입 인력**: 1-2명 (주당 8-10시간 작업 가정)

---

## 🎯 성공 기준

### Phase 0-1 (긴급)
- [ ] Codex 버그 2개 수정 완료
- [ ] v1.6.3 릴리스
- [ ] 자동 로드 시간 50% 단축 확인
- [ ] 번들 크기 10% 이상 감소

### Phase 2 (문서화)
- [ ] 상위 20개 API에 JSDoc 존재
- [ ] .env.example 존재 및 README 업데이트
- [ ] config.js 생성 및 사용 중

### Phase 3 (아키텍처)
- [ ] src/composition/ 디렉토리 존재
- [ ] index.js < 200줄
- [ ] 모든 테스트 통과

### Phase 4 (테스트)
- [ ] 커버리지 70% 이상
- [ ] 핵심 워크플로우 테스트 존재
- [ ] CI에서 커버리지 검증 중

---

## 🚀 즉시 시작 가능한 액션

### 이번 주 (Week 0)

**금요일까지 완료**:
```bash
# 1. Codex 버그 수정
src/export/writers-structured.js:28
src/features/snapshot.js:112-161

# 2. 테스트 추가
tests/unit/structured-export.spec.js
tests/unit/structured-snapshot.spec.js (신규)

# 3. 빌드 & 검증
npm run build && npm test

# 4. 릴리스 (유지보수자 전용 - AI 에이전트는 실행 금지)
# npm run bump:patch  # v1.6.3
```

### 다음 주 (Week 1)

**월-수요일**:
```bash
# 성능 개선
src/features/auto-loader.js (캐싱)
rollup.config.js (tree-shaking)
```

**목-금요일**:
```bash
# 안정성
src/privacy/settings.js (검증)
.env.example (신규)
# v1.7.0 릴리스
```

---

## 🤝 승인 요청

이 로드맵은 다음 AI 에이전트들의 리뷰를 통합했습니다:

- **Codex**: 2개 CRITICAL 버그 발견 → Phase 0 최우선
- **Claude**: 5개 영역 종합 분석 → Phase 1-4 프레임워크
- **Gemini**: 전략적 방향 → Phase 2 문서화, Phase 5 비전

### 승인 체크리스트

**Codex 승인 사항**:
- [ ] Phase 0에 Codex 발견 버그 2개 최우선 배치 확인
- [ ] 회귀 테스트 추가 계획 포함 확인
- [ ] Modal XSS 우선순위 하향 (LOW) 반영 확인

**Gemini 승인 사항**:
- [ ] .env.example 추가 (Phase 1) 포함 확인
- [ ] TypeScript 비전 (Phase 5) 포함 확인
- [ ] AI 협업 프로세스 문서화 (AGENTS.md) 포함 확인

**사용자 승인 사항**:
- [ ] 작업량 합리적 (총 81시간 / 10주)
- [ ] 우선순위 합리적 (데이터 > 보안 > 성능 > 품질)
- [ ] 실행 가능성 높음 (구체적 파일명, 예시 코드)

---

**승인 후 즉시 착수**: Phase 0 (이번 주 완료 목표)

**작성 완료**: Claude
**최종 검토일**: 2025-09-30
**버전**: 1.0 (통합 최종안)