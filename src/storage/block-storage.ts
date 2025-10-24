import { ENV } from '../env';
import type {
  BlockStorageController,
  BlockStorageOptions,
  MemoryBlockInit,
  MemoryBlockRecord,
} from '../types';

type ConsoleLike = Pick<Console, 'warn' | 'log' | 'error'>;

const DEFAULT_DB_NAME = 'gmh-memory-blocks';
const DEFAULT_STORE_NAME = 'blocks';
const DEFAULT_DB_VERSION = 1;

const compareRecords = (a: MemoryBlockRecord, b: MemoryBlockRecord): number => {
  if (a.startOrdinal !== b.startOrdinal) {
    return a.startOrdinal - b.startOrdinal;
  }
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  return a.id.localeCompare(b.id);
};

const isArrayBufferView = (value: unknown): value is ArrayBufferView => {
  return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value as ArrayBufferView);
};

const cloneArrayBuffer = (buffer: ArrayBuffer | null | undefined): ArrayBuffer | null => {
  if (!buffer) return null;
  if (typeof buffer.slice === 'function') {
    return buffer.slice(0);
  }
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer));
  return copy.buffer;
};

const toArrayBuffer = (value: ArrayBuffer | ArrayBufferView | null | undefined): ArrayBuffer | null => {
  if (!value) return null;
  if (value instanceof ArrayBuffer) {
    return cloneArrayBuffer(value);
  }
  if (isArrayBufferView(value)) {
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copy = new Uint8Array(bytes);
    return copy.buffer;
  }
  throw new TypeError('Memory block embedding must be an ArrayBuffer or typed array view.');
};

const cloneValue = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // fall back to JSON clone below
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (err) {
    return value;
  }
};

const cloneRecord = (record: MemoryBlockRecord): MemoryBlockRecord => {
  const copy: MemoryBlockRecord = {
    id: record.id,
    sessionUrl: record.sessionUrl,
    raw: record.raw,
    messages: cloneValue(record.messages),
    ordinalRange: [record.ordinalRange[0], record.ordinalRange[1]],
    timestamp: record.timestamp,
    embedding: cloneArrayBuffer(record.embedding),
    messageCount: record.messageCount,
    startOrdinal: record.startOrdinal,
    endOrdinal: record.endOrdinal,
  };
  if (record.meta) {
    copy.meta = cloneValue(record.meta);
  }
  return copy;
};

const normalizeBlock = (block: MemoryBlockInit): MemoryBlockRecord => {
  if (!block || typeof block !== 'object') {
    throw new TypeError('Memory block payload must be an object.');
  }
  const id = typeof block.id === 'string' ? block.id.trim() : String(block.id ?? '').trim();
  if (!id) {
    throw new Error('Memory block requires a stable id.');
  }
  const sessionUrl =
    typeof block.sessionUrl === 'string' ? block.sessionUrl.trim() : String(block.sessionUrl ?? '').trim();
  if (!sessionUrl) {
    throw new Error('Memory block requires sessionUrl.');
  }
  const ordinalRangeCandidate = Array.isArray(block.ordinalRange) ? block.ordinalRange : [NaN, NaN];
  const ordinalStart = Number(ordinalRangeCandidate[0]);
  const ordinalEnd = Number(ordinalRangeCandidate[1]);
  if (!Number.isFinite(ordinalStart) || !Number.isFinite(ordinalEnd)) {
    throw new Error('Memory block requires a finite ordinalRange.');
  }
  const timestamp = Number(block.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Memory block requires a numeric timestamp.');
  }
  const messages = Array.isArray(block.messages) ? block.messages : [];
  const embedding = toArrayBuffer(block.embedding ?? null);
  const messageCount = messages.length;

  const record: MemoryBlockRecord = {
    id,
    sessionUrl,
    raw: typeof block.raw === 'string' ? block.raw : String(block.raw ?? ''),
    messages,
    ordinalRange: [ordinalStart, ordinalEnd],
    timestamp,
    embedding,
    messageCount,
    startOrdinal: ordinalStart,
    endOrdinal: ordinalEnd,
  };
  if (block.meta) {
    record.meta = block.meta;
  }
  return record;
};

const sanitizeLoadedRecord = (record: MemoryBlockRecord): MemoryBlockRecord => {
  const start = Number.isFinite(record.startOrdinal)
    ? record.startOrdinal
    : Number(record.ordinalRange?.[0]);
  const end = Number.isFinite(record.endOrdinal) ? record.endOrdinal : Number(record.ordinalRange?.[1]);
  const ordinalStart = Number.isFinite(start) ? start : 0;
  const ordinalEnd = Number.isFinite(end) ? end : ordinalStart;
  const embedding = record.embedding ? cloneArrayBuffer(record.embedding) : null;
  const messageCount = Number.isFinite(record.messageCount)
    ? record.messageCount
    : Array.isArray(record.messages)
      ? record.messages.length
      : 0;
  const sanitized: MemoryBlockRecord = {
    id: String(record.id),
    sessionUrl: String(record.sessionUrl),
    raw: typeof record.raw === 'string' ? record.raw : String(record.raw ?? ''),
    messages: Array.isArray(record.messages) ? record.messages : [],
    ordinalRange: [ordinalStart, ordinalEnd],
    timestamp: Number.isFinite(record.timestamp) ? Number(record.timestamp) : Date.now(),
    embedding,
    messageCount,
    startOrdinal: ordinalStart,
    endOrdinal: ordinalEnd,
  };
  if (record.meta) {
    sanitized.meta = record.meta;
  }
  return sanitized;
};

const selectConsole = (consoleRef?: ConsoleLike | null): ConsoleLike | null => {
  if (consoleRef) return consoleRef;
  if (ENV.console) return ENV.console as ConsoleLike;
  if (typeof console !== 'undefined') return console;
  return null;
};

const selectIndexedDB = (factory?: IDBFactory | null): IDBFactory | null => {
  if (factory) return factory;
  const envWindow = ENV.window;
  if (envWindow?.indexedDB) return envWindow.indexedDB;
  if (typeof indexedDB !== 'undefined') return indexedDB;
  const globalFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return globalFactory ?? null;
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

interface BlockStorageEngine {
  put(record: MemoryBlockRecord): Promise<void>;
  get(id: string): Promise<MemoryBlockRecord | null>;
  getBySession(sessionUrl: string): Promise<MemoryBlockRecord[]>;
  delete(id: string): Promise<boolean>;
  clear(sessionUrl?: string): Promise<number>;
  getAll(): Promise<MemoryBlockRecord[]>;
  count(): Promise<number>;
  close(): void;
}

const createMemoryEngine = (): BlockStorageEngine => {
  const buckets = new Map<string, MemoryBlockRecord>();
  return {
    async put(record) {
      buckets.set(record.id, cloneRecord(record));
    },
    async get(id) {
      const record = buckets.get(id);
      return record ? cloneRecord(record) : null;
    },
    async getBySession(sessionUrl) {
      const records: MemoryBlockRecord[] = [];
      for (const entry of buckets.values()) {
        if (entry.sessionUrl === sessionUrl) {
          records.push(cloneRecord(entry));
        }
      }
      records.sort(compareRecords);
      return records;
    },
    async delete(id) {
      return buckets.delete(id);
    },
    async clear(sessionUrl) {
      if (!sessionUrl) {
        const removed = buckets.size;
        buckets.clear();
        return removed;
      }
      let removed = 0;
      for (const [key, record] of buckets.entries()) {
        if (record.sessionUrl === sessionUrl) {
          buckets.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async getAll() {
      return Array.from(buckets.values(), (record) => cloneRecord(record));
    },
    async count() {
      return buckets.size;
    },
    close() {
      buckets.clear();
    },
  };
};

interface IndexedDBConfig {
  dbName: string;
  storeName: string;
  version: number;
  console: ConsoleLike | null;
}

const openIndexedDB = (factory: IDBFactory, config: IndexedDBConfig): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(config.dbName, config.version);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB for block storage.'));
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const storeExists = db.objectStoreNames.contains(config.storeName);
      const oldVersion = Number((event as IDBVersionChangeEvent).oldVersion || 0);
      if (!storeExists) {
        const store = db.createObjectStore(config.storeName, { keyPath: 'id' });
        store.createIndex('sessionUrl', 'sessionUrl', { unique: false });
        store.createIndex('startOrdinal', 'startOrdinal', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      } else if (oldVersion < 1) {
        const store = request.transaction?.objectStore(config.storeName);
        store?.createIndex?.('sessionUrl', 'sessionUrl', { unique: false });
        store?.createIndex?.('startOrdinal', 'startOrdinal', { unique: false });
        store?.createIndex?.('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const runTransaction = async <T>(
  dbPromise: Promise<IDBDatabase>,
  config: IndexedDBConfig,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await dbPromise;
  const tx = db.transaction(config.storeName, mode);
  const store = tx.objectStore(config.storeName);
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

  try {
    const result = await executor(store);
    await completion;
    return result;
  } catch (err) {
    try {
      if ((tx as IDBTransaction & { readyState?: string }).readyState !== 'done') {
        tx.abort();
      }
    } catch (abortErr) {
      config.console?.warn?.('[GMH] Failed to abort block storage transaction', abortErr);
    }
    await completion.catch(() => undefined);
    throw err;
  }
};

const createIndexedDBEngine = async (
  factory: IDBFactory,
  config: IndexedDBConfig,
): Promise<BlockStorageEngine> => {
  const dbPromise = openIndexedDB(factory, config);

  return {
    async put(record) {
      await runTransaction(dbPromise, config, 'readwrite', async (store) => {
        await requestToPromise(store.put(record));
        return undefined;
      });
    },
    async get(id) {
      const record = await runTransaction(dbPromise, config, 'readonly', async (store) => {
        const result = await requestToPromise<MemoryBlockRecord | undefined | null>(store.get(id));
        return result ?? null;
      });
      return record ? sanitizeLoadedRecord(record) : null;
    },
    async getBySession(sessionUrl) {
      const records = await runTransaction(dbPromise, config, 'readonly', async (store) => {
        const index = store.index('sessionUrl');
        const result = await requestToPromise<MemoryBlockRecord[]>(index.getAll(sessionUrl));
        return result ?? [];
      });
      const sanitized = records.map((record) => sanitizeLoadedRecord(record));
      sanitized.sort(compareRecords);
      return sanitized;
    },
    async delete(id) {
      return runTransaction(dbPromise, config, 'readwrite', async (store) => {
        const existing = await requestToPromise<MemoryBlockRecord | undefined | null>(store.get(id));
        if (!existing) return false;
        await requestToPromise(store.delete(id));
        return true;
      });
    },
    async clear(sessionUrl) {
      if (!sessionUrl) {
        return runTransaction(dbPromise, config, 'readwrite', async (store) => {
          const total = await requestToPromise<number>(store.count());
          await requestToPromise(store.clear());
          return total;
        });
      }
      return runTransaction(dbPromise, config, 'readwrite', async (store) => {
        const index = store.index('sessionUrl');
        const keys = await requestToPromise<IDBValidKey[]>(index.getAllKeys(sessionUrl));
        let removed = 0;
        for (const key of keys) {
          await requestToPromise(store.delete(key));
          removed += 1;
        }
        return removed;
      });
    },
    async getAll() {
      const records = await runTransaction(dbPromise, config, 'readonly', async (store) => {
        const result = await requestToPromise<MemoryBlockRecord[]>(store.getAll());
        return result ?? [];
      });
      return records.map((record) => sanitizeLoadedRecord(record));
    },
    async count() {
      return runTransaction(dbPromise, config, 'readonly', async (store) => {
        const total = await requestToPromise<number>(store.count());
        return total;
      });
    },
    close() {
      dbPromise
        .then((db) => db.close())
        .catch((err) => {
          config.console?.warn?.('[GMH] Failed to close block storage database', err);
        });
    },
  };
};

export const createBlockStorage = async (
  options: BlockStorageOptions = {},
): Promise<BlockStorageController> => {
  const consoleRef = selectConsole(options.console ?? null);
  const dbName =
    typeof options.dbName === 'string' && options.dbName.trim() ? options.dbName.trim() : DEFAULT_DB_NAME;
  const storeName =
    typeof options.storeName === 'string' && options.storeName.trim()
      ? options.storeName.trim()
      : DEFAULT_STORE_NAME;
  const versionCandidate = Number(options.version);
  const version =
    Number.isFinite(versionCandidate) && versionCandidate > 0 ? Math.floor(versionCandidate) : DEFAULT_DB_VERSION;
  const factory = selectIndexedDB(options.indexedDB ?? null);

  let engine: BlockStorageEngine;
  if (factory) {
    engine = await createIndexedDBEngine(factory, {
      dbName,
      storeName,
      version,
      console: consoleRef,
    });
  } else {
    consoleRef?.warn?.('[GMH] IndexedDB unavailable. Falling back to in-memory block storage.');
    engine = createMemoryEngine();
  }

  const controller: BlockStorageController = {
    async save(block) {
      const record = normalizeBlock(block);
      await engine.put(record);
    },
    async get(id) {
      const record = await engine.get(id);
      return record ? cloneRecord(record) : null;
    },
    async getBySession(sessionUrl) {
      const records = await engine.getBySession(sessionUrl);
      return records.map((record) => cloneRecord(record));
    },
    async delete(id) {
      return engine.delete(id);
    },
    async clear(sessionUrl) {
      return engine.clear(sessionUrl);
    },
    async getStats() {
      const records = await engine.getAll();
      const totalBlocks = records.length;
      let totalMessages = 0;
      const sessions = new Set<string>();
      for (const record of records) {
        sessions.add(record.sessionUrl);
        totalMessages += Number.isFinite(record.messageCount) ? record.messageCount : 0;
      }
      return {
        totalBlocks,
        totalMessages,
        sessions: sessions.size,
      };
    },
    close() {
      engine.close();
    },
  };

  return controller;
};

export default createBlockStorage;
