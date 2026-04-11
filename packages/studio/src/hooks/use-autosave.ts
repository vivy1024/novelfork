/**
 * use-autosave — debounced auto-save for chapter editor.
 * Saves content after 3 seconds of inactivity.
 */
import { useState, useRef, useEffect, useCallback } from "react";

interface UseAutosaveOptions {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly content: string;
  readonly enabled: boolean;
  readonly onSave: (content: string) => Promise<void>;
  readonly debounceMs?: number;
}

interface UseAutosaveReturn {
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly lastSaved: Date | null;
  readonly flush: () => Promise<void>;
}

export function useAutosave(options: UseAutosaveOptions): UseAutosaveReturn {
  const { bookId, chapterNumber, content, enabled, onSave, debounceMs = 3000 } = options;

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const savedContentRef = useRef(content);
  const onSaveRef = useRef(onSave);
  const savingRef = useRef(false);

  onSaveRef.current = onSave;
  contentRef.current = content;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const doSave = useCallback(async (text: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSaveRef.current(text);
      savedContentRef.current = text;
      setDirty(false);
      setLastSaved(new Date());
    } catch {
      // save failed — stay dirty so next debounce retries
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  // Track dirty state and schedule debounced save
  useEffect(() => {
    if (!enabled) return;

    const isDirty = content !== savedContentRef.current;
    setDirty(isDirty);

    if (!isDirty) {
      clearTimer();
      return;
    }

    clearTimer();
    timerRef.current = setTimeout(() => {
      void doSave(contentRef.current);
    }, debounceMs);

    return clearTimer;
  }, [content, enabled, debounceMs, clearTimer, doSave]);

  // Reset state when switching chapters or disabling
  useEffect(() => {
    savedContentRef.current = content;
    setDirty(false);
    setLastSaved(null);
    clearTimer();
    // Only on chapter/book/enabled change — not on every content change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterNumber, enabled]);

  const flush = useCallback(async () => {
    clearTimer();
    if (contentRef.current !== savedContentRef.current) {
      await doSave(contentRef.current);
    }
  }, [clearTimer, doSave]);

  // Flush on unmount if dirty
  useEffect(() => {
    return () => {
      clearTimer();
      if (contentRef.current !== savedContentRef.current) {
        void onSaveRef.current(contentRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { dirty, saving, lastSaved, flush };
}
