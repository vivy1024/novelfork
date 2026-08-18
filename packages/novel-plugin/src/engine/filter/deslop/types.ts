/**
 * 纯规则去 AI 味引擎（0 LLM，确定性改写）。
 *
 * 只做两件事：
 * 1. `edits` —— 可确定性改写的部分，直接给出替换区间。删套词、规范标点、
 *    拆否定翻转句式。这些不需要语义判断，规则改完不会伤剧情。
 * 2. `manualFlags` —— 需要语义判断的部分，只标注不改。情绪外化、连续同主语
 *    重写、章末升华、上帝视角剧透都属于这类：规则瞎改会破坏叙事功能，
 *    因此交给作者或叙述者处理。
 *
 * 与 `filter/engine/rules.ts` 的分工：rules 只打分不改文，本模块负责改文。
 * 两者共用同一份套词认知，但本模块的词表按「删掉后是否仍然通顺」筛过一遍。
 */

export interface DeslopEdit {
  /** 原文中的起始下标（含）。 */
  readonly start: number;
  /** 原文中的结束下标（不含）。 */
  readonly end: number;
  readonly original: string;
  /** 空串表示直接删除。 */
  readonly replacement: string;
  readonly rule: string;
  readonly reason: string;
}

export interface DeslopManualFlag {
  readonly start: number;
  readonly end: number;
  readonly excerpt: string;
  readonly rule: string;
  readonly reason: string;
  /** 给叙述者的可执行改写指示。 */
  readonly instruction: string;
}

export interface DeslopStats {
  readonly originalLength: number;
  readonly resultLength: number;
  readonly autoEditCount: number;
  readonly manualFlagCount: number;
}

export interface DeslopResult {
  readonly original: string;
  /** 应用全部 `edits` 后的正文。 */
  readonly text: string;
  readonly edits: readonly DeslopEdit[];
  readonly manualFlags: readonly DeslopManualFlag[];
  readonly stats: DeslopStats;
}

export interface DeslopOptions {
  /** 命中这些词时跳过（项目 `.deslop-whitelist` 语义）。 */
  readonly whitelist?: readonly string[];
  /** 弱化副词每千字允许的上限；超出部分才删。默认 3。 */
  readonly weakAdverbBudgetPer1000?: number;
}
