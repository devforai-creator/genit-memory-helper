import { describe, it, expect } from 'vitest';
import { clone, deepMerge } from '../../src/core/utils';

describe('core/utils', () => {
  it('clones plain data and falls back when JSON serialization fails', () => {
    const original = { a: 1, nested: { b: 2 } };
    const copied = clone(original);
    expect(copied).toEqual(original);
    expect(copied).not.toBe(original);

    const circular: any = { value: 1 };
    circular.self = circular;
    const fallback = clone(circular);
    expect(fallback).toBe(circular);
  });

  it('deepMerge merges nested objects without mutating inputs', () => {
    const target = { a: 1, nested: { b: 2 } };
    const patch = { nested: { b: 3, c: 4 }, extra: 'x' };
    const result = deepMerge(target, patch);

    expect(result).toEqual({ a: 1, nested: { b: 3, c: 4 }, extra: 'x' });
    expect(result).not.toBe(target);
    expect((result as any).nested).not.toBe(target.nested);
  });

  it('deepMerge handles array targets and primitive patches', () => {
    const target = [1, 2, 3];
    const merged = deepMerge(target, ['x', 'y']);
    expect(merged).toEqual(['x', 'y', 3]);
    expect(target).toEqual([1, 2, 3]);

    const unchanged = deepMerge({ value: 1 }, 0);
    expect(unchanged).toEqual({ value: 1 });
  });
});
