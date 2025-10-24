import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createExperimentalNamespace,
  MEMORY_INDEX_STORAGE_KEY,
} from '../../src/experimental/index';

const createMockStorage = () => {
  const backing = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => backing.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      backing.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      backing.delete(key);
    }),
  };
};

describe('experimental feature flags', () => {
  let consoleMock: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    consoleMock = {
      log: vi.fn(),
      warn: vi.fn(),
    };
  });

  it('reports disabled by default when storage is empty', () => {
    const storageMock = createMockStorage();
    const namespace = createExperimentalNamespace({ storage: storageMock, console: consoleMock });

    expect(namespace.MemoryIndex.enabled).toBe(false);
    expect(storageMock.getItem).toHaveBeenCalledWith(MEMORY_INDEX_STORAGE_KEY);
    expect(consoleMock.log).not.toHaveBeenCalled();
  });

  it('enables the memory index flag via localStorage', () => {
    const storageMock = createMockStorage();
    const namespace = createExperimentalNamespace({ storage: storageMock, console: consoleMock });

    const result = namespace.MemoryIndex.enable();

    expect(result).toBe(true);
    expect(storageMock.setItem).toHaveBeenCalledWith(MEMORY_INDEX_STORAGE_KEY, '1');
    expect(namespace.MemoryIndex.enabled).toBe(true);
    expect(consoleMock.log).toHaveBeenCalledTimes(1);
    expect(consoleMock.warn).not.toHaveBeenCalled();
  });

  it('disables the memory index flag and clears storage', () => {
    const storageMock = createMockStorage();
    const namespace = createExperimentalNamespace({ storage: storageMock, console: consoleMock });

    namespace.MemoryIndex.enable();
    const result = namespace.MemoryIndex.disable();

    expect(result).toBe(true);
    expect(storageMock.removeItem).toHaveBeenCalledWith(MEMORY_INDEX_STORAGE_KEY);
    expect(namespace.MemoryIndex.enabled).toBe(false);
  });

  it('warns when storage is unavailable', () => {
    const namespace = createExperimentalNamespace({ storage: null, console: consoleMock });

    expect(namespace.MemoryIndex.enabled).toBe(false);
    const enabledResult = namespace.MemoryIndex.enable();
    const disabledResult = namespace.MemoryIndex.disable();

    expect(enabledResult).toBe(false);
    expect(disabledResult).toBe(false);
    expect(consoleMock.warn).toHaveBeenCalledTimes(2);
    expect(consoleMock.log).not.toHaveBeenCalled();
  });
});
