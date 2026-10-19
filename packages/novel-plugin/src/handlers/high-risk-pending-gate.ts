/**
 * 高风险待确认事件的停写闸门（T-13 / T-29）——**所有会覆盖既有章节正文的工具**共用。
 *
 * 背景：本书存在未被作者处理的高风险章后结算事件时，写章必须停下；放行只能走
 * NarraFork 的权限通道（AskUserQuestion → `memory.events` 的 approve/reject，或
 * 「待确认」面板），模型不得自行跳过，也没有任何本书开关或模型可传的继续参数。
 *
 * 为什么单独成模块：这条闸门同时服务于 `pipeline.write`（新建整章）与 `chapter.write`
 * （覆盖既有章节）。它们原先是各写一份，结果 `chapter.write` 那条漏了闸门——
 * 模型被 pipeline 拦下后，改用 `chapter.write` 覆盖同一章正文即可绕过
 * （见 `chapter-write-high-risk-gate.test.ts`）。把判定收成一处，新增写入工具时
 * 只需调用 `checkHighRiskPendingBeforeWrite`，不会再出现「某个工具忘了查」的空白。
 *
 * 读取失败时 **fail-closed**：无法确认是否存在高风险事件时阻断写章，而不是放行。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { explainHighRiskPendingBlock } from "./write-preflight.js";
import { formatAuthorExplanation } from "./diagnostic-explanation.js";
import { listHighRiskPendingNarrativeEvents } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";

export interface HighRiskPendingBlocker {
  /** 直接可返回给工具的失败码，与既有 pipeline 口径一致。 */
  readonly code: "high-risk-pending";
  /** 面向模型的一句话结论。 */
  readonly summary: string;
  /** 三段式说明（发生了什么 / 为什么要看 / 建议怎么做）。 */
  readonly explanation: string;
}

export interface HighRiskPendingCheckOptions {
  /** 测试注入点与「调用方已持有存储」的复用点；省略时取产品库单例。 */
  readonly storage?: StorageDatabase;
  /** 高亮用的章号，仅用于措辞（例如「第 12 章没有落盘」）。省略时用中性措辞。 */
  readonly chapterNumber?: number;
  /** 本次写入的动词，用于措辞（默认「落盘」）。 */
  readonly action?: string;
  /** 日志口，便于调用方沿用既有 logger。 */
  readonly logger?: { warn(message: string, meta?: unknown): void; error(message: string, meta?: unknown): void };
}

/**
 * 有未处理的高风险待确认事件时返回阻断信息，否则返回 `null`。
 * 读取失败时同样返回阻断信息（fail-closed），并注明是「无法确认」而非「确实存在」。
 */
export function checkHighRiskPendingBeforeWrite(
  bookId: string,
  options: HighRiskPendingCheckOptions = {},
): HighRiskPendingBlocker | null {
  let storage: StorageDatabase;
  if (options.storage) {
    storage = options.storage;
  } else {
    try {
      storage = getStorageDatabase();
    } catch (error) {
      // 存储都取不到：连产品本身都工作不了，与 pipeline 同口径按「没有运行」放行
      // 会让闸门形同虚设，所以这里也按 fail-closed 处理。
      const detail = error instanceof Error ? error.message : String(error);
      options.logger?.error("[high-risk-gate] storage unavailable, blocking write", { bookId, detail });
      return {
        code: "high-risk-pending",
        summary: "无法读取本书的叙事记忆存储，已阻止写入。",
        explanation: [
          "发生了什么：读取本书叙事记忆存储时出错，无法确认是否还有未处理的高风险事件。",
          "为什么要看：跳过检查就可能在存在未处理高风险事件时继续写入，把未确认内容当成既定设定。",
          "建议怎么做：确认产品数据目录可访问后重试；反复失败请重启产品再试。",
        ].join("\n"),
      };
    }
  }

  let pending: NarrativeEvent[];
  try {
    pending = listHighRiskPendingNarrativeEvents(storage, { bookId, limit: 50 })
      .filter((event) => event.status === "pending" && event.riskLevel === "high");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.logger?.error("[high-risk-gate] high-risk pending check failed closed", { bookId, detail });
    return {
      code: "high-risk-pending",
      summary: `高风险待处理检查失败：${detail}`,
      explanation: [
        "发生了什么：读取高风险待处理事件时出错，无法确认本书是否还有未处理的高风险事件。",
        "为什么要看：若跳过检查，可能在存在未处理高风险事件时继续写入，造成设定冲突。",
        "建议怎么做：检查本书的存储与记忆数据是否可读，修复后重试。",
      ].join("\n"),
    };
  }
  if (pending.length === 0) return null;

  const action = options.action ?? "落盘";
  const where = options.chapterNumber === undefined ? "本次写入" : `第${options.chapterNumber}章`;
  const summary = `${where}没有${action}：本书有 ${pending.length} 条高风险待确认事件未处理，需作者逐条批准或驳回后才能继续。`;
  options.logger?.warn("[high-risk-gate] blocked by high-risk pending events", { bookId, count: pending.length });
  return {
    code: "high-risk-pending",
    summary,
    explanation: formatAuthorExplanation(explainHighRiskPendingBlock(pending)),
  };
}
