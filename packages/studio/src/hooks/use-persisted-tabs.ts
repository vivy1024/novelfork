/**
 * use-persisted-tabs — IndexedDB persistence for open tabs and unsaved edits.
 *
 * Saves/restores:
 *   - Open tab list + active tab ID
 *   - Unsaved content per tab (dirty state)
 *
 * Uses a simple IndexedDB wrapper (no external deps).
 * Gracefully degrades if IndexedDB is unavailable.
 */

const DB_NAME = "novelfork-studio";
const DB_VERSION = 1;
const TABS_STORE = "tabs";
const UNSAVED_EDITS_STORE = "unsaved-edits";
const TABS_KEY = "session";

interface PersistedTabsData {
  readonly tabs: ReadonlyArray<{ route: unknown; id: string }>;
  readonly activeTabId: string;
}

interface UnsavedEditEntry {
  readonly tabId: string;
  readonly content: string;
  readonly savedAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABS_STORE)) {
        db.createObjectStore(TABS_STORE);
      }
      if (!db.objectStoreNames.contains(UNSAVED_EDITS_STORE)) {
        db.createObjectStore(UNSAVED_EDITS_STORE, { keyPath: "tabId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable — silently degrade
  }
}

async function idbPutUnsavedEdit(entry: UnsavedEditEntry): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNSAVED_EDITS_STORE, "readwrite");
      tx.objectStore(UNSAVED_EDITS_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

async function idbGetUnsavedEdit(tabId: string): Promise<UnsavedEditEntry | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNSAVED_EDITS_STORE, "readonly");
      const req = tx.objectStore(UNSAVED_EDITS_STORE).get(tabId);
      req.onsuccess = () => resolve(req.result as UnsavedEditEntry | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbDeleteUnsavedEdit(tabId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNSAVED_EDITS_STORE, "readwrite");
      tx.objectStore(UNSAVED_EDITS_STORE).delete(tabId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

// --- Public API ---

/**
 * Save current tab session to IndexedDB.
 */
export async function persistTabSession(
  tabs: ReadonlyArray<{ route: unknown; id: string }>,
  activeTabId: string,
): Promise<void> {
  const data: PersistedTabsData = { tabs, activeTabId };
  await idbPut(TABS_STORE, TABS_KEY, data);
}

/**
 * Restore tab session from IndexedDB.
 */
export async function restoreTabSession(): Promise<PersistedTabsData | undefined> {
  return idbGet<PersistedTabsData>(TABS_STORE, TABS_KEY);
}

/**
 * Save unsaved edits for a specific tab.
 */
export async function saveUnsavedEdit(tabId: string, content: string): Promise<void> {
  await idbPutUnsavedEdit({ tabId, content, savedAt: Date.now() });
}

/**
 * Load unsaved edits for a specific tab.
 */
export async function loadUnsavedEdit(tabId: string): Promise<string | undefined> {
  const entry = await idbGetUnsavedEdit(tabId);
  return entry?.content;
}

/**
 * Remove unsaved edits when tab is closed or content is saved.
 */
export async function clearUnsavedEdit(tabId: string): Promise<void> {
  await idbDeleteUnsavedEdit(tabId);
}
