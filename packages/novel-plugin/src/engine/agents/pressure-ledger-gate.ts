import type { HookRecord, ResourceLedgerEntry, RuntimeStateDelta } from "@vivy1024/novelfork-core";

import type { PostWriteViolation } from "./post-write-validator.js";
import {
  PRESSURE_LEDGER_KIND_LABEL,
  PRESSURE_LEDGER_STALE_AFTER_CHAPTERS,
  classifyPressureResource,
  type PressureLedgerKind,
} from "./pressure-ledger-kinds.js";

export type { PressureLedgerKind } from "./pressure-ledger-kinds.js";

export interface PressureLedgerItem {
  readonly id: string;
  readonly kind: PressureLedgerKind;
  readonly name: string;
  readonly status?: string;
  readonly lastChapter?: number;
  readonly staleAfterChapters?: number;
}

export interface PressureLedgerGateInput {
  readonly chapterNumber: number;
  readonly content: string;
  readonly items?: ReadonlyArray<PressureLedgerItem>;
  readonly hooks?: ReadonlyArray<HookRecord>;
  readonly resources?: ReadonlyArray<ResourceLedgerEntry>;
  readonly delta?: Pick<RuntimeStateDelta, "chapter" | "hookOps" | "resourceOps">;
}

const SETTLE_TERMS = ["结清", "还清", "两清", "一笔勾销", "化解", "和解", "销毁", "作废", "兑现", "回收"];
const REGRESS_TERMS = ["倒退", "又变回", "重新变回", "再次变回", "又回到", "重新变成"];

function locateSnippet(content: string, needle: string): string | undefined {
  const index = content.indexOf(needle);
  if (index < 0) return undefined;
  const start = Math.max(0, index - 12);
  const end = Math.min(content.length, index + needle.length + 12);
  return content.slice(start, end).replace(/\s+/g, "");
}

function classifyResource(resource: ResourceLedgerEntry): Exclude<PressureLedgerKind, "hook"> | undefined {
  return classifyPressureResource(resource.resourceId, resource.name);
}

function toItems(input: PressureLedgerGateInput): PressureLedgerItem[] {
  if (input.items && input.items.length > 0) return [...input.items];
  const items: PressureLedgerItem[] = [];
  for (const hook of input.hooks ?? []) {
    items.push({
      id: hook.hookId,
      kind: "hook",
      name: hook.type || hook.hookId,
      status: hook.status,
      lastChapter: hook.lastAdvancedChapter,
    });
  }
  for (const resource of input.resources ?? []) {
    const kind = classifyResource(resource);
    if (!kind) continue;
    items.push({
      id: resource.resourceId,
      kind,
      name: resource.name || resource.resourceId,
      lastChapter: resource.lastChapter,
    });
  }
  return items;
}

function evidenceForItem(content: string, item: PressureLedgerItem): string | undefined {
  return locateSnippet(content, item.name) ?? locateSnippet(content, item.id);
}

function isResolved(item: PressureLedgerItem, delta: PressureLedgerGateInput["delta"]): boolean {
  if (item.status === "resolved") return true;
  if (item.kind === "hook") {
    return Boolean(delta?.hookOps.resolve.includes(item.id));
  }
  return Boolean(delta?.resourceOps.some((op) => op.resourceId === item.id && /结清|还清|两清|销毁|作废|回收/.test(op.reason)));
}

function isRegressed(item: PressureLedgerItem, delta: PressureLedgerGateInput["delta"]): boolean {
  if (item.kind !== "hook") {
    return Boolean(delta?.resourceOps.some((op) => op.resourceId === item.id && op.delta < 0 && /倒退|变回|重新/.test(op.reason)));
  }
  const upsert = delta?.hookOps.upsert.find((hook) => hook.hookId === item.id);
  return Boolean(item.status === "resolved" && upsert && upsert.status !== "resolved");
}

export function detectPressureLedgerIssues(input: PressureLedgerGateInput): ReadonlyArray<PostWriteViolation> {
  const items = toItems(input);
  if (items.length === 0) return [];

  const violations: PostWriteViolation[] = [];
  const staleAfter = PRESSURE_LEDGER_STALE_AFTER_CHAPTERS;

  for (const item of items) {
    const label = PRESSURE_LEDGER_KIND_LABEL[item.kind];
    const snippet = evidenceForItem(input.content, item);
    const resolved = isResolved(item, input.delta);
    const location = snippet ? `正文「${snippet}」` : `账本「${item.name}」`;

    if (resolved && !snippet) {
      violations.push({
        rule: "压力账本",
        severity: "error",
        description: `${label}「${item.name}」在第 ${input.chapterNumber} 章被结清，但正文没有对应证据（${location}）。`,
        suggestion: `补上可见的结清场面，或撤销对「${item.name}」的结清操作。`,
      });
      continue;
    }

    if (isRegressed(item, input.delta)) {
      violations.push({
        rule: "压力账本",
        severity: "error",
        description: `${label}「${item.name}」在第 ${input.chapterNumber} 章发生状态倒退（${location}）。`,
        suggestion: `不要无铺垫地把已结清的「${item.name}」打回未结状态；如确需回潮，先写清新的触发证据。`,
      });
      continue;
    }

    if (SETTLE_TERMS.some((term) => Boolean(locateSnippet(input.content, term))) && resolved === false && snippet) {
      const settleHit = SETTLE_TERMS.map((term) => locateSnippet(input.content, term)).find(Boolean);
      if (settleHit && REGRESS_TERMS.every((term) => !settleHit.includes(term))) {
        // 正文像在结清，但账本没落盘：这是警告，不阻断。
        violations.push({
          rule: "压力账本",
          severity: "warning",
          description: `${label}「${item.name}」正文出现结清口吻（${settleHit}），但账本仍未结清。`,
          suggestion: `确认后把「${item.name}」标记为结清，或改掉这段无账本依据的结清描写。`,
        });
      }
    }

    const lastChapter = item.lastChapter ?? 0;
    if (!resolved && lastChapter > 0 && input.chapterNumber - lastChapter >= (item.staleAfterChapters ?? staleAfter)) {
      violations.push({
        rule: "压力账本",
        severity: "warning",
        description: `${label}「${item.name}」已 ${input.chapterNumber - lastChapter} 章没有推进，可能被遗忘（上次第 ${lastChapter} 章）。`,
        suggestion: `本章推进、延后或明确回收「${item.name}」，不要让关键账目无声消失。`,
      });
    }
  }

  return violations;
}
