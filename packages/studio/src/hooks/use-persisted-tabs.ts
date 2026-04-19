/**
 * use-persisted-tabs — IndexedDB persistence for open tabs and drafts.
 *
 * Saves/restores:
 *   - Open tab list + active tab ID
 *   - Draft content per tab (dirty state)
 *
 * Uses a simple IndexedDB wrapper (no external deps).
 * Gracefully degrades if IndexedDB is unavailable.
 */

const DB_NAME = "novelfork-studio";
const DB_VERSION = 1;
const TABS_STORE = "tabs";
const DRAFTS_STORE = "drafts";
const TABS_KEY = "session";

interface PersistedTabsData {
  readonly tabs: ReadonlyArray<{ route: unknown; id: string }>;
  readonly activeTabId: string;
}

interface DraftEntry {
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
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: "tabId" });
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

async function idbPutDraft(draft: DraftEntry): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readwrite");
      tx.objectStore(DRAFTS_STORE).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

async function idbGetDraft(tabId: string): Promise<DraftEntry | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readonly");
      const req = tx.objectStore(DRAFTS_STORE).get(tabId);
      req.onsuccess = () => resolve(req.result as DraftEntry | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbDeleteDraft(tabId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readwrite");
      tx.objectStore(DRAFTS_STORE).delete(tabId);
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
 * Save a draft for a specific tab.
 */
export async function saveDraft(tabId: string, content: string): Promise<void> {
  await idbPutDraft({ tabId, content, savedAt: Date.now() });
}

/**
 * Load a draft for a specific tab.
 */
export async function loadDraft(tabId: string): Promise<string | undefined> {
  const draft = await idbGetDraft(tabId);
  return draft?.content;
}

/**
 * Remove a draft when tab is closed or content is saved.
 */
export async function clearDraft(tabId: string): Promise<void> {
  await idbDeleteDraft(tabId);
}
