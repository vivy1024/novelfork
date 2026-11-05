/**
 * 规划留白（T2.6）的唯一判据：scene.spec 校验、场景落盘、作者手编接口与写作台编辑器共用。
 *
 * 纯函数、无 Node 依赖，前端可以直接引用，保证「界面认为合法」与「服务端保存下来」是同一条规则。
 */

export type SceneGapKind = "motivation" | "detail" | "pacing";

/**
 * 规划留白：让规划刻意留下动机/细节/节奏的真实答案，
 * 防止模型把每个关键点写成标准解答。有效标准：该缺口至少有两种合理处理且结果明显不同。
 */
export interface SceneGap {
  readonly kind: SceneGapKind;
  /** 留白（缺口问题，例：她为什么这次没有反驳）。 */
  readonly gap: string;
  /** 作者或导演的真实答案；写作时注入，避免模型自行给出一套标准解答。 */
  readonly answer: string;
}

export const SCENE_GAP_KINDS: readonly SceneGapKind[] = ["motivation", "detail", "pacing"];

/** 作者可见的类别名；结果卡、编辑器、写前召回共用。 */
export const SCENE_GAP_KIND_LABEL: Readonly<Record<SceneGapKind, string>> = {
  motivation: "动机",
  detail: "细节",
  pacing: "节奏",
};

/** 作者手编接口的上限：单场最多几条留白、缺口与答案各多长（字符）。超出由接口拒绝并说明，不静默截断。 */
export const MAX_SCENE_GAPS = 12;
export const MAX_SCENE_GAP_TEXT = 500;

const KIND_SET = new Set<string>(SCENE_GAP_KINDS);

export function isSceneGapKind(value: unknown): value is SceneGapKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/**
 * 只保留合法留白条目：类别必须是三类之一，缺口与答案去掉首尾空白后都不能为空，且各不超过
 * MAX_SCENE_GAP_TEXT；最多保留前 MAX_SCENE_GAPS 条。非法条目剔除而不是让整体失败（与蓝图的宽松解析风格一致）。
 *
 * 上限放在这里而不是只放在作者手编接口：模型产出的 scene.spec 也经这里落盘，留白随后原样拼进写前召回，
 * 只在 HTTP 层设限的话，模型那条路可以存进任意多、任意长的留白。作者手编接口仍先按同一组上限
 * 拒绝并说明（不静默截断作者的输入），这里是所有入口共用的兜底。
 */
export function parseSceneGaps(value: unknown): SceneGap[] {
  if (!Array.isArray(value)) return [];
  const gaps: SceneGap[] = [];
  for (const item of value) {
    if (gaps.length >= MAX_SCENE_GAPS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const gap = typeof record.gap === "string" ? record.gap.trim() : "";
    const answer = typeof record.answer === "string" ? record.answer.trim() : "";
    if (!isSceneGapKind(record.kind) || !gap || !answer) continue;
    if (gap.length > MAX_SCENE_GAP_TEXT || answer.length > MAX_SCENE_GAP_TEXT) continue;
    gaps.push({ kind: record.kind, gap, answer });
  }
  return gaps;
}

/** 某场的留白，带场次信息；写前检查结果与召回文本用。 */
export interface ChapterSceneGaps {
  readonly sceneId: string;
  readonly ordinal: number;
  readonly title: string;
  readonly gaps: readonly SceneGap[];
}

/**
 * 把本章已存的规划留白渲染成给叙述者看的一段文字；没有任何留白时返回空串。
 * 答案是作者或导演定下的真实答案，写作时按它处理缺口，不要另编一套标准解答。
 */
export function renderChapterSceneGaps(chapterNumber: number, scenes: readonly ChapterSceneGaps[]): string {
  const withGaps = scenes.filter((scene) => scene.gaps.length > 0);
  if (withGaps.length === 0) return "";
  const lines = [`【第 ${chapterNumber} 章规划留白】作者为以下缺口定了真实答案：写到这里时按答案处理，不要替作者另给一套标准解答，也不要把答案直白说破。`];
  for (const scene of withGaps) {
    lines.push(`第 ${scene.ordinal} 场${scene.title ? `「${scene.title}」` : ""}：`);
    for (const gap of scene.gaps) lines.push(`- [${SCENE_GAP_KIND_LABEL[gap.kind]}] ${gap.gap} → ${gap.answer}`);
  }
  return lines.join("\n");
}
