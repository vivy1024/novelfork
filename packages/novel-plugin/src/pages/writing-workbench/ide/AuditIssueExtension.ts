/**
 * AuditIssueExtension —— 在 ChapterEditor 正文中用波浪下划线标注审稿意见命中句，
 * 支持点击高亮片段打开原地 PopConfirm 气泡（采纳 / 送叙述者修 / 忽略），不打断阅读与撤销历史。
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { locateAuditIssueQuote, type AuditIssueLite } from "../audit-issue-actions";

export interface EditorAuditHighlight {
  readonly key: string;
  readonly issue: AuditIssueLite;
  readonly quote: string;
  readonly from: number;
  readonly to: number;
  readonly severity: "critical" | "warning" | "info";
}

export const auditIssuePluginKey = new PluginKey<DecorationSet>("audit-issue-highlight");
export const AUDIT_ISSUE_REFRESH = "audit-issue-refresh";

export function matchAuditIssuesInDoc(
  doc: ProseMirrorNode,
  issues: readonly AuditIssueLite[],
): EditorAuditHighlight[] {
  if (issues.length === 0) return [];
  const fullText = doc.textBetween(0, doc.content.size, "\n", "\n");
  const hits: EditorAuditHighlight[] = [];
  const seenKeys = new Set<string>();

  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index]!;
    const located = locateAuditIssueQuote(fullText, issue);
    if (!located.quote) continue;
    const key = issue.issueId ?? `${issue.category ?? "audit"}:${index}:${located.quote}`;
    if (seenKeys.has(key)) continue;

    let range: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (range || !node.isText || !node.text) return;
      const at = node.text.indexOf(located.quote!);
      if (at !== -1) {
        range = { from: pos + at, to: pos + at + located.quote!.length };
      }
    });
    if (!range) continue;

    seenKeys.add(key);
    const rawSeverity = (issue.severity ?? "warning").toLowerCase();
    const severity = rawSeverity === "critical" || rawSeverity === "info" ? rawSeverity : "warning";
    hits.push({
      key,
      issue,
      quote: located.quote,
      from: (range as { from: number; to: number }).from,
      to: (range as { from: number; to: number }).to,
      severity,
    });
  }
  return hits;
}

function buildAuditDecorations(
  doc: ProseMirrorNode,
  issues: readonly AuditIssueLite[],
  dismissedKeys: ReadonlySet<string>,
): DecorationSet {
  const activeIssues = issues.filter((issue, index) => {
    const fallbackKey = `${issue.category ?? "audit"}:${index}`;
    return !dismissedKeys.has(issue.issueId ?? fallbackKey) && !dismissedKeys.has(fallbackKey);
  });
  const matches = matchAuditIssuesInDoc(doc, activeIssues).filter((item) => !dismissedKeys.has(item.key));
  if (matches.length === 0) return DecorationSet.empty;

  return DecorationSet.create(
    doc,
    matches.map((match) =>
      Decoration.inline(match.from, match.to, {
        class: "nf-audit-underline",
        "data-audit-key": match.key,
        "data-audit-severity": match.severity,
        title: `${match.issue.category ?? "审稿"}：${match.issue.description ?? "点击查看原地修改建议"}`,
      }),
    ),
  );
}

export interface AuditIssueExtensionOptions {
  readonly getIssues: () => readonly AuditIssueLite[];
  readonly getDismissedKeys: () => ReadonlySet<string>;
  readonly onSelectIssue?: (highlight: EditorAuditHighlight, anchorRect: DOMRect) => void;
}

export const AuditIssueExtension = Extension.create<AuditIssueExtensionOptions>({
  name: "auditIssueHighlight",

  addOptions() {
    return {
      getIssues: () => [],
      getDismissedKeys: () => new Set<string>(),
      onSelectIssue: undefined,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: auditIssuePluginKey,
        state: {
          init: (_config, state) =>
            buildAuditDecorations(state.doc, options.getIssues(), options.getDismissedKeys()),
          apply: (tr, previous, _oldState, newState) => {
            if (tr.docChanged || tr.getMeta(AUDIT_ISSUE_REFRESH)) {
              return buildAuditDecorations(newState.doc, options.getIssues(), options.getDismissedKeys());
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => auditIssuePluginKey.getState(state),
          handleClick: (view, pos, event) => {
            if (!options.onSelectIssue) return false;
            const target = event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>(".nf-audit-underline")
              : null;
            const key = target?.dataset.auditKey;
            const matches = matchAuditIssuesInDoc(view.state.doc, options.getIssues());
            const match = key
              ? matches.find((item) => item.key === key)
              : matches.find((item) => pos >= item.from && pos <= item.to);
            if (!match) return false;
            const rect = target ? target.getBoundingClientRect() : new DOMRect(event.clientX, event.clientY, 1, 18);
            options.onSelectIssue(match, rect);
            return true;
          },
        },
      }),
    ];
  },
});
