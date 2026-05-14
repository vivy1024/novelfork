/**
 * Smart preset reflection — analyze chapter content and suggest preset changes.
 */

export interface PresetSuggestion {
  presetId: string;
  presetName: string;
  action: "enable" | "disable" | "adjust";
  reason: string;
  confidence: number; // 0-1
}

/**
 * Build prompt for the reflection model to analyze chapter vs active presets.
 */
export function buildPresetReflectionPrompt(
  chapterContent: string,
  activePresets: Array<{ id: string; name: string; rules: string }>,
  availablePresets: Array<{ id: string; name: string; description: string }>,
): string {
  const activeList = activePresets.map(p => `- [已启用] ${p.name}: ${p.rules.slice(0, 100)}`).join("\n");
  const availableList = availablePresets.filter(p => !activePresets.find(a => a.id === p.id))
    .slice(0, 10)
    .map(p => `- [可用] ${p.name}: ${p.description.slice(0, 80)}`)
    .join("\n");

  return `分析以下章节内容，对比当前已启用的写作预设，给出预设调整建议。

已启用预设：
${activeList || "（无）"}

可用但未启用的预设：
${availableList || "（无）"}

章节内容（前2000字）：
${chapterContent.slice(0, 2000)}

请以 JSON 数组格式输出建议，每条包含：
- presetId: 预设ID
- presetName: 预设名称
- action: "enable" | "disable" | "adjust"
- reason: 建议原因（一句话）
- confidence: 置信度 0-1

只输出有意义的建议（confidence > 0.6）。如果当前预设配置合理无需调整，输出空数组 []。`;
}

/**
 * Parse LLM response into structured suggestions.
 */
export function parsePresetSuggestions(llmResponse: string): PresetSuggestion[] {
  try {
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return (parsed as PresetSuggestion[]).filter(
      s => s && typeof s.presetId === "string" && typeof s.action === "string" && (s.confidence ?? 0) > 0.6
    );
  } catch {
    return [];
  }
}
