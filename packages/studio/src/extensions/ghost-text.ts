/**
 * GhostText — TipTap extension for inline AI completion suggestions.
 * Renders suggestion as a grey Decoration.widget after the cursor.
 * Tab accepts, Escape dismisses.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const ghostTextPluginKey = new PluginKey("ghostText");

export interface GhostTextState {
  readonly suggestion: string;
  readonly pos: number;
}

export const GhostText = Extension.create({
  name: "ghostText",

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const state = ghostTextPluginKey.getState(this.editor.state) as GhostTextState | null;
        if (!state?.suggestion) return false;
        this.editor.view.dispatch(
          this.editor.state.tr.insertText(state.suggestion, state.pos),
        );
        return true;
      },
      Escape: () => {
        const state = ghostTextPluginKey.getState(this.editor.state) as GhostTextState | null;
        if (!state?.suggestion) return false;
        this.editor.view.dispatch(
          this.editor.state.tr.setMeta(ghostTextPluginKey, { clear: true }),
        );
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostTextPluginKey,
        state: {
          init(): GhostTextState | null {
            return null;
          },
          apply(tr, prev): GhostTextState | null {
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta?.clear) return null;
            if (meta?.suggestion !== undefined) {
              return { suggestion: meta.suggestion, pos: meta.pos };
            }
            // Clear on any doc change or cursor movement
            if (tr.docChanged || tr.selectionSet) return null;
            return prev;
          },
        },
        props: {
          decorations(editorState) {
            const state = ghostTextPluginKey.getState(editorState) as GhostTextState | null;
            if (!state?.suggestion) return DecorationSet.empty;

            const widget = Decoration.widget(state.pos, () => {
              const span = document.createElement("span");
              span.textContent = state.suggestion;
              span.style.color = "#9ca3af";
              span.style.pointerEvents = "none";
              span.style.fontStyle = "italic";
              span.className = "ghost-text-suggestion";
              return span;
            }, { side: 1 });

            return DecorationSet.create(editorState.doc, [widget]);
          },
        },
      }),
    ];
  },
});
