import { useCallback, useRef, useSyncExternalStore } from "react";

export interface PanelLayout {
  widths: Record<string, number>;
  collapsed: Record<string, boolean>;
}

const STORAGE_PREFIX = "novelfork-panel-layout-";

function readFromStorage(storageKey: string, defaults: PanelLayout): PanelLayout {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as PanelLayout;
      return {
        widths: { ...defaults.widths, ...parsed.widths },
        collapsed: { ...defaults.collapsed, ...parsed.collapsed },
      };
    }
  } catch {
    // corrupted data — fall back to defaults
  }
  return defaults;
}

function writeToStorage(storageKey: string, layout: PanelLayout): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

/**
 * Manages panel layout state (widths + collapsed) with localStorage persistence.
 *
 * Uses useSyncExternalStore so that multiple consumers sharing the same key
 * stay in sync without extra context providers.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const snapshots = new Map<string, PanelLayout>();

function getListenerSet(key: string): Set<Listener> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (set) {
    for (const fn of set) fn();
  }
}

export function usePanelLayout(key: string, defaults: PanelLayout) {
  const storageKey = STORAGE_PREFIX + key;
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const subscribe = useCallback(
    (onStoreChange: Listener) => {
      const set = getListenerSet(storageKey);
      set.add(onStoreChange);
      return () => {
        set.delete(onStoreChange);
      };
    },
    [storageKey],
  );

  const getSnapshot = useCallback(() => {
    let snap = snapshots.get(storageKey);
    if (!snap) {
      snap = readFromStorage(storageKey, defaultsRef.current);
      snapshots.set(storageKey, snap);
    }
    return snap;
  }, [storageKey]);

  const layout = useSyncExternalStore(subscribe, getSnapshot, () => defaultsRef.current);

  const setWidth = useCallback(
    (panelId: string, width: number) => {
      const current = snapshots.get(storageKey) ?? readFromStorage(storageKey, defaultsRef.current);
      const next: PanelLayout = {
        ...current,
        widths: { ...current.widths, [panelId]: width },
      };
      snapshots.set(storageKey, next);
      writeToStorage(storageKey, next);
      notify(storageKey);
    },
    [storageKey],
  );

  const toggleCollapsed = useCallback(
    (panelId: string) => {
      const current = snapshots.get(storageKey) ?? readFromStorage(storageKey, defaultsRef.current);
      const next: PanelLayout = {
        ...current,
        collapsed: { ...current.collapsed, [panelId]: !current.collapsed[panelId] },
      };
      snapshots.set(storageKey, next);
      writeToStorage(storageKey, next);
      notify(storageKey);
    },
    [storageKey],
  );

  const resetToDefaults = useCallback(() => {
    snapshots.set(storageKey, defaultsRef.current);
    writeToStorage(storageKey, defaultsRef.current);
    notify(storageKey);
  }, [storageKey]);

  return { layout, setWidth, toggleCollapsed, resetToDefaults } as const;
}

/** Clear internal caches — only for tests. */
export function __resetPanelLayoutCache(): void {
  snapshots.clear();
  listeners.clear();
}
