export { fullScanAntiAiPreset } from "./full-scan.js";
export { sentenceVarianceAntiAiPreset } from "./sentence-variance.js";
export { emotionConcretizeAntiAiPreset } from "./emotion-concretize.js";
export { dialogueColloquialAntiAiPreset } from "./dialogue-colloquial.js";

import { fullScanAntiAiPreset } from "./full-scan.js";
import { sentenceVarianceAntiAiPreset } from "./sentence-variance.js";
import { emotionConcretizeAntiAiPreset } from "./emotion-concretize.js";
import { dialogueColloquialAntiAiPreset } from "./dialogue-colloquial.js";

export const builtinAntiAiPresets = [
  fullScanAntiAiPreset,
  sentenceVarianceAntiAiPreset,
  emotionConcretizeAntiAiPreset,
  dialogueColloquialAntiAiPreset,
] as const;
