// Minimal promise-based IndexedDB wrapper. Browser-only (vitest runs in node,
// so this layer is exercised by the headless browser flow, not unit tests).

import { DB_NAME, DB_VERSION } from '../config'

export const STORE_SUBJECTS = 'subjects'
export const STORE_RESULTS = 'results'
export const STORE_VIDEOS = 'videos'
export const STORE_SETTINGS = 'settings'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SUBJECTS)) {
        const s = db.createObjectStore(STORE_SUBJECTS, { keyPath: 'id' })
        s.createIndex('code', 'code', { unique: true })
      }
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        const r = db.createObjectStore(STORE_RESULTS, { keyPath: 'id' })
        r.createIndex('subjectId', 'subjectId')
      }
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // A future schema bump in another tab closes us; reopen lazily.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB unavailable'))
    }
  })
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction(store, 'readwrite').objectStore(store).put(value))
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  return requestToPromise<T | undefined>(
    db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>,
  )
}

export async function idbGetAll<T>(
  store: string,
  index?: string,
  query?: IDBValidKey,
): Promise<T[]> {
  const db = await openDb()
  const os = db.transaction(store, 'readonly').objectStore(store)
  const src = index ? os.index(index) : os
  return requestToPromise<T[]>(src.getAll(query) as IDBRequest<T[]>)
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key))
}
