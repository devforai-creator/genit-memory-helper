import { describe, it, expect } from 'vitest';
import { looksLikeName, luhnValid, requireDeps } from '../../src/utils/validation';

describe('utils/validation', () => {
  it('validates human-like names and filters system markers', () => {
    expect(looksLikeName('Alice')).toBe(true);
    expect(looksLikeName('• Bob')).toBe(true);
    expect(looksLikeName('메시지 이미지')).toBe(false);
    expect(looksLikeName('')).toBe(false);
    expect(looksLikeName('This name is definitely far too long to pass')).toBe(false);
  });

  it('checks Luhn validity for numeric strings', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('1234-5678-90')).toBe(false);
    expect(luhnValid('4242424242424243')).toBe(false);
  });

  it('requires dependencies via nested paths and throws on invalid', () => {
    const deps = { a: { b: { c: 1 } }, ok: true };
    const result = requireDeps(deps, {
      'a.b.c': (value) => value === 1,
      ok: (value) => value === true,
    });
    expect(result).toBe(deps);

    expect(() =>
      requireDeps(deps, {
        missing: (value) => Boolean(value),
      }),
    ).toThrow('[GMH] Missing or invalid dependency: missing');
  });
});
