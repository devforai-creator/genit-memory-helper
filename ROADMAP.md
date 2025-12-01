# 🗺️ General Memory Helper (GMH) 개선 로드맵

> **프로젝트 상태: Dual Memory 시스템 개발 준비**
> v2.5.0 (2025-11-30) 기준, 기술 부채 정리 완료. 취약점 0개, 테스트 커버리지 43% 향상.
> 다음 목표: v3.0.0 Dual Memory 시스템 (의미 검색은 보류)

**버전**: 3.0.0-roadmap (2025-12-01 갱신)
**현재 상태**: 기술 부채 정리 완료 (취약점 0개, 테스트 159개)
**다음 목표**: v3.0.0 Dual Memory 시스템 구현
**기반**: TypeScript + 온디맨드 청크화 + 멀티 플랫폼 어댑터

---

## 📋 로드맵 개요

### 전체 타임라인

```
v2.0.1 ✅
    ↓
v2.1.0 [Infrastructure] ✅      (완료: 2025-10-24)
    ↓
v2.1.1 [Security] ✅            (완료: 2025-11-11)
    ↓
v2.3.0 [Multi-Platform] ✅      (완료: 2025-01-29) - babechat.ai 지원
    ↓
v2.4.0 [UX] ✅                  (완료: 2025-01-30) - FAB 위치 설정
    ↓
v2.5.0 [Tech Debt] ✅           (완료: 2025-11-30) - 취약점 0개, 테스트 +48개
    ↓
v3.0.0 [Dual Memory] 🚧         개발 예정 - 요약 + Facts 추출 ← 다음 목표
    ↓
v3.1.0 [UX Polish] 📋           계획됨 - 진행 상태, 백업/복원
    ↓
v3.2.0+ [Advanced] ⏸️           보류 - Ollama 연동, 외부 API
    ↓
v4.0.0 [Semantic Search] ⏸️     보류 - 의미 검색, 임베딩 (우선순위 낮음)
```

### 완료된 마일스톤

| 버전 | 목표 | 상태 | 완료일 |
|------|------|------|--------|
| **v2.0.0** | TypeScript 전환 | ✅ 완료 | 2025-10-09 |
| **v2.0.1** | 범위 입력 회귀 버그 수정 | ✅ 완료 | 2025-10-24 |
| **Embedding PoC** | 의미 검색 기술 검증 | ✅ 완료 | 2025-10-17 |
| **v2.1.0** | 인프라 구축 (실시간 인덱서, 블록화, IndexedDB) | ✅ 완료 | 2025-10-24 |
| **v2.1.1** | 보안 업데이트 (playwright, typescript, rollup) | ✅ 완료 | 2025-11-11 |
| **v2.3.0** | babechat.ai 지원, 프로젝트명 변경, API 기반 수집 | ✅ 완료 | 2025-01-29 |
| **v2.4.0** | FAB 위치 설정 (4개 코너), 기본값 우상단 변경 | ✅ 완료 | 2025-01-30 |
| **v2.5.0** | 기술 부채 정리 (취약점 0개, 테스트 +48개) | ✅ 완료 | 2025-11-30 |

### 기술 부채 (v2.5.0 - 완료)

| 항목 | 설명 | 상태 |
|------|------|------|
| **Major 의존성 업그레이드** | vite 5→7, vitest 2→4, jsdom 24→27 (취약점 0개) | ✅ 완료 |
| **babechat 어댑터 테스트** | hostname 매칭, role 감지, speaker 파싱, API 수집 (+18개) | ✅ 완료 |
| **privacy-gate 테스트** | 팩토리 검증, confirm 흐름, 모달 렌더링 (+12개) | ✅ 완료 |
| **share 워크플로우 테스트** | parseAll, prepareShare, performExport (+18개) | ✅ 완료 |
| **코드 중복 리팩토링** | 분석 결과 premature abstraction으로 판단, 현상태 유지 | ⏭️ 보류 |

**테스트 커버리지**: 111 → 159개 (+48개, +43%)

### 예정된 마일스톤 (Dual Memory)

| 버전 | 목표 | 핵심 기능 | 상태 |
|------|------|----------|------|
| **v3.0.0** | Dual Memory Core | 10개 청크화, 요약/Facts 프롬프트, 반자동 워크플로우 | 🚧 개발 예정 |
| **v3.1.0** | UX Polish | 진행 상태 표시, 백업/복원, 프롬프트 커스터마이징 | 📋 계획됨 |
| **v3.2.0+** | Advanced | Ollama 연동, 외부 API (BYOK) | ⏸️ 보류 |

### 보류된 마일스톤 (Semantic Search)

| 버전 | 목표 | 핵심 기능 | 상태 |
|------|------|----------|------|
| **v4.0.0** | 의미 검색 | BGE-M3 임베딩, 검색 UI, 맥락 재구성 | ⏸️ 보류 |
| **v4.1.0** | 성능 최적화 | 자동 로더 캐싱, 검색 캐싱 | ⏸️ 보류 |

> **참고**: 의미 검색(Semantic Search)은 Dual Memory 시스템 안정화 이후 재검토 예정.
> v2.1.0에서 구축한 실시간 인덱싱 인프라는 experimental로 유지되며, 향후 활용 가능.

### 미래 작업 (TODO)

| 기능 | 설명 | 난이도 |
|------|------|--------|
| **babechat 이미지 URL 매핑** | API 응답의 `img:[id]` 형식을 실제 이미지 URL로 변환. babechat 프론트엔드 JS 역공학 필요. | 중 |

---

## 🧠 v3.0.0 - Dual Memory Core (이중 메모리 시스템)

**목표**: 인간 기억 구조를 모방한 Dual Memory 시스템 구현
**상태**: 🚧 개발 예정
**예상 작업량**: 20-30시간

### 철학: 왜 Dual Memory인가?

```
기존 문제:
"2025년 11월 10일, 메코 식당에서 떡볶이 먹으며 첫 만남"
        ↓ (단순 요약)
"식당에서 밥 먹음"  ← 구체적 디테일 손실!

Dual Memory 해결책:
┌─────────────────┐     ┌─────────────────┐
│ Semantic Memory │     │ Episodic Memory │
│ (의미 기억)      │     │ (삽화 기억)      │
├─────────────────┤     ├─────────────────┤
│ "식당에서 식사"   │     │ "11/10 메코식당" │
│ (추상적 요약)    │     │ "떡볶이, 첫만남"  │
│                 │     │ (구체적 사실)    │
└─────────────────┘     └─────────────────┘
```

### GMH의 역할

```
GMH = 플랫폼 독립적인 "대화 메모리 워크벤치"

┌─────────────────────────────────────────────────┐
│                    GMH                           │
│                                                  │
│   [GMH에 담기] → 전체 대화 수집 → 10개씩 청크화   │
│                                                  │
│   ┌─────────┐                                   │
│   │ 청크 1  │ → [요약 프롬프트 복사] → 외부 LLM  │
│   │ 청크 2  │ → [Facts 프롬프트 복사] → 외부 LLM │
│   │ ...     │                                   │
│   └─────────┘                                   │
│         ↓                                       │
│   [결과 붙여넣기] → 요약/Facts 저장              │
│         ↓                                       │
│   최종 메모리 → 플랫폼 유저노트에 복사           │
└─────────────────────────────────────────────────┘

특징:
- 온디맨드 방식 (버튼 클릭 시 처리)
- 반자동화 (프롬프트 복사 → 외부 LLM → 결과 붙여넣기)
- API 키 관리 불필요 (보안 부담 없음)
- 세션 메모리 (브라우저 탭 동안만 유지)
```

### 핵심 기능

| 기능 | 설명 |
|------|------|
| **GMH에 담기** | 전체 대화 수집 → 10개 메시지 청크화 |
| **청크 뷰어** | 청크 목록 표시, 펼치기/접기 |
| **요약 프롬프트** | 청크별 요약 추출용 프롬프트 + 복사 버튼 |
| **Facts 프롬프트** | 청크별 Facts 추출용 프롬프트 + 복사 버튼 |
| **결과 입력** | LLM 결과 붙여넣기 UI |
| **메모리 뷰** | 요약 + Facts 통합 보기 |
| **최종 내보내기** | 유저노트용 포맷으로 복사 |

### 데이터 구조

```typescript
interface MemoryChunk {
  id: string;
  index: number;
  messages: StructuredSnapshotMessage[];  // 10개
  raw: string;                            // 원문 텍스트
  summary?: string;                       // 사용자가 붙여넣은 요약
  facts?: string;                         // 사용자가 붙여넣은 Facts
  timestamp: number;
}

interface MemorySession {
  sessionUrl: string;
  chunks: MemoryChunk[];
  createdAt: number;
  updatedAt: number;
}
```

### 프롬프트 템플릿

**요약 프롬프트 (기본)**:
```
다음 대화를 2-3문장으로 요약해주세요. 핵심 주제와 흐름만 간단히.

[대화 내용]
{chunk.raw}
```

**Facts 프롬프트 (기본)**:
```
다음 대화에서 나중에 참조할 가치가 있는 구체적 사실을 추출해주세요.
- 첫 경험 (첫 만남, 첫 시도 등)
- 구체적 정보 (날짜, 장소, 음식, 시간 등)
- 개인 선호/습관/특징
- 중요한 약속이나 결정
- 감정적으로 의미 있는 순간

없으면 "기록할 사실 없음"이라고만 답해주세요.

[대화 내용]
{chunk.raw}
```

### UI 와이어프레임

```
┌─────────────────────────────────────┐
│ 💾 GMH Memory                    ✕ │
├─────────────────────────────────────┤
│ [GMH에 담기]  상태: 12개 청크 생성  │
├─────────────────────────────────────┤
│ 📦 청크 목록                        │
│ ┌─────────────────────────────────┐ │
│ │ #1 (1-10)           [펼치기 ▼] │ │
│ │ 요약: (미입력)      [📋 복사]  │ │
│ │ Facts: (미입력)     [📋 복사]  │ │
│ │                     [붙여넣기] │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ #2 (11-20)          [펼치기 ▼] │ │
│ │ 요약: "캐릭터와 첫 만남..."     │ │
│ │ Facts: "- 11/10 메코식당..."    │ │
│ └─────────────────────────────────┘ │
│ ...                                 │
├─────────────────────────────────────┤
│ 📝 최종 메모리                      │
│ [통합 보기]  [유저노트용 복사]      │
└─────────────────────────────────────┘
```

### v3.0.0 체크리스트

- [ ] 10개 메시지 청크화 로직
- [ ] 청크 뷰어 UI
- [ ] 요약/Facts 프롬프트 템플릿
- [ ] 프롬프트 + 청크 복사 기능
- [ ] 결과 붙여넣기 UI
- [ ] 청크별 요약/Facts 저장 (세션 메모리)
- [ ] 통합 메모리 뷰
- [ ] 유저노트용 포맷 내보내기
- [ ] 기존 UI와 통합 (패널 탭 또는 섹션)
- [ ] 테스트 추가

### v3.0.0 성공 기준

- [ ] 100개 메시지 → 10개 청크 정상 생성
- [ ] 프롬프트 복사 → 외부 LLM → 결과 붙여넣기 워크플로우 동작
- [ ] 유저노트용 최종 출력 생성
- [ ] 기존 내보내기 기능과 공존

---

## 🎨 v3.1.0 - UX Polish (사용성 개선)

**목표**: Dual Memory 사용성 개선
**상태**: 📋 계획됨
**예상 작업량**: 10-15시간

### 핵심 기능

| 기능 | 설명 |
|------|------|
| **진행 상태** | 몇 개 청크 완료됐는지 시각적 표시 |
| **자동 저장** | IndexedDB에 세션 저장 (선택적) |
| **가져오기/내보내기** | JSON 백업/복원 |
| **프롬프트 커스터마이징** | 사용자 정의 요약/Facts 프롬프트 |

### v3.1.0 체크리스트

- [ ] 청크 완료 상태 표시 (프로그레스 바)
- [ ] IndexedDB 저장 옵션
- [ ] JSON 내보내기 (백업)
- [ ] JSON 가져오기 (복원)
- [ ] 프롬프트 설정 UI
- [ ] 설정 영구 저장 (localStorage)

---

## 🔧 v3.2.0+ - Advanced (고급 기능)

**목표**: 자동화 옵션 제공
**상태**: ⏸️ 보류 (v3.1.0 완료 후 재검토)
**예상 작업량**: 15-25시간

### 계획된 기능

| 기능 | 설명 | 복잡도 |
|------|------|--------|
| **Ollama 연동** | 로컬 LLM 자동화 (localhost:11434) | 중 |
| **외부 API (BYOK)** | OpenAI/Claude/Gemini API 키 입력 | 중-고 |
| **스마트 청킹** | 대화 흐름 기반 자동 분할 | 고 |
| **메타 요약** | 전체 요약 자동 생성 | 중 |

> **보안 참고**: 외부 API 연동 시 보안 경고 + 사용자 동의 필수

---

## 📚 v2.1.0 실시간 인덱싱 인프라 (참고)

> **상태**: experimental로 유지
> **관계**: Dual Memory와 독립적
> **용도**: 향후 Semantic Search 또는 실시간 기능에 활용 가능

v2.1.0에서 구축한 실시간 메시지 인덱싱 인프라는 다음과 같이 유지됩니다:
- `src/core/message-indexer.ts` - MutationObserver 기반 메시지 감지
- `src/features/block-builder.ts` - 5개 메시지 블록 빌더
- `src/storage/block-storage.ts` - IndexedDB 저장소
- `src/features/message-stream.ts` - 파이프라인 오케스트레이션

Dual Memory (v3.0.0)는 이 인프라와 별개로, 온디맨드 방식의 새로운 청크화 로직을 사용합니다.

---

## 🗄️ v2.1.0 - Infrastructure (인프라 구축) - 완료

**목표**: 의미 검색을 위한 실시간 메시지 인덱싱 및 블록화 파이프라인 구축
**기간**: 3-4주 (20-30시간)
**기반**: Embedding PoC 결과 (`gmh_poc_final_report.md`)

### 핵심 작업

#### 1. 실시간 메시지 인덱서 강화 (8-10h)

**현재 상태**:
- `src/core/message-indexer.ts`가 메시지를 추적하지만 영구 저장 없음
- DOM 파싱 후 메모리에만 존재

**목표**:
- MutationObserver 기반 실시간 메시지 스트림 구축
- 새 메시지 감지 → DTO 변환 → 메모리 큐 적재

**파일**:
- `src/core/message-indexer.ts` 확장
- `src/features/message-stream.ts` (신규)

**구현 내용**:
```typescript
// 새 메시지 감지 및 큐 적재
const messageStream = createMessageStream({
  messageIndexer,
  onNewMessage: (message) => {
    messageQueue.push(message);
    tryBuildBlock(); // 5개 쌓이면 블록 생성
  }
});
```

---

#### 2. 블록 빌더 구현 (6-8h)

**PoC 검증 결과**:
- 블록 크기: **5개 메시지**
- Overlap: **2개 메시지**
- 나레이션 제거: **활성화**

**파일**:
- `src/features/block-builder.ts` (신규)

**구현 내용**:
```typescript
interface MessageBlock {
  id: string;
  messages: ParsedMessage[];
  startOrdinal: number;
  endOrdinal: number;
  timestamp: number;
  raw: string; // 나레이션 제거된 원문
}

const blockBuilder = createBlockBuilder({
  blockSize: 5,
  overlap: 2,
  removeNarration: true,
  onBlockReady: (block) => {
    // IndexedDB 저장 준비
    pendingBlocks.push(block);
  }
});
```

**블록 생성 로직**:
```
메시지 큐: [M1, M2, M3, M4, M5, M6, M7, M8, ...]

Block 1: [M1, M2, M3, M4, M5]
Block 2: [M4, M5, M6, M7, M8]  ← M4, M5 overlap
Block 3: [M7, M8, M9, M10, M11] ← M7, M8 overlap
```

---

#### 3. IndexedDB 영구 저장 (4-6h)

**PoC 검증**:
- 100개 메시지 = ~30개 블록 = ~300KB
- 검색 속도: <80ms (충분히 빠름)

**파일**:
- `src/storage/block-storage.ts` (신규)

**스키마**:
```typescript
interface BlockStore {
  id: string; // 블록 ID
  sessionUrl: string; // genit.ai 대화 URL
  messages: ParsedMessage[]; // 5개 메시지
  raw: string; // 원문 (나레이션 제거)
  embedding?: Float32Array; // 임베딩 벡터 (v2.2.0에서 추가)
  timestamp: number;
  ordinalRange: [number, number]; // [시작, 끝]
}
```

**API**:
```typescript
const blockStorage = createBlockStorage();

// 블록 저장
await blockStorage.save(block);

// 세션별 블록 조회
const blocks = await blockStorage.getBySession(sessionUrl);

// 전체 통계
const stats = await blockStorage.getStats(); // { totalBlocks, totalMessages, sessions }
```

---

#### 4. 모델 로딩 UX (4-6h)

**PoC 검증**:
- BGE-M3 모델 크기: **570MB** (8-bit 양자화)
- 첫 로딩: **1-2분** (이후 브라우저 캐싱)

**파일**:
- `src/ui/model-loader.ts` (신규)
- `src/ui/model-status.ts` (신규)

**UI 요소**:
```typescript
// 패널에 추가될 상태 표시
interface ModelStatus {
  state: 'not-loaded' | 'loading' | 'ready' | 'error';
  progress?: number; // 0-100
  estimatedTime?: number; // 초 단위
  error?: string;
}
```

**표시 예시**:
```
[패널 상단]
🧠 Memory Index: 로딩 중... (45%, 약 30초 남음)
🧠 Memory Index: 준비 완료 ✅ (5개 블록 대기 중)
🧠 Memory Index: 오류 - 모델 로드 실패
```

---

#### 5. Feature Flag 시스템 (2-3h)

**목표**: 프로덕션 빌드에 포함하되 사용자는 수동 활성화

**파일**:
- `src/experimental/index.ts` (신규)
- `src/experimental/memory-index.ts` (신규)

**구현**:
```typescript
// localStorage 기반 토글
const GMH_EXPERIMENTAL = {
  MemoryIndex: {
    get enabled() {
      return localStorage.getItem('gmh_experimental_memory') === '1';
    },
    enable() {
      localStorage.setItem('gmh_experimental_memory', '1');
      console.log('[GMH] Memory Index 활성화됨. 페이지 새로고침 필요.');
    },
    disable() {
      localStorage.removeItem('gmh_experimental_memory');
    }
  }
};

// Tampermonkey 메타에는 아직 노출 안 함
```

**활성화 방법**:
```javascript
// 브라우저 콘솔에서
GMH.Experimental.MemoryIndex.enable();
location.reload();
```

---

### v2.1.0 체크리스트

- [x] 실시간 메시지 스트림 구현 ✅
- [x] 블록 빌더 (5+0 overlap, 모든 메시지 포함) 구현 ✅
- [x] IndexedDB 저장소 구현 ✅
- [x] Feature flag 시스템 ✅
- [x] 블록 뷰어 UI (요약/펼치기) ✅
- [x] 스트리밍 완료 대기 로직 (8초+재시도) ✅
- [x] 중복 메시지 필터링 (preview-* 카드) ✅
- [x] 패널 UI 업데이트 (상태 표시) ✅
- [ ] 모델 로딩 UX (프로그레스 바) - v2.2.0으로 이동
- [ ] 통합 테스트 추가 - 선택 사항
- [ ] 문서 업데이트 (CLAUDE.md, README.md) - 부분 완료

**실제 소요 시간**: ~25시간
**완료일**: 2025-10-24 ✅

---

### ⚠️ v2.1.0 기술적 고려사항

#### IndexedDB 구현 세부사항

**Float32Array 저장**
```typescript
// ❌ 잘못된 방법 (직렬화 실패)
await db.put('blocks', { id: '...', embedding: vector });

// ✅ 올바른 방법 (.buffer 사용)
await db.put('blocks', {
  id: '...',
  embedding: vector.buffer  // ArrayBuffer로 저장
});

// 복원 시
const stored = await db.get('blocks', id);
const vector = new Float32Array(stored.embedding);
```

**블록 ID ↔ ordinal 인덱스**
```typescript
// v2.2 검색 최적화를 위해 v2.1에서 미리 준비
interface BlockStore {
  id: string;
  sessionUrl: string;
  messages: ParsedMessage[];
  raw: string;
  embedding?: ArrayBuffer;  // ← Float32Array.buffer
  timestamp: number;
  ordinalRange: [number, number];
  // 추가: 빠른 조회를 위한 인덱스
  startOrdinal: number;  // ← 검색 시 범위 필터링용
  endOrdinal: number;
}

// 인덱스 생성
store.createIndex('sessionUrl', 'sessionUrl', { unique: false });
store.createIndex('startOrdinal', 'startOrdinal', { unique: false });
store.createIndex('timestamp', 'timestamp', { unique: false });
```

**스키마 버전 관리**
```typescript
const DB_VERSION = 1;  // v2.1.0 초기 버전
const DB_NAME = 'gmh-memory-blocks';

const openDB = () => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    const oldVersion = event.oldVersion;

    // v1 스키마 생성
    if (oldVersion < 1) {
      const store = db.createObjectStore('blocks', { keyPath: 'id' });
      store.createIndex('sessionUrl', 'sessionUrl', { unique: false });
      store.createIndex('startOrdinal', 'startOrdinal', { unique: false });
      store.createIndex('timestamp', 'timestamp', { unique: false });
    }

    // 향후 v2 스키마 (v2.2.0 이후)
    // if (oldVersion < 2) {
    //   // 마이그레이션 로직
    // }
  };
};
```

---

#### Transformers.js 번들 이슈

**문제**: BGE-M3 모델 (570MB) + Transformers.js 라이브러리가 userscript 번들에 포함되면 너무 큼

**해결**: Dynamic Import + CDN
```typescript
// ❌ 정적 import (번들에 포함)
import { pipeline } from '@huggingface/transformers';

// ✅ 동적 import (런타임 로딩)
const loadTransformers = async () => {
  const { pipeline } = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest/dist/transformers.min.js'
  );
  return pipeline;
};

// v2.1.0에서는 모델 로딩 UX만 준비
// 실제 Transformers.js 로딩은 v2.2.0에서
```

**대안**: Rollup externals 설정
```javascript
// rollup.config.js
export default {
  external: ['@huggingface/transformers'],
  // Tampermonkey에서 @require로 로드
};
```

---

#### 테스트 전략

**IndexedDB 테스트**
```typescript
// tests/unit/block-storage.spec.ts (신규)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBlockStorage } from '../../src/storage/block-storage';

describe('BlockStorage', () => {
  let storage;

  beforeEach(async () => {
    // 테스트용 IndexedDB 초기화
    storage = await createBlockStorage({ dbName: 'test-gmh' });
  });

  afterEach(async () => {
    // 정리
    await storage.clear();
  });

  it('should save and retrieve blocks', async () => {
    const block = { /* ... */ };
    await storage.save(block);
    const retrieved = await storage.get(block.id);
    expect(retrieved).toEqual(block);
  });

  it('should handle Float32Array embedding', async () => {
    const vector = new Float32Array([1, 2, 3]);
    const block = { id: 'test', embedding: vector.buffer };
    await storage.save(block);

    const retrieved = await storage.get('test');
    const restored = new Float32Array(retrieved.embedding);
    expect(restored).toEqual(vector);
  });
});
```

---

#### 선택 사항 (필요 시 구현)

**초기 세션 백필 (Backfill)**
- 현재 대화의 기존 메시지들을 블록화
- v2.1.0에서는 "새 메시지만" 처리하고, 백필은 v2.1.1 또는 v2.2.0에서 추가 고려

**메시지 삭제 감지**
- genit.ai에서 메시지 삭제 시 블록도 업데이트
- 현재는 추가(append-only) 방식만 구현, 삭제는 나중에

**모델 로딩 UX Degradation**
- v2.1.0: 단순 스피너 표시
- v2.2.0: 실제 Transformers.js progress 이벤트 연결
- 모델 없이도 블록 저장은 정상 작동 (임베딩만 null)

---

## 🔍 v2.2.0 - Semantic Search Alpha (의미 검색 알파)

**목표**: BGE-M3 임베딩 모델 통합 및 의미 검색 UI 구현
**기간**: 3-4주 (25-35시간)
**전제 조건**: v2.1.0 완료 (블록 저장소 준비됨)

### 핵심 작업

#### 1. BGE-M3 임베딩 엔진 (8-10h)

**PoC 검증 결과**:
- 모델: `Xenova/bge-m3` (Transformers.js)
- 차원: 1024
- 한국어 검색 품질: 90%+ 정답률, 70%+ 확신도

**파일**:
- `src/features/embedding-engine.ts` (신규)

**구현**:
```typescript
import { pipeline } from '@huggingface/transformers';

const embeddingEngine = await createEmbeddingEngine({
  model: 'Xenova/bge-m3',
  onProgress: (progress) => {
    // 모델 로딩 진행률 업데이트
    updateModelStatus({ state: 'loading', progress });
  }
});

// 블록 임베딩 생성
const vector = await embeddingEngine.embed(block.raw); // Float32Array(1024)

// IndexedDB에 저장
await blockStorage.updateEmbedding(block.id, vector);
```

**백그라운드 임베딩**:
```typescript
// 메시지 추가 시 비동기로 임베딩 생성
messageStream.on('blockCreated', async (block) => {
  // 1. 블록 저장 (즉시)
  await blockStorage.save(block);

  // 2. 임베딩 생성 (백그라운드)
  setTimeout(async () => {
    const vector = await embeddingEngine.embed(block.raw);
    await blockStorage.updateEmbedding(block.id, vector);
  }, 0);
});
```

---

#### 2. 검색 엔진 (6-8h)

**PoC 검증**:
- 검색 방법: 코사인 유사도
- 응답 시간: <80ms (30개 블록 기준)

**파일**:
- `src/features/semantic-search.ts` (신규)

**구현**:
```typescript
const searchEngine = createSemanticSearch({
  embeddingEngine,
  blockStorage,
});

// 검색 실행
const results = await searchEngine.search({
  query: '강아지 훈련 방법',
  topK: 3,  // 상위 3개 블록
  threshold: 0.6, // 유사도 60% 이상만
  sessionUrl: currentSessionUrl, // 현재 대화만 검색
});

// 결과
interface SearchResult {
  block: MessageBlock;
  similarity: number; // 0-1
  context: {
    prev?: MessageBlock;  // 이전 블록 (맥락)
    next?: MessageBlock;  // 다음 블록 (맥락)
  };
}
```

---

#### 3. 맥락 재구성 (Contextual Reconstruction) (4-6h)

**PoC 권장사항**:
- 정밀 검색: 작은 블록 (5개 메시지)
- 맥락 보완: 이전/다음 블록 함께 표시

**구현**:
```typescript
const enrichWithContext = async (result: SearchResult) => {
  const { block } = result;

  // 같은 세션의 인접 블록 조회
  const allBlocks = await blockStorage.getBySession(block.sessionUrl);
  const index = allBlocks.findIndex(b => b.id === block.id);

  return {
    ...result,
    context: {
      prev: index > 0 ? allBlocks[index - 1] : null,
      next: index < allBlocks.length - 1 ? allBlocks[index + 1] : null,
    }
  };
};
```

**UI 표시**:
```
[검색 결과 1] 유사도: 82%
  ┌─ 이전 맥락 ─────────────┐
  │ "파이썬 기초를 배우고..."  │
  └─────────────────────────┘

  ★ [매칭 블록] ★
  "강아지 훈련은 긍정 강화..."

  ┌─ 다음 맥락 ─────────────┐
  │ "간식을 주는 타이밍이..." │
  └─────────────────────────┘
```

---

#### 4. 검색 UI 패널 (6-8h)

**파일**:
- `src/ui/search-panel.ts` (신규)

**UI 구조**:
```html
<div class="gmh-search-panel">
  <div class="gmh-search-header">
    <h3>💡 Memory Search (Alpha)</h3>
    <span class="gmh-search-stats">5개 블록 인덱싱됨</span>
  </div>

  <div class="gmh-search-input">
    <input type="text" placeholder="찾고 싶은 내용 입력..." />
    <button>검색</button>
  </div>

  <div class="gmh-search-results">
    <!-- 검색 결과 표시 -->
  </div>
</div>
```

**기능**:
- 실시간 검색 (입력 후 500ms debounce)
- 유사도 표시 (막대 그래프)
- 클릭 시 원본 메시지로 스크롤
- 맥락 접기/펼치기

---

#### 5. 알파 테스트 준비 (2-3h)

**목표**: 내부 테스터용 가이드 작성

**파일**:
- `docs/semantic-search-alpha.md` (신규)

**내용**:
```markdown
# Semantic Search Alpha 테스트 가이드

## 활성화 방법
1. F12 (개발자 도구) 열기
2. 콘솔에 입력: `GMH.Experimental.MemoryIndex.enable()`
3. 페이지 새로고침

## 기대 동작
- 대화 시작 후 자동으로 메시지 블록화
- "💡 Memory Search" 패널 표시
- 검색 입력 시 관련 블록 표시

## 알려진 제약
- 첫 로딩 1-2분 (570MB 모델)
- 한영 혼용 검색 품질 낮음
- 최대 1000개 메시지까지 권장

## 피드백 방법
- GitHub Issues: [링크]
- 버그 리포트 시 콘솔 로그 첨부
```

---

### v2.2.0 체크리스트

- [ ] BGE-M3 임베딩 엔진 통합
- [ ] 백그라운드 임베딩 생성 파이프라인
- [ ] 검색 엔진 구현 (코사인 유사도)
- [ ] 맥락 재구성 로직
- [ ] 검색 UI 패널 구현
- [ ] 검색 결과 하이라이트/스크롤
- [ ] 통합 테스트 (검색 정확도 90%+)
- [ ] 알파 테스트 가이드 작성
- [ ] Feature flag 활성화 문서화

**예상 시간**: 26-35시간

---

## ⚡ v2.3.0 - Performance (성능 최적화)

**목표**: 자동 로더 및 검색 성능 개선
**기간**: 2-3주 (15-20시간)
**전제 조건**: v2.2.0 완료 (검색 기능 안정화)

### 핵심 작업

#### 1. 자동 로더 캐싱 (4-6h)

**현재 문제**:
- 스크롤 시 매번 전체 DOM 재파싱
- 100개 메시지 로드 시 2.6분 소요 (ROADMAP v1.0 이슈 #21)

**목표**:
- WeakMap 기반 DOM 캐싱
- 파싱 시간 2.6분 → 50초 (3배 향상)

**파일**:
- `src/features/auto-loader.ts` 수정

**구현**:
```typescript
const messageCache = {
  snapshot: new WeakMap<Element, ParsedMessage>(),
  lastParse: 0,

  invalidate() {
    this.lastParse = Date.now();
  }
};

const parseMessage = (element: Element) => {
  // 캐시 확인
  if (messageCache.snapshot.has(element)) {
    return messageCache.snapshot.get(element);
  }

  // 새로 파싱
  const parsed = adapter.collectStructuredMessage(element);
  messageCache.snapshot.set(element, parsed);
  return parsed;
};
```

---

#### 2. 매직 넘버 상수화 (1-2h)

**파일**:
- `src/config.ts` 확장

**구현**:
```typescript
export const CONSTANTS = {
  // Auto Loader
  MAX_PROLOGUE_HOPS: 400,
  AUTO_LOADER_CYCLE_DELAY_MS: 700,

  // Block Builder
  BLOCK_SIZE: 5,
  BLOCK_OVERLAP: 2,

  // Search
  SEARCH_TOP_K: 3,
  SEARCH_THRESHOLD: 0.6,
  PREVIEW_TURN_LIMIT: 5,

  // Storage
  MAX_BLACKLIST_ITEMS: 1000,
  MAX_BLOCKS_PER_SESSION: 300,
} as const;
```

---

#### 3. 프라이버시 레다크션 최적화 (3-4h)

**현재 문제**:
- 7개 정규식을 순차 실행
- 100개 메시지 기준 50ms 소요

**목표**:
- 단일 패스로 통합
- 50ms → 20ms (2.5배 향상)

**파일**:
- `src/privacy/pipeline.ts` 수정

---

#### 4. IndexedDB 쿼리 최적화 (4-6h)

**현재 문제**:
- 세션별 블록 조회 시 전체 스캔
- 1000개 블록 기준 느려질 가능성

**목표**:
- 인덱스 추가 (sessionUrl, timestamp)
- 페이지네이션 지원

**구현**:
```typescript
// 인덱스 추가
const store = db.createObjectStore('blocks', { keyPath: 'id' });
store.createIndex('sessionUrl', 'sessionUrl', { unique: false });
store.createIndex('timestamp', 'timestamp', { unique: false });

// 페이지네이션
const getBlocksPaginated = async (sessionUrl: string, page = 0, pageSize = 50) => {
  const offset = page * pageSize;
  // IDBKeyRange + cursor로 효율적 조회
};
```

---

#### 5. 검색 결과 캐싱 (2-3h)

**목표**: 동일 쿼리 반복 시 즉시 응답

**구현**:
```typescript
const searchCache = new Map<string, {
  query: string;
  results: SearchResult[];
  timestamp: number;
}>();

const search = async (query: string) => {
  const cacheKey = query.toLowerCase().trim();
  const cached = searchCache.get(cacheKey);

  // 5분 이내 캐시 재사용
  if (cached && Date.now() - cached.timestamp < 300000) {
    return cached.results;
  }

  // 새로 검색
  const results = await performSearch(query);
  searchCache.set(cacheKey, { query, results, timestamp: Date.now() });
  return results;
};
```

---

### v2.3.0 체크리스트

- [ ] 자동 로더 WeakMap 캐싱
- [ ] 매직 넘버 상수화
- [ ] 프라이버시 레다크션 단일 패스 통합
- [ ] IndexedDB 인덱스 추가
- [ ] 검색 결과 캐싱
- [ ] 성능 벤치마크 (before/after)
- [ ] 문서 업데이트

**예상 시간**: 14-21시간

---

## 🔮 v2.4.0+ - Power User Features (고급 기능)

**우선순위**: 🟢 LOW
**조건**: v2.3.0 완료 후 사용자 피드백 반영

### 계획 중인 기능

#### 1. Ollama 로컬 LLM 연동 (선택)

**목표**: 파워유저를 위한 로컬 임베딩 옵션

**장점**:
- 프라이버시 강화 (데이터 외부 전송 없음)
- 더 큰 모델 사용 가능
- 커스터마이징 가능

**구현**:
```typescript
const embeddingEngine = await createEmbeddingEngine({
  provider: 'ollama', // 또는 'browser'
  model: 'bge-m3',
  endpoint: 'http://localhost:11434',
});
```

**예상 시간**: 6-8시간

---

#### 2. 시간 기반 필터링

**목표**: 최근 3개월/6개월만 검색

**UI**:
```html
<select id="gmh-search-time-filter">
  <option value="all">전체 기간</option>
  <option value="3m">최근 3개월</option>
  <option value="6m">최근 6개월</option>
  <option value="1y">최근 1년</option>
</select>
```

**예상 시간**: 3-4시간

---

#### 3. 블록 태깅/분류

**목표**: 사용자가 블록에 태그 추가

**기능**:
- 수동 태그: #코딩, #일상, #아이디어
- 자동 태그: 토픽 모델링 (선택)

**예상 시간**: 8-10시간

---

#### 4. 검색 히스토리

**목표**: 이전 검색 기록 저장 및 재사용

**UI**:
```
최근 검색:
- "강아지 훈련 방법" (3일 전)
- "파이썬 비동기" (1주 전)
```

**예상 시간**: 2-3시간

---

#### 5. 내보내기/가져오기

**목표**: 블록 데이터 백업 및 복원

**기능**:
- JSON 형식으로 내보내기
- 다른 기기에서 가져오기

**예상 시간**: 4-5시간

---

## 📊 전체 요약

### 완료된 작업 (v2.5.0까지)

✅ **v2.0.0 TypeScript 전환**
- 54개 파일 TypeScript 마이그레이션
- strict mode 활성화
- 86개 테스트 통과

✅ **v2.1.0 Infrastructure**
- 실시간 메시지 인덱서 (MutationObserver)
- 5개 메시지 블록 빌더
- IndexedDB 저장소

✅ **v2.3.0 Multi-Platform**
- babechat.ai 지원
- API 기반 메시지 수집
- 프로젝트명 변경 (General Memory Helper)

✅ **v2.5.0 Tech Debt**
- 취약점 0개
- 테스트 159개 (+48개, +43%)

---

### 향후 작업 (Dual Memory)

| 마일스톤 | 핵심 목표 | 예상 시간 | 상태 |
|---------|----------|----------|------|
| **v3.0.0** | Dual Memory Core (청크화, 요약/Facts) | 20-30h | 🚧 개발 예정 |
| **v3.1.0** | UX Polish (진행 상태, 백업/복원) | 10-15h | 📋 계획됨 |
| **v3.2.0+** | Advanced (Ollama, 외부 API) | 15-25h | ⏸️ 보류 |

**총 예상**: 45-70시간 (v3.0.0 ~ v3.2.0)

---

## 🎯 성공 지표

### v3.0.0 성공 기준
- [ ] 100개 메시지 → 10개 청크 정상 생성
- [ ] 프롬프트 복사 → 외부 LLM → 결과 붙여넣기 워크플로우 동작
- [ ] 유저노트용 최종 출력 생성
- [ ] 기존 내보내기 기능과 공존

### v3.1.0 성공 기준
- [ ] 청크 완료 상태 시각적 표시
- [ ] JSON 백업/복원 동작
- [ ] 커스텀 프롬프트 저장/불러오기

### v3.2.0+ 성공 기준 (보류)
- [ ] Ollama 연동 시 자동 요약/Facts 생성
- [ ] 외부 API 연동 시 보안 경고 표시

---

## 📝 개발 원칙

### 점진적 통합
- 각 마일스톤은 독립적으로 테스트 가능
- Feature flag로 안정성 확보
- 롤백 가능한 구조 유지

### 사용자 경험 우선
- 모델 로딩: 프로그레스 바 필수
- 검색 실패: 명확한 에러 메시지
- 성능: 체감 지연 없음 (<100ms)

### 테스트 주도
- 각 기능마다 회귀 방지 테스트
- 성능 벤치마크 before/after
- 알파 테스터 피드백 필수

---

**문서 버전**: 4.0
**최종 업데이트**: 2025-12-01
**작성**: Claude Code
**다음 리뷰**: v3.0.0 (Dual Memory Core) 개발 착수 시
