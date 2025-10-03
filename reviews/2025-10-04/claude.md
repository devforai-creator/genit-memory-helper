# 성적 맥락 감지 시스템 패치 제안 - Claude

**작성일**: 2025-10-04
**대상 기능**: `hasMinorSexualContext` (src/privacy/redaction.js:117-123)

## 현재 문제점 분석

### 1. 현재 구현
```javascript
const MINOR_KEYWORDS = /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18)/i;
const SEXUAL_KEYWORDS = /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/i;

export const hasMinorSexualContext = (text) => {
  if (!text) return false;
  return MINOR_KEYWORDS.test(text) && SEXUAL_KEYWORDS.test(text);
};
```

### 2. 오작동 사례 (예상)

#### False Positives (거짓 양성)
- ❌ "고등학생의 **성적** 향상을 위한 학습법" → 차단됨 (학업 성적)
- ❌ "17세 청소년의 **성적** 정체성 고민" → 차단됨 (정체성 관련)
- ❌ "미성년자 **성** 교육 프로그램" → 차단됨 (교육적 맥락)
- ❌ "소녀시대가 **섹**시한 컨셉으로" → 차단됨 (연예/문화)

#### False Negatives (거짓 음성)
- ✅ "17 살 여학생 야 한 사진" → 통과됨 (띄어쓰기 우회)
- ✅ "중딩이랑 19금 썸" → 통과됨 (은어 사용)
- ✅ "고딩 몸매 개꼴림" → 통과됨 (키워드 외 표현)

### 3. 근본 원인
- **맥락 무시**: 단순 키워드 AND 조합으로 문맥을 파악하지 못함
- **정당한 사용 차단**: "성적(成績)", "성(性)교육" 등 정상적인 표현도 필터링
- **우회 가능성**: 띄어쓰기, 은어, 변형 표현에 취약

---

## 패치 방안

### 옵션 1: 정밀한 예외 패턴 추가 (권장 - 빠른 적용)

**장점**: 기존 구조 유지, 즉시 배포 가능
**단점**: 완벽한 해결은 아님

```javascript
const MINOR_KEYWORDS = /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18)/i;
const SEXUAL_KEYWORDS = /(성관계|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/i;

// 정당한 사용 패턴 (교육, 학업, 의료 등)
const LEGITIMATE_PATTERNS = [
  /성적\s*(향상|저하|관리|평가|우수|부진|분석)/i,  // 학업 성적
  /성\s*(교육|상담|발달|정체성|소수자|평등)/i,     // 성교육, 정체성
  /성적\s*(지향|취향|매력)/i,                      // 성적 지향
];

export const hasMinorSexualContext = (text) => {
  if (!text) return false;

  // 정당한 패턴이 있으면 차단하지 않음
  if (LEGITIMATE_PATTERNS.some(pattern => pattern.test(text))) {
    return false;
  }

  return MINOR_KEYWORDS.test(text) && SEXUAL_KEYWORDS.test(text);
};
```

### 옵션 2: 근접도 기반 검사 (중기 - 정확도 향상)

**장점**: 맥락 고려, 오탐률 감소
**단점**: 복잡도 증가, 성능 저하 가능

```javascript
const hasMinorSexualContext = (text) => {
  if (!text) return false;

  const minorMatches = [...text.matchAll(MINOR_KEYWORDS)];
  const sexualMatches = [...text.matchAll(SEXUAL_KEYWORDS)];

  if (!minorMatches.length || !sexualMatches.length) return false;

  // 두 키워드가 50자 이내에 있을 때만 차단
  const PROXIMITY_THRESHOLD = 50;

  for (const minor of minorMatches) {
    for (const sexual of sexualMatches) {
      const distance = Math.abs(minor.index - sexual.index);
      if (distance <= PROXIMITY_THRESHOLD) {
        // 정당한 패턴 재검사
        const snippet = text.slice(
          Math.max(0, Math.min(minor.index, sexual.index) - 20),
          Math.max(minor.index, sexual.index) + 20
        );
        if (!LEGITIMATE_PATTERNS.some(p => p.test(snippet))) {
          return true;
        }
      }
    }
  }

  return false;
};
```

### 옵션 3: 점수 기반 종합 평가 (장기 - 최고 정확도)

**장점**: 유연한 임계값 조정, 확장 가능
**단점**: 유지보수 복잡, 튜닝 필요

```javascript
const calculateRiskScore = (text) => {
  let score = 0;

  // 미성년 키워드 (+30점)
  if (MINOR_KEYWORDS.test(text)) score += 30;

  // 성적 키워드 강도별 점수
  if (/(강간|성폭행|몰카)/i.test(text)) score += 50;     // 명백한 범죄
  if (/(성관계|섹스|삽입)/i.test(text)) score += 40;     // 직접적 성행위
  if (/(야한|음란|에로)/i.test(text)) score += 25;       // 암시적 표현
  if (/성적/i.test(text)) score += 15;                   // 모호한 단어

  // 정당한 맥락 감점
  if (/(교육|상담|보호|예방|치료)/i.test(text)) score -= 30;
  if (/(성적\s*향상|학업|시험)/i.test(text)) score -= 40;

  // 근접도 가중치
  const proximity = checkProximity(text, MINOR_KEYWORDS, /(강간|성폭행|섹스)/i);
  if (proximity < 30) score += 20;  // 매우 가까우면 위험도 증가

  return score;
};

export const hasMinorSexualContext = (text) => {
  if (!text) return false;
  const score = calculateRiskScore(text);
  return score >= 70;  // 임계값 조정 가능
};
```

---

## 테스트 강화 제안

`tests/unit/privacy-redaction.spec.js`에 추가할 케이스:

```javascript
describe('hasMinorSexualContext - edge cases', () => {
  it('should allow legitimate educational content', () => {
    expect(hasMinorSexualContext('고등학생의 성적 향상 방법')).toBe(false);
    expect(hasMinorSexualContext('미성년자 성교육 프로그램')).toBe(false);
    expect(hasMinorSexualContext('17세 청소년 성정체성 고민')).toBe(false);
  });

  it('should detect spaced-out evasion attempts', () => {
    expect(hasMinorSexualContext('고 등 학 생 성 관 계')).toBe(true);
    expect(hasMinorSexualContext('중학생 야 한 사진')).toBe(true);
  });

  it('should detect slang and variants', () => {
    expect(hasMinorSexualContext('중딩이랑 19금 썸')).toBe(true);
    expect(hasMinorSexualContext('고딩 몸매 개꼴림')).toBe(true);
  });
});
```

---

## 배포 전략

1. **Phase 1**: 옵션 1 적용 + 로깅 추가
   - 기존 차단 + 새 예외 패턴 적용
   - 차단/통과 로그를 수집하여 오탐률 측정

2. **Phase 2**: 데이터 분석 후 옵션 2/3 선택
   - 로그 분석으로 false positive/negative 비율 확인
   - 성능 요구사항에 따라 옵션 2 또는 3 선택

3. **Phase 3**: A/B 테스트
   - 기존 버전과 신규 버전 동시 실행
   - 정확도 비교 후 전환

---

## 권장 사항

**즉시 적용**: 옵션 1 (정밀한 예외 패턴)
**이유**:
- 가장 큰 불편 요소(학업 성적, 성교육)를 빠르게 해결
- 기존 코드 구조 유지로 리스크 최소화
- 테스트 추가만으로 검증 가능

**중장기 고도화**: 옵션 2 (근접도 검사)
**이유**:
- 옵션 3은 over-engineering 위험
- 근접도 검사로도 충분한 정확도 확보 가능
- 성능 영향 최소화

---

## 참고 사항

- 현재 함수는 `src/privacy/pipeline.js:179`에서 `blocked` 플래그로만 사용됨
- `blocked: true`일 때 실제 차단 동작은 확인 필요 (UI 경고? 내보내기 차단?)
- 사용자 피드백 수집 메커니즘 추가 권장 (오탐 신고 기능)
