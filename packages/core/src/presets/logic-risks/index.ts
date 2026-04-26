export { anachronismRisk } from "./anachronism.js";
export { informationFlowRisk } from "./information-flow.js";
export { economyResourceRisk } from "./economy-resource.js";
export { institutionResponseRisk } from "./institution-response.js";
export { technologyBoundaryRisk } from "./technology-boundary.js";
export { characterMotivationRisk } from "./character-motivation.js";
export { geographyTransportRisk } from "./geography-transport.js";
export { satisfactionCostRisk } from "./satisfaction-cost.js";

import { anachronismRisk } from "./anachronism.js";
import { informationFlowRisk } from "./information-flow.js";
import { economyResourceRisk } from "./economy-resource.js";
import { institutionResponseRisk } from "./institution-response.js";
import { technologyBoundaryRisk } from "./technology-boundary.js";
import { characterMotivationRisk } from "./character-motivation.js";
import { geographyTransportRisk } from "./geography-transport.js";
import { satisfactionCostRisk } from "./satisfaction-cost.js";

export const builtinLogicRisks = [
  anachronismRisk,
  informationFlowRisk,
  economyResourceRisk,
  institutionResponseRisk,
  technologyBoundaryRisk,
  characterMotivationRisk,
  geographyTransportRisk,
  satisfactionCostRisk,
] as const;
