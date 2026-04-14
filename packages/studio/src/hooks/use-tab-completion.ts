/**
 * useTabCompletion — debounced AI completion with SSE streaming.
 * Dispatches ghost text suggestion into the TipTap editor.
 */

import { useRef, useCallback, useEffect } from "react";
import { ghostTextPluginKey } from "../extensions/ghost-text";

interface UseTabCompletionOptions {
  readonly editor: any;
  readonly enabled: boolean;
  readonly debounceMs?: number;
}

export function useTabCompletion({ editor, enabled, debounceMs = 1500 }: UseTabCompletionOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    if (!editor || !enabled) return;
    cancel();

    timerRef.current = setTimeout(async () => {
      const { from } = editor.state.selection;
      const doc = editor.state.doc;

      // Get text before cursor (last 500 chars for context)
      const textBefore = doc.textBetween(Math.max(0, from - 500), from, "\n");
      const textAfter = doc.textBetween(from, Math.min(doc.content.size, from + 200), "\n");

      // Don't trigger if cursor is not at a natural pause point
      if (!textBefore.trim()) return;
      const lastChar = textBefore.trim().slice(-1);
      const pauseChars = ["\u3002", "\uff01", "\uff1f", "\uff0c", "\uff1b", "\uff1a", "\u3001", ".", "!", "?", ",", ";", ":", "\n"];
      if (!pauseChars.includes(lastChar) && textBefore.trim().length < 10) return;

      const surrounding = `${textBefore}\n[CURSOR]\n${textAfter}`;
      const currentLineText = textBefore.split("\n").pop() ?? "";

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const apiBase = (window as any).__INKOS_API_BASE__ ?? "";
        const response = await fetch(`${apiBase}/api/ai/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: currentLineText, surrounding }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              try {
                const data = JSON.parse(line.slice(5).trim());
                if (data.done) break;
                accumulated += data.text;

                // Update ghost text decoration
                if (editor.view && !controller.signal.aborted) {
                  editor.view.dispatch(
                    editor.state.tr.setMeta(ghostTextPluginKey, {
                      suggestion: accumulated,
                      pos: from,
                    }),
                  );
                }
              } catch {
                // skip malformed lines
              }
            }
          }
        }
      } catch {
        // aborted or network error — silent
      }
    }, debounceMs);
  }, [editor, enabled, debounceMs, cancel]);

  // Cleanup on unmount
  useEffect(() => cancel, [cancel]);

  return { trigger, cancel };
}
