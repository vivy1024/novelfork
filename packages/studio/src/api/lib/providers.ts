export {
  PROVIDERS,
  buildManagedProviders,
  buildModelPool,
  getDefaultModel,
  getDefaultProvider,
  getModel,
  getProvider,
  getProviderTypeLabel,
  normalizeModelForSettings,
  normalizeProviderForSettings,
  resolveProviderApiTransport,
} from "../../shared/provider-catalog.js";

export type {
  ManagedProvider,
  Model,
  ModelPoolEntry,
  ModelTestStatus,
  Provider,
  ProviderApiMode,
  ProviderApiTransport,
  ProviderCompatibility,
  ProviderConfig,
  ProviderThinkingStrength,
  ProviderType,
} from "../../shared/provider-catalog.js";
