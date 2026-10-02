import { z } from "zod";

/**
 * 作者硬约束：文风预设里的可选 customConstraints 字段。
 * 预设 schema 由主线统一升级（style-preset.ts 属主线范围），本模块是全部
 * 读取、归一化与注入的唯一入口：字段一旦启用，界面与叙述者指令即刻生效。
 */

/** 每条硬约束的长度上限（字符）。 */
export const CUSTOM_CONSTRAINT_MAX_ITEM_CHARS = 200;
/** 每本书硬约束的条数上限，超出的归一化时截断。 */
export const CUSTOM_CONSTRAINT_MAX_ITEMS = 30;

/** 存储端严格校验：单条非空且 ≤200 字，总数 ≤30 条。 */
export const CustomConstraintItemSchema = z.string().trim().min(1).max(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS);
export const CustomConstraintsSchema = z.array(CustomConstraintItemSchema).max(CUSTOM_CONSTRAINT_MAX_ITEMS);

export type CustomConstraints = readonly string[];

export interface PreparedCustomConstraints {
  readonly constraints: string[];
  /** 非字符串或去空白后为空、被丢弃的条数。 */
  readonly droppedItems: number;
  /** 超过 200 字、被收短的条数。 */
  readonly clampedItems: number;
  /** 超过 30 条上限、被丢弃的条数。 */
  readonly truncatedItems: number;
}

function prepareArray(value: readonly unknown[]): PreparedCustomConstraints {
  let droppedItems = 0;
  let clampedItems = 0;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") { droppedItems += 1; continue; }
    const trimmed = entry.trim();
    if (!trimmed) { droppedItems += 1; continue; }
    if (trimmed.length > CUSTOM_CONSTRAINT_MAX_ITEM_CHARS) {
      clampedItems += 1;
      items.push(trimmed.slice(0, CUSTOM_CONSTRAINT_MAX_ITEM_CHARS));
    } else {
      items.push(trimmed);
    }
  }
  const truncatedItems = Math.max(0, items.length - CUSTOM_CONSTRAINT_MAX_ITEMS);
  return {
    constraints: truncatedItems > 0 ? items.slice(0, CUSTOM_CONSTRAINT_MAX_ITEMS) : items,
    droppedItems,
    clampedItems,
    truncatedItems,
  };
}

/**
 * 读入来源不受控（手工改 JSON、旧版本数据）时裁剪到字段上限；
 * 计数交给界面提示「已截断」，数据层不沉默也不拒读。
 * 非数组输入按空列表处理并计入丢弃。
 */
export function prepareCustomConstraints(value: unknown): PreparedCustomConstraints {
  if (!Array.isArray(value)) {
    return { constraints: [], droppedItems: value == null ? 0 : 1, clampedItems: 0, truncatedItems: 0 };
  }
  return prepareArray(value);
}

/** 预设对象是否携带已启用的 customConstraints 字段（服务端未升级时整个分区保持隐藏）。 */
export function hasCustomConstraintsField(preset: unknown): boolean {
  return typeof preset === "object" && preset !== null && Object.hasOwn(preset, "customConstraints");
}

/**
 * 从预设对象里取硬约束：字段未启用返回 null（调用方与现状逐字一致）；
 * 字段启用则返回归一化后的条目与裁剪计数。
 */
export function extractCustomConstraints(preset: unknown): PreparedCustomConstraints | null {
  if (!hasCustomConstraintsField(preset)) return null;
  return prepareCustomConstraints((preset as { customConstraints?: unknown }).customConstraints);
}

/** 注入段的展示标题；界面与两条叙述者指令共用。 */
export const CUSTOM_CONSTRAINTS_SECTION_TITLE = "本书硬约束";

/**
 * 两个叙述者指令组装点共用的硬约束段（先于手法与工具说明，作者约束优先）。
 * 空白或全部无效时返回空数组，调用方直接跳过，输出与现状逐字一致。
 */
export function composeCustomConstraintsSection(constraints: unknown): string[] {
  const items = prepareCustomConstraints(constraints).constraints;
  if (!items.length) return [];
  return [
    `${CUSTOM_CONSTRAINTS_SECTION_TITLE}（作者设定，必须逐条遵守，优先于人文化手法与工具流程）：`,
    ...items.map((item) => `- ${item}`),
  ];
}
