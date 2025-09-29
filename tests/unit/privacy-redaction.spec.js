import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

// Create GMH instance with JSDOM environment
function createGMH() {
  const script = readFileSync(distPath, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://genit.ai/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.GM_setClipboard = () => {};
  window.alert = () => {};
  window.confirm = () => true;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.unsafeWindow = window;
  if (!window.MutationObserver) {
    window.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
  }
  window.eval(script);
  return { GMH: window.GMH, window };
}

describe('Privacy Redaction', () => {
  let GMH;
  let window;

  beforeEach(() => {
    ({ GMH, window } = createGMH());
  });

  describe('Email Redaction', () => {
    it('should redact email addresses', () => {
      const input = '연락처는 test@example.com입니다';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('test@example.com');
      expect(output).toContain('[REDACTED:EMAIL]');
      expect(counts.EMAIL).toBe(1);
    });

    it('should redact multiple email addresses', () => {
      const input = '이메일: user@test.com, admin@site.org';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('user@test.com');
      expect(output).not.toContain('admin@site.org');
      expect(counts.EMAIL).toBe(2);
    });

    it('should handle email-like patterns that are not emails', () => {
      const input = 'not-an-email@incomplete';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      // Pattern without valid TLD should not be redacted as email
      // But @incomplete is redacted as a handle (expected behavior)
      expect(output).not.toContain('@incomplete');
      expect(counts.EMAIL).toBeUndefined();
      expect(counts.HANDLE).toBe(1);
    });
  });

  describe('Phone Number Redaction', () => {
    it('should redact Korean phone numbers (010-1234-5678)', () => {
      const input = '전화번호: 010-1234-5678';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('010-1234-5678');
      expect(output).toContain('[REDACTED:PHONE]');
      expect(counts.PHONE).toBe(1);
    });

    it('should redact Korean phone numbers without hyphens (01012345678)', () => {
      const input = '연락처 01012345678';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('01012345678');
      expect(output).toContain('[REDACTED:PHONE]');
      expect(counts.PHONE).toBe(1);
    });

    it('should redact international phone numbers', () => {
      const input = 'Call me at +82 10 1234 5678';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('+82 10 1234 5678');
      expect(output).toContain('[REDACTED:PHONE]');
      expect(counts.PHONE).toBe(1);
    });
  });

  describe('Resident Registration Number (RRN) Redaction', () => {
    it('should redact RRN with hyphen', () => {
      const input = '주민번호: 990101-1234567';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('990101-1234567');
      expect(output).toContain('[REDACTED:RRN]');
      expect(counts.RRN).toBe(1);
    });

    it('should redact RRN without hyphen', () => {
      const input = '9901011234567';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('9901011234567');
      expect(output).toContain('[REDACTED:RRN]');
      expect(counts.RRN).toBe(1);
    });
  });

  describe('Credit Card Number Redaction', () => {
    it('should redact valid credit card numbers', () => {
      // Valid test card number (Luhn check passes)
      const input = '카드번호: 4532015112830366';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('4532015112830366');
      expect(output).toContain('[REDACTED:CARD]');
      expect(counts.CARD).toBe(1);
    });

    it('should not redact invalid card numbers (Luhn check fails)', () => {
      const input = '1234567890123456'; // Invalid Luhn
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      // Should not redact since Luhn validation fails
      expect(counts.CARD).toBeUndefined();
    });

    it('should redact card numbers with spaces', () => {
      const input = '4532 0151 1283 0366';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('4532 0151 1283 0366');
      expect(output).toContain('[REDACTED:CARD]');
      expect(counts.CARD).toBe(1);
    });
  });

  describe('IP Address Redaction', () => {
    it('should redact IPv4 addresses', () => {
      const input = 'Server IP: 192.168.1.100';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('192.168.1.100');
      expect(output).toContain('[REDACTED:IP]');
      expect(counts.IP).toBe(1);
    });

    it('should redact multiple IP addresses', () => {
      const input = '10.0.0.1 and 172.16.0.1';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(counts.IP).toBe(2);
    });
  });

  describe('Social Media Handle Redaction', () => {
    it('should redact @handles', () => {
      const input = 'Follow me @username on Twitter';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('@username');
      expect(output).toContain('[REDACTED:HANDLE]');
      expect(counts.HANDLE).toBe(1);
    });
  });

  describe('Address Hints Redaction (SAFE profile)', () => {
    it('should redact address hints in SAFE profile', () => {
      const input = '서울시 강남대로 123-45, 101동 502호';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('강남대로 123-45');
      expect(output).not.toContain('101동');
      expect(output).not.toContain('502호');
      expect(counts.ADDR).toBeGreaterThan(0);
    });

    it('should NOT redact address hints in STANDARD profile', () => {
      const input = '서울시 강남대로 123-45';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'standard', counts);

      // STANDARD profile doesn't mask address hints
      expect(output).toContain('강남대로 123-45');
      expect(counts.ADDR).toBeUndefined();
    });
  });

  describe('Sensitive Keywords Redaction (SAFE profile)', () => {
    it('should redact sensitive keywords in SAFE profile', () => {
      const input = '자살, 자해, 강간, 폭행, 살해 등의 내용';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('자살');
      expect(output).not.toContain('자해');
      expect(output).toContain('[REDACTED:SENSITIVE]');
      expect(counts.SENSITIVE).toBeGreaterThan(0);
    });

    it('should NOT redact sensitive keywords in STANDARD profile', () => {
      const input = '폭행 사건에 대한 이야기';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'standard', counts);

      // STANDARD profile doesn't mask narrative sensitive words
      expect(output).toContain('폭행');
      expect(counts.SENSITIVE).toBeUndefined();
    });
  });

  describe('Custom Blacklist', () => {
    it('should redact custom blacklist terms', () => {
      // Set custom blacklist
      GMH.Privacy.setCustomList('blacklist', ['비밀단어', '민감정보']);

      const input = '이것은 비밀단어이고 민감정보입니다';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('비밀단어');
      expect(output).not.toContain('민감정보');
      expect(output).toContain('[REDACTED:CUSTOM]');
      expect(counts.CUSTOM).toBe(2);
    });

    it('should be case-insensitive for custom blacklist', () => {
      GMH.Privacy.setCustomList('blacklist', ['Secret']);

      const input = 'This is a SECRET word';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).not.toContain('SECRET');
      expect(counts.CUSTOM).toBe(1);
    });
  });

  describe('Custom Whitelist', () => {
    it('should protect whitelisted terms from redaction', () => {
      GMH.Privacy.setCustomList('whitelist', ['safe@company.com']);

      const input = 'Contact: safe@company.com or test@example.com';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      // Whitelisted email should be preserved
      expect(output).toContain('safe@company.com');
      // Other email should be redacted
      expect(output).not.toContain('test@example.com');
      expect(counts.EMAIL).toBe(1);
    });
  });

  describe('Minor Sexual Content Detection', () => {
    it('should detect minor + sexual keyword combination', () => {
      const input = '미성년자와 성적인 내용';
      const result = GMH.Privacy.hasMinorSexualContext(input);

      expect(result).toBe(true);
    });

    it('should detect with English keywords', () => {
      const input = 'minor engaging in sexual activity';
      const result = GMH.Privacy.hasMinorSexualContext(input);

      expect(result).toBe(true);
    });

    it('should NOT flag when only one type of keyword present', () => {
      const input1 = '미성년자 보호법';
      const input2 = '성적 평등';

      expect(GMH.Privacy.hasMinorSexualContext(input1)).toBe(false);
      expect(GMH.Privacy.hasMinorSexualContext(input2)).toBe(false);
    });
  });

  describe('Combined Redaction', () => {
    it('should redact multiple PII types in single text', () => {
      const input = `
        이름: 홍길동
        이메일: hong@example.com
        전화: 010-1234-5678
        주민번호: 990101-1234567
        카드: 4532015112830366
        IP: 192.168.1.1
        트위터: @honggildong
      `;
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).toContain('[REDACTED:EMAIL]');
      expect(output).toContain('[REDACTED:PHONE]');
      expect(output).toContain('[REDACTED:RRN]');
      expect(output).toContain('[REDACTED:CARD]');
      expect(output).toContain('[REDACTED:IP]');
      expect(output).toContain('[REDACTED:HANDLE]');

      expect(counts.EMAIL).toBe(1);
      expect(counts.PHONE).toBe(1);
      expect(counts.RRN).toBe(1);
      expect(counts.CARD).toBe(1);
      expect(counts.IP).toBe(1);
      expect(counts.HANDLE).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const counts = {};
      const output = GMH.Privacy.redactText('', 'safe', counts);

      expect(output).toBe('');
    });

    it('should handle null/undefined', () => {
      const counts = {};
      const output1 = GMH.Privacy.redactText(null, 'safe', counts);
      const output2 = GMH.Privacy.redactText(undefined, 'safe', counts);

      expect(typeof output1).toBe('string');
      expect(typeof output2).toBe('string');
    });

    it('should preserve non-PII text', () => {
      const input = '안녕하세요. 오늘 날씨가 좋네요.';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(output).toBe(input);
      expect(Object.keys(counts).length).toBe(0);
    });

    it('should handle text with special characters', () => {
      const input = '특수문자: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      // No false positives on special characters
      expect(output).toContain('!@#$%^&*()_+-=[]{}|;:,.<>?');
    });
  });

  describe('Profile-based Behavior', () => {
    it('SAFE profile should be most restrictive', () => {
      const input = '010-1234-5678, 강남대로 123, 자살';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'safe', counts);

      expect(counts.PHONE).toBe(1);
      expect(counts.ADDR).toBeGreaterThan(0);
      expect(counts.SENSITIVE).toBeGreaterThan(0);
    });

    it('STANDARD profile should redact core PII only', () => {
      const input = '010-1234-5678, 강남대로 123, 자살';
      const counts = {};
      const output = GMH.Privacy.redactText(input, 'standard', counts);

      expect(counts.PHONE).toBe(1);
      expect(counts.ADDR).toBeUndefined();
      expect(counts.SENSITIVE).toBeUndefined();
    });

    it('RESEARCH profile should match STANDARD for text redaction', () => {
      const input = 'test@example.com, 010-1234-5678';
      const countsSafe = {};
      const countsResearch = {};

      GMH.Privacy.redactText(input, 'safe', countsSafe);
      GMH.Privacy.redactText(input, 'research', countsResearch);

      // Core PII should be redacted the same
      expect(countsSafe.EMAIL).toBe(countsResearch.EMAIL);
      expect(countsSafe.PHONE).toBe(countsResearch.PHONE);
    });
  });
});