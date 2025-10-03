import { describe, it, expect } from 'vitest';
import {
  redactText,
  hasMinorSexualContext,
  formatRedactionCounts,
  PRIVACY_PROFILES,
} from '../../src/privacy/index.js';

const createConfig = (overrides = {}) => ({
  blacklist: [],
  whitelist: [],
  ...overrides,
});

describe('Privacy redaction pipeline', () => {
  it('SAFE profile redacts PII, address hints, and sensitive keywords', () => {
    const counts = {};
    const input = '연락처 test@example.com, 010-1234-5678, 서울시 강남대로 123-45, 자살 언급';

    const redacted = redactText(input, 'safe', counts, createConfig(), PRIVACY_PROFILES);

    expect(redacted).not.toContain('test@example.com');
    expect(redacted).not.toContain('010-1234-5678');
    expect(redacted).not.toContain('강남대로 123-45');
    expect(redacted).not.toContain('자살');
    expect(redacted).toContain('[REDACTED:EMAIL]');
    expect(redacted).toContain('[REDACTED:PHONE]');
    expect(redacted).toContain('[REDACTED:ADDR]');
    expect(redacted).toContain('[REDACTED:SENSITIVE]');
    expect(counts.EMAIL).toBe(1);
    expect(counts.PHONE).toBe(1);
    expect(counts.ADDR).toBeGreaterThan(0);
    expect(counts.SENSITIVE).toBeGreaterThan(0);
  });

  it('STANDARD profile keeps address hints and narrative keywords intact', () => {
    const counts = {};
    const input = '연락처 test@example.com, 010-1234-5678, 서울시 강남대로 123-45, 자살 언급';

    const redacted = redactText(input, 'standard', counts, createConfig(), PRIVACY_PROFILES);

    expect(redacted).not.toContain('test@example.com');
    expect(redacted).not.toContain('010-1234-5678');
    expect(redacted).toContain('강남대로 123-45');
    expect(redacted).toContain('자살');
    expect(counts.EMAIL).toBe(1);
    expect(counts.PHONE).toBe(1);
    expect(counts.ADDR).toBeUndefined();
    expect(counts.SENSITIVE).toBeUndefined();
  });

  it('applies custom blacklist terms case-insensitively', () => {
    const counts = {};
    const config = createConfig({ blacklist: ['기밀문서', 'Secret token'] });
    const input = '기밀문서와 secret TOKEN은 차단 대상입니다.';

    const redacted = redactText(input, 'safe', counts, config, PRIVACY_PROFILES);

    expect(redacted).toContain('[REDACTED:CUSTOM]');
    expect(redacted).not.toContain('기밀문서');
    expect(redacted).not.toContain('secret TOKEN');
    expect(counts.CUSTOM).toBe(2);
  });

  it('respects whitelist to keep approved terms', () => {
    const counts = {};
    const config = createConfig({ whitelist: ['whitelist@example.com'] });
    const input = 'whitelist@example.com 과 block@example.com 둘 다 확인';

    const redacted = redactText(input, 'safe', counts, config, PRIVACY_PROFILES);

    expect(redacted).toContain('whitelist@example.com');
    expect(redacted).not.toContain('block@example.com');
    expect(counts.EMAIL).toBe(1);
  });

  describe('hasMinorSexualContext guardrails', () => {
    it('does not break on repeated calls (global regex bug)', () => {
      const text = '미성년자 성교육';
      expect(hasMinorSexualContext(text)).toBe(false);
      expect(hasMinorSexualContext(text)).toBe(false);
      expect(hasMinorSexualContext(text)).toBe(false);
    });

    it('allows legitimate educational or rights-focused content', () => {
      expect(hasMinorSexualContext('고등학생의 성적 향상 방법')).toBe(false);
      expect(hasMinorSexualContext('미성년자 성교육 프로그램 안내')).toBe(false);
      expect(hasMinorSexualContext('청소년 성정체성 상담 지원')).toBe(false);
      expect(hasMinorSexualContext('미성년자 성적 자기결정권 교육')).toBe(false);
      expect(hasMinorSexualContext('청소년의 성적 자기결정권 존중')).toBe(false);
    });

    it('blocks attempts that mix legitimate wording with explicit danger', () => {
      expect(hasMinorSexualContext('미성년자 강간 교육 자료')).toBe(true);
      expect(hasMinorSexualContext('미성년자 성교육 자료 야한 사진')).toBe(true);
      expect(hasMinorSexualContext('청소년 성상담 음란 영상')).toBe(true);
    });

    it('detects expanded age expressions and slang', () => {
      expect(hasMinorSexualContext('중딩이랑 성관계')).toBe(true);
      expect(hasMinorSexualContext('고딩 야한 사진')).toBe(true);
      expect(hasMinorSexualContext('15살 섹스')).toBe(true);
      expect(hasMinorSexualContext('teenager 음란물')).toBe(true);
    });
  });

  it('summarises redaction counts for privacy gate', () => {
    const summary = formatRedactionCounts({ EMAIL: 2, PHONE: 1, CUSTOM: 0, ADDR: 3 });
    expect(summary).toBe('EMAIL:2, PHONE:1, ADDR:3');
    expect(formatRedactionCounts({})).toBe('레다크션 없음');
  });
});
