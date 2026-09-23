/**
 * 把 `story/style_profile.json` 的文风指纹压成一段给模型看的约束摘要，
 * 注入划词 AI（润色 / 改写 / 扩写 / 精简 / 续写）的指令里。
 *
 * 没有这一步，作者在「技能文风」里蒸馏出的指纹只在侧栏展示，划词改写出来的
 * 仍是通用腔——配置了却不生效。
 *
 * 指纹由统计蒸馏写入，字段随版本增减，所以这里只挑认得的数值字段，
 * 缺哪项跳哪项；一项都认不出时返回 undefined，调用方据此不注入任何内容，
 * 保证「没有指纹」与改动前的行为逐字一致。口径与技能文风侧栏的指标展示保持一致。
 */

function finiteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function summarizeStyleProfile(profile: unknown): string | undefined {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return undefined;
  const record = profile as Record<string, unknown>;

  const parts: string[] = [];
  const avgSentence = finiteNumber(record, "avgSentenceLength");
  if (avgSentence !== undefined) parts.push(`平均句长约 ${Math.round(avgSentence)} 字`);

  const shortRatio = finiteNumber(record, "shortSentenceRatio");
  if (shortRatio !== undefined) parts.push(`短句占 ${percent(shortRatio)}`);

  const longRatio = finiteNumber(record, "longSentenceRatio");
  if (longRatio !== undefined) parts.push(`长句占 ${percent(longRatio)}`);

  const dialogue = finiteNumber(record, "dialogueRatio");
  if (dialogue !== undefined) parts.push(`对话占 ${percent(dialogue)}`);

  const avgParagraph = finiteNumber(record, "avgParagraphLength");
  if (avgParagraph !== undefined) parts.push(`段均约 ${Math.round(avgParagraph)} 字`);

  const weakAdverb = finiteNumber(record, "weakAdverbPer1000");
  if (weakAdverb !== undefined) parts.push(`弱副词每千字约 ${weakAdverb.toFixed(1)} 个`);

  if (parts.length === 0) return undefined;
  return `${parts.join("；")}。改写后的句长、对话比例与段落节奏须贴近以上基准，不要换成另一种腔调。`;
}
