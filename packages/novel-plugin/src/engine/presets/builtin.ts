import { registerAll } from "./index.js";
import { builtinAntiAiPresets } from "./anti-ai/index.js";
import { builtinLiteraryPresets } from "./literary/index.js";
import { builtinLogicRisks } from "./logic-risks/index.js";
import { builtinPresetBundles } from "./bundles/index.js";
import { builtinBeatTemplates } from "./beats/index.js";
import { builtinTonePresets } from "./tones/index.js";
import { builtinSettingBasePresets } from "./setting-bases/index.js";
import type { Preset } from "./types.js";

const allBuiltinPresets: ReadonlyArray<Preset> = [
  ...builtinTonePresets,
  ...builtinSettingBasePresets,
  ...builtinAntiAiPresets,
  ...builtinLiteraryPresets,
  ...builtinLogicRisks,
  ...builtinPresetBundles,
];

export function registerBuiltinPresets(): void {
  registerAll(allBuiltinPresets, [...builtinBeatTemplates]);
}
