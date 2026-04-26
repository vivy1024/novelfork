export { characterMultidimLiteraryPreset } from "./character-multidim.js";
export { hookFourStatesLiteraryPreset } from "./hook-four-states.js";
export { consistencyAuditLiteraryPreset } from "./consistency-audit.js";
export { controllingIdeaLiteraryPreset } from "./controlling-idea.js";

import { characterMultidimLiteraryPreset } from "./character-multidim.js";
import { hookFourStatesLiteraryPreset } from "./hook-four-states.js";
import { consistencyAuditLiteraryPreset } from "./consistency-audit.js";
import { controllingIdeaLiteraryPreset } from "./controlling-idea.js";

export const builtinLiteraryPresets = [
  characterMultidimLiteraryPreset,
  hookFourStatesLiteraryPreset,
  consistencyAuditLiteraryPreset,
  controllingIdeaLiteraryPreset,
] as const;
