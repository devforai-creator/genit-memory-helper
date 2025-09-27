# Role Classification & Parsing Heuristics

본 문서는 Genit Memory Helper의 **현재(2025-09-27 기준)** 역할 판정 및 파싱 로직을 정리한 것입니다. Tampermonkey 스크립트(`genit-memory-helper.user.js`)에서 DOM을 읽어 플레이어/어시스턴트/나레이션으로 분리하고, `parseTurns`로 턴 배열을 구축하는 흐름을 다룹니다.

## 1. DOM → Role 판정 개요

1. **DOM 수집**: `GMH.Adapters.genit.listMessageBlocks()`가 `div.space-y-3.mb-6` 형태의 메시지 래퍼를 전부 가져옵니다.
2. **역할 판정**: `detectRole(block)`이 아래 순서로 역할을 결정합니다.
   - `collectAll(selectors.playerScopes, block)`가 1개 이상이면 `player`.
   - 위가 아니고 `collectAll(selectors.npcGroups, block)`가 1개 이상이면 `npc`.
   - 그 외에는 `narration`.
3. **DOM 주석**: `MessageIndexer`가 위 반환값을 `data-gmh-message-role`과 `data-gmh-channel(user|llm)`에 저장하고, 모든 메시지 블록에 최신=1 방식의 `data-gmh-message-ordinal`을 부여합니다.

> 현재 구현은 tie-breaker가 없고, 스코어링 역시 적용되지 않습니다. 플레이어 스코프/어시스턴트 그룹이 동시에 붙은 블록은 우선순위(플레이어 → NPC)에 따라 결정됩니다.

### 1.1 `selectors` 요약

| 유형 | 주된 셀렉터 | 비고 |
| --- | --- | --- |
| `playerScopes` | `[data-role="user"]`, `[data-from-user="true"]`, `[data-author-role="user"]`, `.flex.w-full.justify-end`, `.flex.flex-col.items-end` | 래퍼/조상 방향으로 탐색 |
| `playerText` | `.space-y-3.mb-6 > .markdown-content:nth-of-type(1)`, `[data-role="user"] .markdown-content` 등 | muted 텍스트(`.text-muted-foreground`, `.bg-muted/50`)도 포함되도록 2025-09 정비 |
| `npcGroups` | `[data-role="assistant"]`, `.flex.flex-col.w-full.group` | GMH에서 NPC로 보는 컨테이너 |
| `narrationBlocks` | `.markdown-content.text-muted-foreground`, `.text-muted-foreground.text-sm` | 회색/메모 스타일 |
| `npcBubble` | `.p-4.rounded-xl.bg-background p`, `.markdown-content:not(.text-right)` | 어시스턴트 말풍선 |

## 2. `emit*Lines` 동작

### 2.1 플레이어 (`emitPlayerLines`)

1. `playerText` 셀렉터로 텍스트 노드 후보를 수집합니다. 후보가 없다면 `playerScopes`를 그대로 사용합니다.
2. 필터 조건
   - 플레이어 스코프 내부가 아니면 제외 (`closestMatchInList(playerScopes)`로 검증).
   - `narrationBlocks`, `npcGroups`, `npcBubble`, `infoCode`에 해당하면 제외.
3. 남은 노드의 텍스트를 `PLAYER_MARK (★)` + 내용으로 출력합니다.

> muted 회색 말풍선(`.text-muted-foreground`, `.bg-muted/50`)도 플레이어 텍스트로 수집됩니다. (2025-09-28 기준)

### 2.2 어시스턴트 (`emitNpcLines`)

1. `npcGroups` 내부의 발화, 이름(`npcName`)을 찾아 `@Speaker@ "…"` 형식으로 출력합니다.
2. `npcBubble`을 우선 사용하고, 없으면 그룹 전체 텍스트를 사용합니다.

### 2.3 내레이션 (`emitNarrationLines`)

1. `narrationBlocks`에 해당하는 회색 텍스트를 수집합니다.
2. NPC 스코프 안에 있으면 제외합니다.
3. 플레이어/어시스턴트와 같은 merge 규칙을 따릅니다.

## 3. `parseTurns` 요약

1. `readTranscriptText()`에서 HTML을 텍스트로 변환합니다.
 2. `parseTurns(raw)`가 줄 단위로 파싱하며 `pushTurn()`을 호출합니다.
   - 동일 화자·동일 역할이 연속이면 텍스트를 병합합니다 (내레이션도 병합 대상).
   - `PLAYER_MARK`가 붙은 경우 강제로 플레이어로 처리합니다.
 3. Meta/INFO/코드 라인은 `isMetaLine()` 등으로 걸러냅니다.
  4. 최종적으로 `session.turns` 배열과 `sceneId`, `metaHints` 등을 반환하며, 각 턴에는 `role`(기존 호환용)과 별도로 `channel`(`user`/`llm`) 속성이 추가됩니다.

## 4. Known Issues & 후속 과제

1. **회색 플레이어 행동/내적 독백**: 2025-09-28 기준, muted 스타일도 수집되지만 **추가로 등장한 새로운 muted 변형**이 생기면 셀렉터에 반영해야 합니다.
2. **오프닝 NPC 블록**: 대화 초반의 내레이션/어시스턴트 블록도 `data-gmh-message-ordinal`에 포함되지만, 메시지 전체를 불러오지 않으면 범위 계산이 어긋날 수 있습니다. 범위 지정 전에 원하는 구간까지 스크롤하여 메시지를 로드하세요.
3. **역할 중첩 해결 미흡**: 플레이어/어시스턴트 스코프가 중첩된 경우 tie-breaker가 없어 의도치 않은 분류가 발생할 수 있습니다.
4. **파서 병합 규칙**: 내레이션도 동일 화자가 연속이면 병합되므로, 블록 단위 보존을 원한다면 추가 refactoring이 필요합니다.

## 5. 참고 위치

- `genit-memory-helper.user.js`
  - `selectors` 정의: 약 130~160행
  - `detectRole`, `emitPlayerLines`, `emitNpcLines`, `emitNarrationLines`: 약 2700~2860행
  - `parseTurns`: 4080행대
- `docs/dom-genit-structure.md`: DOM 구조 및 역할 힌트 요약

필요 시 이 문서를 업데이트하고, 휴리스틱 변경 시 반드시 날짜와 근거를 기록해 주세요.
