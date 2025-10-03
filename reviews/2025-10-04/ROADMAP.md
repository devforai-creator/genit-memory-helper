# 미성년자 성적 맥락 감지 시스템 패치 로드맵

**작성자**: Claude (대표)
**기반 리뷰**: codex.md, grok.md, claude.md, claude-review.md
**최종 작성일**: 2025-10-04

---

## Executive Summary

### 현재 문제의 본질
`src/privacy/redaction.js`의 `hasMinorSexualContext` 함수는 전체 텍스트에서 미성년 키워드와 성적 키워드의 **단순 AND 조합**만 검사하여:
- ❌ **False Positive**: "고등학생의 성적(成績) 향상", "미성년자 성교육" 같은 정당한 표현 차단
- ❌ **False Negative**: 띄어쓰기 우회("고 등 학 생"), 은어("중딩", "고딩"), 원거리 키워드 매칭 누락

### 합의된 해결 방향
세 AI 에이전트(claude, codex, grok)의 제안을 종합한 결과:
1. **근접도 기반 검사** (슬라이딩 윈도우) - 키워드가 실제로 가까이 있을 때만 차단
2. **점수 기반 평가** - Boolean 대신 위험도 점수로 판단
3. **정당한 맥락 예외 처리** - 교육, 상담, 의료 등 안전한 문맥 구분
4. **운영 안정성 강화** - 로깅, 에러 핸들링, 테스트 대폭 확대

---

## Phase 1: 즉시 적용 (1-2일, v1.7.0)

### 목표
기존 구조 유지하면서 **가장 심각한 False Positive 제거**

### 구현 내용

#### 1.1 정당한 맥락 예외 패턴 추가
**파일**: `src/privacy/redaction.js`

```javascript
// 정당한 사용 패턴 (교육, 학업, 의료, 상담, 예방)
const LEGITIMATE_PATTERNS = [
  /성적\s*(향상|저하|관리|평가|우수|부진|분석|상승|하락)/gi,  // 학업 성적
  /성\s*(교육|상담|발달|정체성|소수자|평등|인지|지식)/gi,      // 성교육/정체성
  /성적\s*(지향|취향|매력|선호)/gi,                           // 성적 지향
  /(교육|예방|캠페인|세미나|강연|워크샵)\s*.*\s*(미성년|청소년)/gi,  // 교육 이벤트
  /(보호|지원|상담|치료|개입)\s*.*\s*(미성년|청소년)/gi,       // 보호 활동
];

export const hasMinorSexualContext = (text) => {
  if (!text) return false;

  // Step 1: 정당한 패턴이 있으면 즉시 false 반환
  if (LEGITIMATE_PATTERNS.some(pattern => pattern.test(text))) {
    return false;
  }

  // Step 2: 기존 키워드 검사
  return MINOR_KEYWORDS.test(text) && SEXUAL_KEYWORDS.test(text);
};
```

#### 1.2 누락된 연령 표현 추가
```javascript
const MINOR_KEYWORDS = /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18|중딩|고딩|중[1-3]|고[1-3]|(?:13|14|15|16|17)\s*살|teen(?:ager)?|underage)/gi;
```

#### 1.3 테스트 케이스 추가
**파일**: `tests/unit/privacy-redaction.spec.js`

```javascript
describe('hasMinorSexualContext - Phase 1 improvements', () => {
  // False Positive 제거 검증
  it('should allow legitimate educational content', () => {
    expect(hasMinorSexualContext('고등학생의 성적 향상 방법')).toBe(false);
    expect(hasMinorSexualContext('미성년자 성교육 프로그램 안내')).toBe(false);
    expect(hasMinorSexualContext('청소년 성정체성 상담 지원')).toBe(false);
    expect(hasMinorSexualContext('17세 학생의 성적 관리 노하우')).toBe(false);
  });

  // 새로운 패턴 감지 검증
  it('should detect new age expressions', () => {
    expect(hasMinorSexualContext('중딩이랑 성관계')).toBe(true);
    expect(hasMinorSexualContext('고딩 야한 사진')).toBe(true);
    expect(hasMinorSexualContext('15살 섹스')).toBe(true);
    expect(hasMinorSexualContext('teenager 음란물')).toBe(true);
  });

  // 기존 차단 유지 검증
  it('should still block obvious violations', () => {
    expect(hasMinorSexualContext('미성년자와 성관계')).toBe(true);
    expect(hasMinorSexualContext('고등학생 강간')).toBe(true);
  });
});
```

#### 1.4 로깅 추가 (디버깅 및 데이터 수집)
**파일**: `src/privacy/pipeline.js`

```javascript
const blocked = typeof hasMinorSexualContext === 'function' ? hasMinorSexualContext(rawText) : false;

// Phase 1 로깅 (Phase 2 튜닝을 위한 데이터 수집)
if (typeof ENV.console?.log === 'function' && (blocked || ENV.localStorage?.getItem('gmh_debug_blocking'))) {
  ENV.console.log('[GMH Privacy] Blocking decision:', {
    blocked,
    textLength: rawText?.length,
    hasMinor: /미성년|중학생|고등학생/.test(rawText),
    hasSexual: /성관계|섹스|성적/.test(rawText),
    timestamp: new Date().toISOString(),
  });
}
```

### 배포 기준
- ✅ 모든 테스트 통과
- ✅ 수동 QA: 10개 교육 콘텐츠 샘플 false positive 제로 확인
- ✅ 수동 QA: 10개 위험 콘텐츠 샘플 여전히 차단 확인

---

## Phase 2: 근접도 검사 도입 (3-5일, v1.8.0)

### 목표
**키워드 원거리 매칭 문제 해결** - 슬라이딩 윈도우로 실제 위험 조합만 감지

### 구현 내용

#### 2.1 근접도 기반 위험도 계산
**파일**: `src/privacy/redaction.js`

```javascript
const PROXIMITY_WINDOW = 100;  // 100자 윈도우 (데이터 기반 조정 예정)

const calculateProximityScore = (text) => {
  const minorMatches = [...text.matchAll(MINOR_KEYWORDS)];
  const sexualMatches = [...text.matchAll(SEXUAL_KEYWORDS)];

  if (!minorMatches.length || !sexualMatches.length) return 0;

  let maxScore = 0;

  for (const minor of minorMatches) {
    for (const sexual of sexualMatches) {
      const distance = Math.abs(minor.index - sexual.index);

      if (distance <= PROXIMITY_WINDOW) {
        // 윈도우 내 스니펫 추출
        const start = Math.max(0, Math.min(minor.index, sexual.index) - 20);
        const end = Math.max(minor.index, sexual.index) + 20;
        const snippet = text.slice(start, end);

        // 정당한 패턴 재검사 (윈도우 내에서)
        if (LEGITIMATE_PATTERNS.some(p => p.test(snippet))) {
          continue;  // 이 조합은 안전함
        }

        // 점수 계산 (거리가 가까울수록 높은 점수)
        const score = 100 - distance;
        maxScore = Math.max(maxScore, score);
      }
    }
  }

  return maxScore;
};

export const hasMinorSexualContext = (text) => {
  if (!text) return false;

  // 전역 정당한 패턴 체크
  if (LEGITIMATE_PATTERNS.some(pattern => pattern.test(text))) {
    return false;
  }

  const proximityScore = calculateProximityScore(text);
  return proximityScore > 30;  // 임계값 (데이터 기반 조정 예정)
};
```

#### 2.2 로깅 강화 (운영 모니터링)
```javascript
if (ENV.localStorage?.getItem('gmh_debug_blocking')) {
  ENV.console.log('[GMH Privacy] Proximity analysis:', {
    blocked,
    proximityScore,
    threshold: 30,
    snippet: proximityScore > 0 ? '...[snippet]...' : null,  // 디버깅용
  });
}
```

#### 2.3 테스트 확장
```javascript
it('should use proximity for detection', () => {
  // 키워드가 멀리 떨어진 경우 (false)
  const farApart = '미성년자 보호법 개정안. '.repeat(10) + '성적 소수자 인권 보장';
  expect(hasMinorSexualContext(farApart)).toBe(false);

  // 키워드가 가까운 경우 (true)
  const closeBy = '미성년자와의 성관계는 범죄입니다';
  expect(hasMinorSexualContext(closeBy)).toBe(true);
});
```

### 배포 기준
- ✅ Phase 1 테스트 + Phase 2 테스트 모두 통과
- ✅ 성능 벤치마크: 10,000자 텍스트 처리 < 50ms
- ✅ 1주일 베타 테스트 (로깅 데이터 분석, 임계값 조정)

---

## Phase 3: 점수 기반 종합 평가 (1주, v1.9.0)

### 목표
**유연한 위험도 판단** - 다양한 요소를 점수화하여 정확도 극대화

### 구현 내용

#### 3.1 위험도 점수 시스템
**파일**: `src/privacy/redaction.js`

```javascript
const calculateRiskScore = (text) => {
  let score = 0;
  const factors = [];  // 디버깅용 점수 구성 요소

  // Factor 1: 미성년 키워드 (+30)
  if (MINOR_KEYWORDS.test(text)) {
    score += 30;
    factors.push('MINOR_KW:+30');
  } else {
    return { score: 0, factors };  // 미성년 키워드 없으면 0점
  }

  // Factor 2: 성적 키워드 강도별 점수
  if (/(강간|성폭행|몰카|아청법|불법촬영)/gi.test(text)) {
    score += 50;
    factors.push('CRIME:+50');
  } else if (/(성관계|섹스|삽입|자위)/gi.test(text)) {
    score += 40;
    factors.push('EXPLICIT:+40');
  } else if (/(야한|음란|에로|19금|선정)/gi.test(text)) {
    score += 25;
    factors.push('SUGGESTIVE:+25');
  } else if (/성적/gi.test(text)) {
    score += 15;
    factors.push('AMBIGUOUS:+15');
  } else if (/sex/gi.test(text)) {
    score += 20;
    factors.push('ENGLISH_SEX:+20');
  }

  // Factor 3: 근접도 가중치
  const proximity = calculateProximityScore(text);
  if (proximity > 80) {
    score += 25;
    factors.push('VERY_CLOSE:+25');
  } else if (proximity > 50) {
    score += 15;
    factors.push('CLOSE:+15');
  } else if (proximity > 30) {
    score += 5;
    factors.push('NEAR:+5');
  }

  // Factor 4: 정당한 맥락 감점
  if (/(교육|상담|보호|예방|치료|법률|캠페인)/gi.test(text)) {
    score -= 30;
    factors.push('PROTECTIVE:-30');
  }
  if (/(성적\s*향상|학업|시험|평가|성적표)/gi.test(text)) {
    score -= 40;
    factors.push('ACADEMIC:-40');
  }
  if (/(의료|병원|진료|검사|처방)/gi.test(text)) {
    score -= 25;
    factors.push('MEDICAL:-25');
  }

  // Factor 5: 다수 출현 패턴 (반복 강조)
  const minorCount = (text.match(MINOR_KEYWORDS) || []).length;
  const sexualCount = (text.match(SEXUAL_KEYWORDS) || []).length;
  if (minorCount > 2 && sexualCount > 2) {
    score += 20;
    factors.push('REPEATED:+20');
  }

  return { score: Math.max(0, score), factors };  // 음수 방지
};

export const hasMinorSexualContext = (text) => {
  if (!text) return false;

  const { score, factors } = calculateRiskScore(text);
  const threshold = 70;  // 데이터 기반 조정 예정

  // 디버깅 모드 로깅
  if (ENV.localStorage?.getItem('gmh_debug_blocking')) {
    ENV.console.log('[GMH Privacy] Risk scoring:', {
      score,
      threshold,
      blocked: score >= threshold,
      factors: factors.join(', '),
    });
  }

  return score >= threshold;
};
```

#### 3.2 운영자 인터페이스 개선
**파일**: `src/privacy/pipeline.js`

```javascript
// blocked_details에 상세 정보 기록
const blockingResult = typeof hasMinorSexualContext === 'function'
  ? hasMinorSexualContext(rawText)
  : false;

return {
  profile: activeProfile,
  sanitizedSession,
  sanitizedRaw,
  structured: sanitizedStructured,
  playerNames: sanitizedPlayers,
  counts,
  totalRedactions,
  blocked: blockingResult,
  blocked_details: blockingResult ? {
    reason: 'minor_sexual_context',
    score: calculateRiskScore(rawText).score,  // Phase 3에서 노출
    factors: calculateRiskScore(rawText).factors,
    detected_at: new Date().toISOString(),
  } : null,
};
```

#### 3.3 테스트 강화
```javascript
describe('hasMinorSexualContext - Phase 3 scoring', () => {
  it('should score based on keyword severity', () => {
    // 강간 + 미성년 = 매우 높은 점수
    expect(hasMinorSexualContext('미성년자 강간 범죄')).toBe(true);

    // 성적(학업) + 미성년 + 교육 맥락 = 낮은 점수
    expect(hasMinorSexualContext('미성년자 성적 향상 교육 프로그램')).toBe(false);
  });

  it('should handle mixed context correctly', () => {
    // 경계선 케이스: 의료 상담 (점수: 30+15-25 = 20 < 70)
    expect(hasMinorSexualContext('17세 청소년 성적 발달 의료 상담')).toBe(false);

    // 명백한 위험: 성관계 언급 (점수: 30+40+15 = 85 > 70)
    expect(hasMinorSexualContext('17세와 성관계 시도')).toBe(true);
  });
});
```

### 배포 기준
- ✅ 모든 Phase 1-3 테스트 통과
- ✅ A/B 테스트: 기존 버전 vs 신규 버전 정확도 비교
- ✅ 사용자 피드백: 2주간 오탐 신고 < 5건

---

## Phase 4: 운영 안정성 및 모니터링 (3-5일, v1.9.1)

### 목표
**장기 운영 품질 보장** - 에러 핸들링, 대시보드, 사용자 피드백 루프

### 구현 내용

#### 4.1 에러 핸들링 강화
**파일**: `src/privacy/pipeline.js`

```javascript
try {
  const blocked = typeof hasMinorSexualContext === 'function'
    ? hasMinorSexualContext(rawText)
    : false;

  // ... 기존 로직
} catch (error) {
  // grok 제안: error-handler 통합
  if (typeof ENV.console?.error === 'function') {
    ENV.console.error('[GMH Privacy] Blocking check failed:', error);
  }

  // 기본값: 차단하지 않음 (false negative보다 false positive가 나음)
  return {
    // ...
    blocked: false,
    blocked_details: {
      error: error.message,
      fallback: true,
    },
  };
}
```

#### 4.2 사용자 피드백 수집
**파일**: `src/ui/privacy-gate.js` (모달에 피드백 버튼 추가)

```javascript
// Privacy Gate 모달에 "오탐 신고" 버튼 추가
const feedbackButton = `
  <button id="gmh-report-false-positive" style="...">
    이 차단이 잘못되었다면 신고
  </button>
`;

// 클릭 시 로컬에 기록 (향후 분석용)
document.getElementById('gmh-report-false-positive')?.addEventListener('click', () => {
  const reports = JSON.parse(ENV.localStorage.getItem('gmh_false_positive_reports') || '[]');
  reports.push({
    timestamp: Date.now(),
    textHash: simpleHash(rawText),  // 개인정보 보호
    score: blocked_details?.score,
  });
  ENV.localStorage.setItem('gmh_false_positive_reports', JSON.stringify(reports.slice(-50)));
  alert('신고가 기록되었습니다. 다음 업데이트에 반영하겠습니다.');
});
```

#### 4.3 문서 업데이트
**파일**: `README.md`, `PRIVACY.md`, `docs/role-classification-heuristics.md`

- 점수 기반 차단 로직 설명 추가
- 정당한 맥락 예외 패턴 리스트 공개
- 오탐 신고 방법 안내

### 배포 기준
- ✅ 에러 핸들링 테스트 (잘못된 입력에도 크래시 없음)
- ✅ 피드백 수집 1개월 운영 후 데이터 리뷰

---

## Phase 5: 데이터 기반 최적화 (지속적)

### 목표
**실사용 데이터로 파라미터 튜닝**

### 작업 내용
1. **임계값 조정**
   - Phase 3 점수 threshold (현재 70) 조정
   - Phase 2 근접도 윈도우 (현재 100자) 조정
   - 실제 차단/통과 사례 분석 후 최적화

2. **키워드 업데이트**
   - 사용자 피드백 기반 은어/신조어 추가
   - 정당한 패턴에 새로운 교육/의료 용어 추가

3. **성능 최적화**
   - 대용량 텍스트(10,000자+) 처리 시간 모니터링
   - 필요시 캐싱, 조기 종료 로직 추가

---

## 우선순위 및 일정

| Phase | 예상 소요 | 배포 버전 | 우선순위 | 담당 |
|-------|----------|----------|---------|------|
| Phase 1 | 1-2일 | v1.7.0 | ⚡ 최우선 | All |
| Phase 2 | 3-5일 | v1.8.0 | 🔥 긴급 | codex + claude |
| Phase 3 | 1주 | v1.9.0 | 📈 중요 | claude |
| Phase 4 | 3-5일 | v1.9.1 | 🛡️ 안정성 | grok + claude |
| Phase 5 | 지속 | v1.9.x | 🔧 유지보수 | All |

**총 예상 소요 기간**: 3주 (긴급 대응 포함)

---

## 성공 지표 (KPI)

### Phase 1 완료 시
- ✅ False Positive 감소율 > 80% (교육 콘텐츠 기준)
- ✅ 모든 테스트 통과
- ✅ 기존 차단 케이스 유지율 100%

### Phase 2 완료 시
- ✅ False Negative 감소율 > 60% (원거리 키워드 기준)
- ✅ 처리 성능 저하 < 20%
- ✅ 베타 테스트 오탐 신고 < 10건/주

### Phase 3 완료 시
- ✅ 종합 정확도 > 95%
- ✅ A/B 테스트 승률 > 기존 버전
- ✅ 사용자 만족도 > 4/5

### Phase 4 완료 시
- ✅ 운영 중 크래시 0건
- ✅ 피드백 수집 > 100건 (데이터 확보)

---

## 리스크 및 대응 방안

### Risk 1: Phase 3 점수 시스템 복잡도
**완화책**: Phase 1-2에서 충분한 개선 효과가 나오면 Phase 3는 선택적 적용

### Risk 2: 성능 저하
**완화책**:
- 조기 종료 로직 (미성년 키워드 없으면 즉시 false 반환)
- 정규식 최적화
- 캐싱 (동일 텍스트 재검사 방지)

### Risk 3: 우회 기법 진화
**완화책**: Phase 5 지속적 모니터링, 커뮤니티 피드백 수집

---

## 최종 권고사항

### 즉시 착수 (This Week)
**Phase 1을 최우선으로 구현하여 현재 가장 큰 불만(교육 콘텐츠 차단)을 해소하세요.**

이유:
- 구현 간단 (1-2일 완료 가능)
- 즉각적인 사용자 경험 개선
- 리스크 최소 (기존 구조 유지)

### 중기 목표 (Next 2 Weeks)
**Phase 2 근접도 검사로 기술적 완성도를 높이세요.**

이유:
- codex 제안의 핵심 가치
- 원거리 키워드 매칭 문제 근본 해결
- Phase 3의 기반 구축

### 장기 전략 (Next Month)
**Phase 3-4로 운영 품질과 사용자 신뢰를 확보하세요.**

이유:
- grok 제안의 운영 안정성 강조
- 사용자 피드백 루프 구축
- 데이터 기반 지속 개선 체계 마련

---

## 기여자 크레딧

- **Claude**: 전체 로드맵 설계, Phase 1-3 상세 구현 방안
- **Codex**: 슬라이딩 윈도우 개념, 점수 체계 아이디어, 후속 작업 제안
- **Grok**: 운영 안정성 강조, 에러 핸들링, 테스트 중요성 환기

---

**다음 단계**: Phase 1 구현 시작 → `src/privacy/redaction.js` 수정 → 테스트 작성 → PR 생성
