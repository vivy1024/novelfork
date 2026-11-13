import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";

import {
  deleteMechanismCard,
  extractAndSaveMechanismCards,
  loadMechanismCards,
  MechanismCardError,
  recallMechanismCardsForPlanning,
  updateMechanismCard,
} from "../engine/writing-layers/mechanism-cards.js";
import {
  appendRuntimeNegativeOverride,
  consolidateAndSaveStylePreset,
} from "../engine/writing-layers/style-consolidate.js";
import { StylePresetError } from "../engine/writing-layers/style-preset-store.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

export const MECHANISM_AND_CONSOLIDATE_TOOL_NAMES = [
  "mechanism.distill",
  "style.consolidate",
] as const;

function ok(summary: string, data: unknown): RuntimeToolResult {
  return { ok: true, summary, data: JSON.parse(JSON.stringify(data)) };
}

function fail(error: string, summary: string, data?: unknown): RuntimeToolResult {
  return { ok: false, error, summary, ...(data === undefined ? {} : { data: JSON.parse(JSON.stringify(data)) }) };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : undefined;
}

function parseChapterRange(value: unknown): { from?: number; to?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const from = typeof record.from === "number" && Number.isFinite(record.from) && record.from > 0 ? Math.trunc(record.from) : undefined;
  const to = typeof record.to === "number" && Number.isFinite(record.to) && record.to > 0 ? Math.trunc(record.to) : undefined;
  if (from === undefined && to === undefined) return undefined;
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

function parseAbstractSlots(value: unknown): Array<{ slot: string; roleDescription: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const slots = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.slot !== "string" || typeof record.roleDescription !== "string") return [];
    const slot = record.slot.trim();
    const roleDescription = record.roleDescription.trim();
    return slot && roleDescription ? [{ slot, roleDescription }] : [];
  });
  return slots.length > 0 ? slots : undefined;
}

export async function executeMechanismDistillTool(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "list";
  try {
    switch (action) {
      case "list": {
        const loaded = await loadMechanismCards(binding.root);
        return ok(`已读取 ${loaded.cards.length} 张机制卡。`, loaded);
      }
      case "extract": {
        const result = await extractAndSaveMechanismCards({
          bookRoot: binding.root,
          ...(typeof input.sourceTitle === "string" ? { sourceTitle: input.sourceTitle } : {}),
          ...(typeof input.filePath === "string" ? { filePath: input.filePath } : {}),
          ...(typeof input.text === "string" ? { text: input.text } : {}),
          ...(parseChapterRange(input.chapterRange) ? { chapterRange: parseChapterRange(input.chapterRange) } : {}),
          ...(stringArray(input.extraForbiddenTerms) ? { extraForbiddenTerms: stringArray(input.extraForbiddenTerms) } : {}),
          ...(context.generateText ? { generateText: context.generateText } : {}),
        });
        const warnText = result.warnings.length > 0 ? ` 注意：${result.warnings.join(" ")}` : "";
        return ok(
          `从《${input.sourceTitle ?? "参考作品"}》（${result.sourceChapterRange}）提炼 ${result.extracted.length} 张待审机制卡（库内共 ${result.allCards.length} 张）。${warnText}`,
          result,
        );
      }
      case "update": {
        const cardId = typeof input.cardId === "string" ? input.cardId.trim() : "";
        if (!cardId) return fail("invalid-input", "action=update 必须提供 cardId。");
        const status = input.status === "confirmed" || input.status === "needs-review" ? input.status : undefined;
        const updated = await updateMechanismCard(binding.root, cardId, {
          ...(typeof input.name === "string" ? { name: input.name } : {}),
          ...(typeof input.readerDesire === "string" ? { readerDesire: input.readerDesire } : {}),
          ...(typeof input.emotionChain === "string" ? { emotionChain: input.emotionChain } : {}),
          ...(typeof input.triggerAndPayoff === "string" ? { triggerAndPayoff: input.triggerAndPayoff } : {}),
          ...(parseAbstractSlots(input.abstractSlots) ? { abstractSlots: parseAbstractSlots(input.abstractSlots) } : {}),
          ...(stringArray(input.forbiddenSourceTerms) !== undefined ? { forbiddenSourceTerms: stringArray(input.forbiddenSourceTerms) } : {}),
          ...(stringArray(input.tags) !== undefined ? { tags: stringArray(input.tags) } : {}),
          ...(status ? { status } : {}),
        });
        const warnText = updated.warnings.length > 0 ? ` ${updated.warnings.join(" ")}` : "";
        return ok(`已更新机制卡「${updated.card.name}」（状态：${updated.card.status}）。${warnText}`, updated);
      }
      case "delete": {
        const cardId = typeof input.cardId === "string" ? input.cardId.trim() : "";
        if (!cardId) return fail("invalid-input", "action=delete 必须提供 cardId。");
        const deleted = await deleteMechanismCard(binding.root, cardId);
        return ok(`已删除机制卡 ${cardId}。`, deleted);
      }
      case "recall": {
        const query = typeof input.query === "string" ? input.query : (stringArray(input.tags) ?? []);
        const maxCards = typeof input.maxCards === "number" && Number.isFinite(input.maxCards) ? Math.trunc(input.maxCards) : 4;
        const cards = await recallMechanismCardsForPlanning(binding.root, query, maxCards);
        return ok(`召回 ${cards.length} 张规划参考机制卡（仅供细纲/卷纲构思，不注入正文文风通道）。`, { cards });
      }
      default:
        return fail("invalid-action", `未知的 mechanism.distill action：${action}。可选 extract | list | update | delete | recall。`);
    }
  } catch (error) {
    if (error instanceof MechanismCardError) {
      return fail(error.code, error.message, {
        explanation: {
          what: error.message,
          why: "机制卡必须剥离原著专名并保持 JSON 结构完整，避免把参考书设定污染进本书。",
          next: "核对参数、清理残留专名后重试。",
        },
      });
    }
    throw error;
  }
}

export async function executeStyleConsolidateTool(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "consolidate";
  try {
    if (action === "consolidate") {
      const maxRules = typeof input.maxRules === "number" && Number.isFinite(input.maxRules)
        ? Math.trunc(input.maxRules)
        : undefined;
      const result = await consolidateAndSaveStylePreset({
        bookRoot: binding.root,
        ...(context.generateText ? { generateText: context.generateText } : {}),
        ...(maxRules !== undefined ? { maxRules } : {}),
      });
      return ok(
        `已将 ${result.inputRuleCount} 条候选规则归约为 ${result.consolidatedRules.length} 条高密度正反例铁律（剔除空泛套话 ${result.droppedPlatitudeCount} 条）。`,
        result,
      );
    }
    if (action === "negative_override") {
      const feedbackText = typeof input.feedbackText === "string" ? input.feedbackText.trim() : "";
      if (!feedbackText) return fail("invalid-input", "action=negative_override 必须提供非空的 feedbackText。");
      const result = await appendRuntimeNegativeOverride(binding.root, feedbackText);
      return ok(`已置顶写入运行时负反馈铁律：${result.appliedRule}`, result);
    }
    return fail("invalid-action", `未知的 style.consolidate action：${action}。可选 consolidate | negative_override。`);
  } catch (error) {
    if (error instanceof StylePresetError) {
      return fail(error.code, error.message, {
        explanation: {
          what: error.message,
          why: "文风预设损坏或并发冲突时不能直接覆盖。",
          next: "检查本书文风预设状态后重试。",
        },
      });
    }
    throw error;
  }
}
