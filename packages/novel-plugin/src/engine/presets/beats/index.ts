export { herosJourneyTemplate } from "./heros-journey.js";
export { saveTheCatTemplate } from "./save-the-cat.js";
export { threeActTemplate } from "./three-act.js";
export { openingHooksTemplate } from "./opening-hooks.js";
export { chapterEndingHooksTemplate } from "./chapter-ending-hooks.js";

import { herosJourneyTemplate } from "./heros-journey.js";
import { saveTheCatTemplate } from "./save-the-cat.js";
import { threeActTemplate } from "./three-act.js";
import { openingHooksTemplate } from "./opening-hooks.js";
import { chapterEndingHooksTemplate } from "./chapter-ending-hooks.js";

export const builtinBeatTemplates = [
  herosJourneyTemplate,
  saveTheCatTemplate,
  threeActTemplate,
  openingHooksTemplate,
  chapterEndingHooksTemplate,
] as const;
