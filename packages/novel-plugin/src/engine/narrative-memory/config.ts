import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const DEFAULT_SETTLEMENT_CONFIG = {
  enabled: true,
  autoApplyLowRisk: true,
  autoApplyMediumRisk: true,
  highRiskAlwaysPending: true,
  minConfidence: 0.75,
  blockWriteOnHighRiskPending: false,
  useLlmExtraction: true,
};

const DEFAULT_LEDGER_CONFIG = {
  closeSupersededFacts: true,
  currentViewLimit: 80,
};

const DEFAULT_RETRIEVAL_CHANNELS_CONFIG = {
  // Hard constraints remain permanently enabled: they are a safety boundary,
  // not an optional convenience channel.
  state: true,
  timeline: true,
  hooks: true,
  facts: true,
  style: true,
  semantic: true,
};

const DEFAULT_RETRIEVAL_CONFIG = {
  maxTokens: 8000,
  channels: DEFAULT_RETRIEVAL_CHANNELS_CONFIG,
  waveEnabled: false,
  semanticEnabled: false,
};

const SettlementConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.enabled),
  autoApplyLowRisk: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.autoApplyLowRisk),
  autoApplyMediumRisk: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.autoApplyMediumRisk),
  highRiskAlwaysPending: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.highRiskAlwaysPending),
  minConfidence: z.number().min(0).max(1).default(DEFAULT_SETTLEMENT_CONFIG.minConfidence),
  blockWriteOnHighRiskPending: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.blockWriteOnHighRiskPending),
  useLlmExtraction: z.boolean().default(DEFAULT_SETTLEMENT_CONFIG.useLlmExtraction),
}).default(DEFAULT_SETTLEMENT_CONFIG);

const LedgerConfigSchema = z.object({
  closeSupersededFacts: z.boolean().default(DEFAULT_LEDGER_CONFIG.closeSupersededFacts),
  currentViewLimit: z.number().int().min(1).max(500).default(DEFAULT_LEDGER_CONFIG.currentViewLimit),
}).default(DEFAULT_LEDGER_CONFIG);

const RetrievalChannelsConfigSchema = z.object({
  state: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.state),
  timeline: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.timeline),
  hooks: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.hooks),
  facts: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.facts),
  style: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.style),
  semantic: z.boolean().default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG.semantic),
}).default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG);

const RetrievalConfigSchema = z.object({
  maxTokens: z.number().int().min(500).max(100_000).default(DEFAULT_RETRIEVAL_CONFIG.maxTokens),
  /** Per-channel recall switches; hard constraints are intentionally excluded. */
  channels: RetrievalChannelsConfigSchema.default(DEFAULT_RETRIEVAL_CHANNELS_CONFIG),
  waveEnabled: z.boolean().default(DEFAULT_RETRIEVAL_CONFIG.waveEnabled),
  /** Enables the embedding-backed semantic channel when that channel is switched on. */
  semanticEnabled: z.boolean().default(DEFAULT_RETRIEVAL_CONFIG.semanticEnabled),
}).default(DEFAULT_RETRIEVAL_CONFIG);

export const NarrativeMemoryConfigSchema = z.object({
  version: z.literal(1).default(1),
  settlement: SettlementConfigSchema,
  ledger: LedgerConfigSchema,
  retrieval: RetrievalConfigSchema,
});

export type NarrativeMemoryConfig = z.infer<typeof NarrativeMemoryConfigSchema>;

export type NarrativeMemoryConfigPatch = {
  version?: 1;
  settlement?: Partial<NarrativeMemoryConfig["settlement"]>;
  ledger?: Partial<NarrativeMemoryConfig["ledger"]>;
  retrieval?: Omit<Partial<NarrativeMemoryConfig["retrieval"]>, "channels"> & {
    channels?: Partial<NarrativeMemoryConfig["retrieval"]["channels"]>;
  };
};

export const DEFAULT_NARRATIVE_MEMORY_CONFIG: NarrativeMemoryConfig =
  NarrativeMemoryConfigSchema.parse({});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMergeConfig(
  base: NarrativeMemoryConfig,
  patch: NarrativeMemoryConfigPatch,
): NarrativeMemoryConfig {
  return NarrativeMemoryConfigSchema.parse({
    version: 1,
    settlement: { ...base.settlement, ...(patch.settlement ?? {}) },
    ledger: { ...base.ledger, ...(patch.ledger ?? {}) },
    retrieval: {
      ...base.retrieval,
      ...(patch.retrieval ?? {}),
      channels: {
        ...base.retrieval.channels,
        ...(patch.retrieval?.channels ?? {}),
      },
    },
  });
}

function bookConfigPath(bookRoot: string): string {
  return join(bookRoot, "book.json");
}

async function readBookJson(bookRoot: string): Promise<Record<string, unknown>> {
  const raw = await readFile(bookConfigPath(bookRoot), "utf8").catch(() => null);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Load per-book narrative memory settings from book.json.
 * Missing or partial fields fall back to safe product defaults.
 */
export async function loadNarrativeMemoryConfig(
  bookId: string,
  bookRoot: string,
): Promise<NarrativeMemoryConfig> {
  const normalizedBookId = bookId.trim();
  if (!normalizedBookId) throw new Error("bookId 必填。");
  if (!bookRoot.trim()) throw new Error("bookRoot 必填。");

  const book = await readBookJson(bookRoot);
  if (typeof book.id === "string" && book.id.trim() && book.id.trim() !== normalizedBookId) {
    throw new Error("book.json does not match the trusted book binding.");
  }

  const stored = book.narrativeMemory;
  if (!isPlainObject(stored)) return { ...DEFAULT_NARRATIVE_MEMORY_CONFIG };

  return deepMergeConfig(DEFAULT_NARRATIVE_MEMORY_CONFIG, stored as NarrativeMemoryConfigPatch);
}

/**
 * Merge patch into existing narrativeMemory config and write book.json.
 */
export async function saveNarrativeMemoryConfig(
  bookId: string,
  bookRoot: string,
  patch: NarrativeMemoryConfigPatch,
): Promise<NarrativeMemoryConfig> {
  const normalizedBookId = bookId.trim();
  if (!normalizedBookId) throw new Error("bookId 必填。");
  if (!bookRoot.trim()) throw new Error("bookRoot 必填。");

  const book = await readBookJson(bookRoot);
  if (typeof book.id === "string" && book.id.trim() && book.id.trim() !== normalizedBookId) {
    throw new Error("book.json does not match the trusted book binding.");
  }

  const current = await loadNarrativeMemoryConfig(normalizedBookId, bookRoot);
  const next = deepMergeConfig(current, patch);
  const payload = {
    ...book,
    id: typeof book.id === "string" && book.id.trim() ? book.id : normalizedBookId,
    narrativeMemory: next,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(bookConfigPath(bookRoot), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return next;
}

export function parseNarrativeMemoryConfigPatch(raw: unknown): NarrativeMemoryConfigPatch {
  if (!isPlainObject(raw)) throw new Error("配置体必须是对象。");
  const settlement = isPlainObject(raw.settlement) ? raw.settlement : undefined;
  const ledger = isPlainObject(raw.ledger) ? raw.ledger : undefined;
  const retrieval = isPlainObject(raw.retrieval) ? raw.retrieval : undefined;
  // Validate by merging into defaults (rejects illegal types/ranges).
  deepMergeConfig(DEFAULT_NARRATIVE_MEMORY_CONFIG, {
    settlement: settlement as NarrativeMemoryConfigPatch["settlement"],
    ledger: ledger as NarrativeMemoryConfigPatch["ledger"],
    retrieval: retrieval as NarrativeMemoryConfigPatch["retrieval"],
  });
  return {
    settlement: settlement as NarrativeMemoryConfigPatch["settlement"],
    ledger: ledger as NarrativeMemoryConfigPatch["ledger"],
    retrieval: retrieval as NarrativeMemoryConfigPatch["retrieval"],
  };
}
