export interface ShotStore {
  put(png: Blob): Promise<string>;
  get(shotId: string): Promise<Blob | undefined>;
  delete(shotIds: string[]): Promise<void>;
}

const STORE = 'shots';

interface StoredShot {
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

function newShotId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `shot_${random}`;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * IndexedDB-backed screenshot store (db "redline", store "shots"). Works in the service worker:
 * uses only the global `indexedDB`. Blobs are stored as bytes + type so they survive any
 * structured-clone implementation.
 */
export function createShotStore(dbName = 'redline'): ShotStore {
  let dbPromise: Promise<IDBDatabase> | undefined;

  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = undefined;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = undefined;
        reject(req.error);
      };
    });
    return dbPromise;
  }

  return {
    async put(png) {
      const id = newShotId();
      const value: StoredShot = { bytes: await png.arrayBuffer(), type: png.type || 'image/png', createdAt: Date.now() };
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, id);
      await transactionDone(tx);
      return id;
    },

    async get(shotId) {
      const db = await open();
      const value = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(shotId))) as
        | StoredShot
        | undefined;
      return value ? new Blob([value.bytes], { type: value.type }) : undefined;
    },

    async delete(shotIds) {
      if (shotIds.length === 0) return;
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const id of shotIds) store.delete(id);
      await transactionDone(tx);
    },
  };
}
