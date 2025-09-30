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

  it('detects minor sexual context combinations', () => {
    expect(hasMinorSexualContext('미성년자와 성적 접촉')).toBe(true);
    expect(hasMinorSexualContext('성적 내용만 언급')).toBe(false);
    expect(hasMinorSexualContext('미성년자 보호 교육')).toBe(false);
  });

  it('summarises redaction counts for privacy gate', () => {
    const summary = formatRedactionCounts({ EMAIL: 2, PHONE: 1, CUSTOM: 0, ADDR: 3 });
    expect(summary).toBe('EMAIL:2, PHONE:1, ADDR:3');
    expect(formatRedactionCounts({})).toBe('레다크션 없음');
  });
});
