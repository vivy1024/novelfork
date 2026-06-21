/**
 * SearchExtension — ProseMirror-based search/replace for TipTap.
 *
 * Uses Decoration.inline() to highlight matches and tracks the current match
 * index for navigation (Enter / Shift+Enter).
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// ── Module augmentation: register custom commands on TipTap's Commands chain ──
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchQuery: (query: string) => ReturnType;
      goToNextMatch: () => ReturnType;
      goToPreviousMatch: () => ReturnType;
      replaceMatch: (replacement: string) => ReturnType;
      replaceAllMatches: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export interface SearchState {
  query: string;
  currentIndex: number;
  matchCount: number;
}

export function findMatches(doc: ProseMirrorNode, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];
  const results: Array<{ from: number; to: number }> = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const lowerText = node.text.toLowerCase();
    let offset = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, offset);
      if (idx === -1) break;
      results.push({ from: pos + idx, to: pos + idx + query.length });
      offset = idx + 1;
    }
  });
  return results;
}

const searchPluginKey = new PluginKey("search");

export const SearchExtension = Extension.create({
  name: "search",

  addStorage() {
    return {
      query: "",
      currentIndex: 0,
      matchCount: 0,
    } as SearchState;
  },

  addCommands() {
    return {
      setSearchQuery:
        (query: string) =>
        ({ editor }: { editor: Editor }) => {
          editor.storage.search.query = query;
          const matches = findMatches(editor.state.doc, query);
          editor.storage.search.matchCount = matches.length;
          if (editor.storage.search.currentIndex >= matches.length) {
            editor.storage.search.currentIndex = Math.max(0, matches.length - 1);
          }
          const tr = editor.state.tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },

      goToNextMatch:
        () =>
        ({ editor }: { editor: Editor }) => {
          const { matchCount } = editor.storage.search;
          if (matchCount === 0) return false;
          editor.storage.search.currentIndex =
            (editor.storage.search.currentIndex + 1) % matchCount;
          const tr = editor.state.tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },

      goToPreviousMatch:
        () =>
        ({ editor }: { editor: Editor }) => {
          const { matchCount } = editor.storage.search;
          if (matchCount === 0) return false;
          editor.storage.search.currentIndex =
            (editor.storage.search.currentIndex - 1 + matchCount) % matchCount;
          const tr = editor.state.tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },

      replaceMatch:
        (replacement: string) =>
        ({ editor }: { editor: Editor }) => {
          const { query, currentIndex, matchCount } = editor.storage.search;
          if (!query || matchCount === 0) return false;

          const matches = findMatches(editor.state.doc, query);
          if (currentIndex >= matches.length) return false;

          const { from, to } = matches[currentIndex];
          const tr = editor.state.tr;
          tr.insertText(replacement, from, to);

          // Re-search after replacement
          const newMatches = findMatches(tr.doc, query);
          editor.storage.search.matchCount = newMatches.length;
          if (editor.storage.search.currentIndex >= newMatches.length) {
            editor.storage.search.currentIndex = Math.max(0, newMatches.length - 1);
          }
          tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },

      replaceAllMatches:
        (replacement: string) =>
        ({ editor }: { editor: Editor }) => {
          const { query, matchCount } = editor.storage.search;
          if (!query || matchCount === 0) return false;

          const matches = findMatches(editor.state.doc, query);
          if (matches.length === 0) return false;

          const tr = editor.state.tr;
          // Replace in reverse order so positions stay valid
          for (let i = matches.length - 1; i >= 0; i--) {
            tr.insertText(replacement, matches[i].from, matches[i].to);
          }

          editor.storage.search.matchCount = 0;
          editor.storage.search.currentIndex = 0;
          tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },

      clearSearch:
        () =>
        ({ editor }: { editor: Editor }) => {
          editor.storage.search.query = "";
          editor.storage.search.matchCount = 0;
          editor.storage.search.currentIndex = 0;
          const tr = editor.state.tr.setMeta(searchPluginKey, true);
          editor.view.dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        props: {
          decorations: (state) => {
            const query = this.editor.storage.search.query as string;
            if (!query) return DecorationSet.empty;

            const currentIndex = this.editor.storage.search.currentIndex as number;
            const matches = findMatches(state.doc, query);
            // Re-sync match count (doc might have changed)
            this.editor.storage.search.matchCount = matches.length;
            if (currentIndex >= matches.length && matches.length > 0) {
              this.editor.storage.search.currentIndex = matches.length - 1;
            }

            const decorations: Decoration[] = [];
            matches.forEach((match, i) => {
              decorations.push(
                Decoration.inline(match.from, match.to, {
                  class: i === currentIndex
                    ? "search-highlight-current"
                    : "search-highlight",
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** Scroll the current match into view */
export function scrollToCurrentMatch(editor: Editor, container: HTMLElement) {
  const current = container.querySelector(".search-highlight-current");
  if (current) {
    current.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
