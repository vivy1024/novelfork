import { z } from "zod";

/** 预设保存写法与来源证据；人物、世界和剧情事实仍归经纬。 */
const text = z.string().trim().min(1).max(4_000);
const reviewed = {
  evidence: text,
  transfer: z.enum(["transferable", "source-only"]),
  status: z.enum(["needs-review", "confirmed"]),
};

export const STYLE_SCENE_TYPES = ["dialogue", "action", "description", "interiority", "transition", "general"] as const;

export const StyleFingerprintSchema = z.object({
  avgSentenceLength: z.number().finite().nonnegative(),
  sentenceLengthStdDev: z.number().finite().nonnegative(),
  vocabularyDiversity: z.number().min(0).max(1),
  dialogueRatio: z.number().min(0).max(1).optional(),
}).passthrough();

export const StylePresetSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  generalRules: z.array(text).max(50),
  sources: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    rules: z.array(z.object({ text, ...reviewed }).strict()).max(100),
    samples: z.array(z.object({
      id: z.string().trim().min(1).max(120),
      sceneType: z.enum(STYLE_SCENE_TYPES),
      text,
      ...reviewed,
    }).strict()).max(100),
  }).strict()).max(30),
  bookVoice: z.object({
    tone: z.string().trim().max(4_000),
    narrativeVoice: z.string().trim().max(4_000),
    principles: z.array(text).max(50),
  }).strict(),
  fingerprint: StyleFingerprintSchema.nullable(),
}).strict().superRefine((preset, ctx) => {
  const ids = new Set<string>();
  preset.sources.forEach((source, index) => {
    if (ids.has(source.id)) ctx.addIssue({ code: "custom", path: ["sources", index, "id"], message: "来源包 ID 不能重复" });
    ids.add(source.id);
    const sampleIds = new Set<string>();
    source.samples.forEach((sample, sampleIndex) => {
      if (sampleIds.has(sample.id)) ctx.addIssue({ code: "custom", path: ["sources", index, "samples", sampleIndex, "id"], message: "范文 ID 不能重复" });
      sampleIds.add(sample.id);
    });
  });
});

export type StylePreset = z.infer<typeof StylePresetSchema>;
export type StyleFingerprint = z.infer<typeof StyleFingerprintSchema>;

export function createStylePreset(fingerprint: StyleFingerprint | null = null): StylePreset {
  return {
    schemaVersion: 1,
    name: "本书文风",
    generalRules: [],
    sources: [],
    bookVoice: { tone: "", narrativeVoice: "", principles: [] },
    fingerprint,
  };
}

/** 统计数字留给写后对照，不当成机械句长配额；来源专属与未审阅规则绝不注入。 */
export function composeStyleGuide(preset: StylePreset): string {
  const sections: string[] = [];
  if (preset.generalRules.length) sections.push(`### 通用写法\n${preset.generalRules.map((rule) => `- ${rule}`).join("\n")}`);
  const sourceRules = preset.sources.flatMap((source) => source.rules
    .filter((rule) => rule.transfer === "transferable" && rule.status === "confirmed")
    .map((rule) => `- ${rule.text}（来源：${source.title}）`));
  if (sourceRules.length) sections.push(`### 已采纳的来源技法\n${sourceRules.join("\n")}`);
  const voice = preset.bookVoice;
  const bookRules = [
    voice.tone ? `基调：${voice.tone}` : "",
    voice.narrativeVoice ? `叙事声音：${voice.narrativeVoice}` : "",
    ...voice.principles.map((rule) => `- ${rule}`),
  ].filter(Boolean);
  if (bookRules.length) sections.push(`### 本书写法\n${bookRules.join("\n")}`);
  if (!sections.length) return "";
  return [`## ${preset.name}`, "仅学习表达方法；人物、世界与情节以本书已确认的经纬和当前作者要求为准，不迁移参考作品设定。", ...sections].join("\n\n");
}
