/**
 * Local write-ahead journal in IndexedDB. Unsaved floor changes are written here immediately,
 * so a refresh, crash or lost connection never loses work. Entries are removed once the server confirms.
 */
export interface JournalEntry<T> {
  key: string;
  baseRevision: number;
  patch: T;
  updatedAt: string;
}

export interface Journal {
  get<T>(key: string): Promise<JournalEntry<T> | undefined>;
  put<T>(entry: JournalEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = 'electro-house';
const STORE = 'journal';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

class IndexedDbJournal implements Journal {
  private db?: Promise<IDBDatabase>;
  private connect() {
    this.db ??= openDb();
    return this.db;
  }
  async get<T>(key: string) {
    return tx<JournalEntry<T> | undefined>(await this.connect(), 'readonly', (s) => s.get(key));
  }
  async put<T>(entry: JournalEntry<T>) {
    await tx(await this.connect(), 'readwrite', (s) => s.put(entry));
  }
  async delete(key: string) {
    await tx(await this.connect(), 'readwrite', (s) => s.delete(key));
  }
}

/** Fallback when IndexedDB is unavailable (private mode in some browsers): survives navigation, not reloads. */
export class MemoryJournal implements Journal {
  private readonly map = new Map<string, JournalEntry<unknown>>();
  async get<T>(key: string) {
    return this.map.get(key) as JournalEntry<T> | undefined;
  }
  async put<T>(entry: JournalEntry<T>) {
    this.map.set(entry.key, entry);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

let shared: Journal | undefined;

export function browserJournal(): Journal {
  shared ??= typeof indexedDB === 'undefined' ? new MemoryJournal() : new IndexedDbJournal();
  return shared;
}
