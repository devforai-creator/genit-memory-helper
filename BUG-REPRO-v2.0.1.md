# v2.0.1 버그 재현 시나리오

**버그 ID**: #1
**우선순위**: High
**발견 일시**: 2025-10-09
**테스트 환경**: Edge 브라우저, v2.0.0

---

## 버그: 범위 입력 필드 미작동

### 증상
"시작"과 "끝" 입력 필드에 숫자를 입력해도 범위가 업데이트되지 않음

### 재현 단계

1. **환경 준비**
   ```
   - genit.ai 대화 페이지 접속
   - GMH 패널 열기 (Modern UI)
   - 자동 로더로 메시지 10개 이상 로드
   ```

2. **"시작" 필드 테스트**
   ```
   a. "내보내기 범위" 섹션의 "시작" 입력란 클릭
   b. 숫자 "5" 입력
   c. Enter 키 또는 필드 외부 클릭 (blur)

   예상: 범위 요약이 "최근 메시지 5-X"로 업데이트
   실제: 아무 변화 없음
   ```

3. **"끝" 필드 테스트**
   ```
   a. "내보내기 범위" 섹션의 "끝" 입력란 클릭
   b. 숫자 "10" 입력
   c. Enter 키 또는 필드 외부 클릭 (blur)

   예상: 범위 요약이 "최근 메시지 X-10"로 업데이트
   실제: 아무 변화 없음
   ```

4. **북마크 버튼은 정상 작동 확인**
   ```
   a. 메시지 클릭 후 "여기를 시작으로" 버튼 클릭
   → 정상 작동 (범위가 업데이트됨)
   ```

### 영향 범위
- ✅ 북마크 버튼: 정상 작동
- ❌ 시작 입력 필드: 미작동
- ❌ 끝 입력 필드: 미작동
- ✅ 범위 초기화: 정상 작동

### 콘솔 로그
```
(버그 발생 시 특정 에러 메시지 없음)
```

---

## 코드 분석

### 의심 지점 #1: Optional Chaining
**파일**: `src/ui/range-controls.ts:224, 235`

```typescript
exportRange?.setStart?.(value);  // ← 조용히 실패 가능
exportRange?.setEnd?.(value);    // ← 조용히 실패 가능
```

**가설**:
- `exportRange` 객체가 존재하지 않거나
- `setStart`/`setEnd` 메서드가 없거나
- TypeScript strict mode에서 타입 불일치

**검증 필요**:
```javascript
// 브라우저 콘솔에서 확인
console.log(typeof exportRange);
console.log(typeof exportRange?.setStart);
```

---

### 의심 지점 #2: toNumber 로직
**파일**: `src/ui/range-controls.ts:34-37`

```typescript
const toNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
```

**가설**:
- 입력값이 빈 문자열일 때 `Number('')`는 `0` 반환
- `Number.isFinite(0)`은 `true`이므로 `0` 반환
- But: `if (value && value > 0)` 조건에서 `0`은 falsy → 실행 안 됨

**Edge Case**:
```javascript
toNumber('')    // → 0 (falsy, 조건 통과 안 함)
toNumber('0')   // → 0 (falsy, 조건 통과 안 함)
toNumber('5')   // → 5 (truthy, 조건 통과)
toNumber('abc') // → null (falsy, 조건 통과 안 함)
```

이 부분은 정상으로 보임.

---

### 의심 지점 #3: 이벤트 리스너 등록 실패
**파일**: `src/ui/range-controls.ts:242-251`

```typescript
if (rangeStartInput && rangeStartInput.dataset.gmhRangeReady !== 'true') {
  rangeStartInput.dataset.gmhRangeReady = 'true';
  rangeStartInput.addEventListener('change', handleStartChange);
  rangeStartInput.addEventListener('blur', handleStartChange);
}
```

**가설**:
- `rangeStartInput`이 null
- `dataset.gmhRangeReady`가 이미 'true' (중복 등록 방지)
- TypeScript 전환 시 이벤트 핸들러 타입 문제

**검증 필요**:
```javascript
// 브라우저 콘솔에서 확인
const input = document.querySelector('#gmh-range-start');
console.log(input);  // null이면 선택자 문제
console.log(input?.dataset?.gmhRangeReady);
```

---

### 의심 지점 #4: TypeScript Strict Mode
**파일**: `tsconfig.json`

v2.0.0에서 `"strict": true` 활성화됨. 가능한 부작용:
- `strictNullChecks`: null/undefined 처리 엄격화
- `strictFunctionTypes`: 함수 타입 불일치
- `strictBindCallApply`: 이벤트 핸들러 this 바인딩

**검증 필요**:
- `exportRange` 타입 정의 확인
- 이벤트 핸들러 시그니처 확인

---

## 디버깅 체크리스트

### Phase 1: 브라우저 콘솔 확인
- [ ] `document.querySelector('#gmh-range-start')` 존재 여부
- [ ] `exportRange` 객체 존재 및 타입
- [ ] `exportRange.setStart` 함수 존재 여부
- [ ] 이벤트 리스너 등록 확인 (`getEventListeners(input)` - Chrome DevTools)

### Phase 2: 로그 추가
```typescript
const handleStartChange = (): void => {
  console.log('[GMH DEBUG] handleStartChange called');
  if (!rangeStartInput) {
    console.log('[GMH DEBUG] rangeStartInput is null');
    return;
  }
  const value = toNumber(rangeStartInput.value);
  console.log('[GMH DEBUG] parsed value:', value);
  if (value && value > 0) {
    console.log('[GMH DEBUG] calling setStart with:', value);
    exportRange?.setStart?.(value);
  } else {
    console.log('[GMH DEBUG] clearing start');
    exportRange?.setStart?.(null);
    rangeStartInput.value = '';
  }
};
```

### Phase 3: 타입 정의 확인
- [ ] `src/types/index.ts`에서 `ExportRangeController` 인터페이스 확인
- [ ] `setStart`, `setEnd` 메서드 시그니처 확인
- [ ] Optional vs Required 속성 확인

---

## 예상 원인 (우선순위 순)

1. **High**: `exportRange` 객체가 제대로 주입되지 않음
   - `createRangeControls` 호출 시 인자 누락 또는 타입 불일치

2. **Medium**: TypeScript strict mode에서 타입 불일치
   - `exportRange` 타입이 실제와 다름
   - Optional chaining이 예상과 다르게 동작

3. **Low**: 이벤트 리스너 등록 타이밍 문제
   - DOM이 준비되기 전에 `bindRangeControls` 호출
   - React/SPA 라우팅으로 인한 엘리먼트 재생성

---

## 수정 방향

### 옵션 A: Optional Chaining 제거 + 명시적 에러 처리
```typescript
const handleStartChange = (): void => {
  if (!rangeStartInput) return;

  // 명시적 검증
  if (!exportRange || typeof exportRange.setStart !== 'function') {
    console.error('[GMH] exportRange.setStart is not available');
    return;
  }

  const value = toNumber(rangeStartInput.value);
  if (value && value > 0) {
    exportRange.setStart(value);  // Optional chaining 제거
  } else {
    exportRange.setStart(null);
    rangeStartInput.value = '';
  }
};
```

### 옵션 B: 디버그 로그 + 조건부 실행
```typescript
const handleStartChange = (): void => {
  if (!rangeStartInput) {
    if (typeof console?.warn === 'function') {
      console.warn('[GMH] rangeStartInput not found');
    }
    return;
  }

  const value = toNumber(rangeStartInput.value);
  const hasSetStart = exportRange && typeof exportRange.setStart === 'function';

  if (!hasSetStart) {
    if (typeof console?.warn === 'function') {
      console.warn('[GMH] exportRange.setStart not available', { exportRange });
    }
    return;
  }

  if (value && value > 0) {
    exportRange.setStart(value);
  } else {
    exportRange.setStart(null);
    rangeStartInput.value = '';
  }
};
```

### 옵션 C: 타입 단언 추가
```typescript
const handleStartChange = (): void => {
  if (!rangeStartInput) return;
  const value = toNumber(rangeStartInput.value);

  // exportRange가 필수임을 단언
  if (value && value > 0) {
    (exportRange as ExportRangeController).setStart(value);
  } else {
    (exportRange as ExportRangeController).setStart(null);
    rangeStartInput.value = '';
  }
};
```

---

## 다음 단계

1. ✅ 재현 시나리오 문서 작성 (현재 문서)
2. ⏳ v2.0.1 브랜치 생성
3. ⏳ 브라우저 콘솔 디버깅 (Phase 1)
4. ⏳ 로그 추가 후 재현 (Phase 2)
5. ⏳ 타입 정의 확인 (Phase 3)
6. ⏳ 수정 적용 (옵션 A/B/C 중 선택)
7. ⏳ 회귀 테스트 케이스 작성
8. ⏳ Vitest/Playwright 실행
9. ⏳ 수동 검증
10. ⏳ 커밋 및 릴리스

---

**작성자**: Claude Code
**검토자**: (대기)
**상태**: 재현 시나리오 작성 완료, 디버깅 대기
