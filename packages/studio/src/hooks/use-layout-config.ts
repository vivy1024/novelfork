/**
 * useLayoutConfig — IndexedDB persistence for IDE layout configuration
 */

import { useState, useEffect } from "react";

interface LayoutConfig {
  sidebarWidth: number;
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
}

const DB_NAME = "novelfork-studio";
const DB_VERSION = 1;
const STORE_NAME = "layout";
const CONFIG_KEY = "main-layout";

const DEFAULT_CONFIG: LayoutConfig = {
  sidebarWidth: 260,
  bottomPanelHeight: 200,
  bottomPanelCollapsed: false,
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function loadConfig(): Promise<LayoutConfig> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(CONFIG_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const data = request.result;
        resolve(data ? { ...DEFAULT_CONFIG, ...data } : DEFAULT_CONFIG);
      };
    });
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(config: LayoutConfig): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(config, CONFIG_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore save errors
  }
}

export function useLayoutConfig() {
  const [config, setConfig] = useState<LayoutConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg);
      setLoaded(true);
    });
  }, []);

  const updateConfig = (partial: Partial<LayoutConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  };

  return { config, loaded, updateConfig };
}
