/**
 * Server-owned contract metadata for the NovelFork product bootstrap.
 *
 * Feature flags are intentionally descriptive only. They are exposed so a
 * client can inspect the Runtime contract, but do not gate routes or behavior.
 */

export const PRODUCT_CONTRACT_VERSION = "phase-0" as const;
export const RUNTIME_BOOTSTRAP_CONTRACT_VERSION = PRODUCT_CONTRACT_VERSION;

export const PRODUCT_FEATURE_NAMES = [
	"runtimeNarratorParity",
	"learningCenter",
	"runtimeAdminAdvanced",
	"knowledgeBase",
	"scheduledTasks",
	"groupChat",
	"globalSearch",
	"singleRuntimeEntry",
] as const;

export type ProductFeatureName = (typeof PRODUCT_FEATURE_NAMES)[number];
export type ProductFeatureFlags = { [Name in ProductFeatureName]: boolean };

const FEATURE_ENV_SUFFIX: Record<ProductFeatureName, string> = {
	runtimeNarratorParity: "RUNTIME_NARRATOR_PARITY",
	learningCenter: "LEARNING_CENTER",
	runtimeAdminAdvanced: "RUNTIME_ADMIN_ADVANCED",
	knowledgeBase: "KNOWLEDGE_BASE",
	scheduledTasks: "SCHEDULED_TASKS",
	groupChat: "GROUP_CHAT",
	globalSearch: "GLOBAL_SEARCH",
	singleRuntimeEntry: "SINGLE_RUNTIME_ENTRY",
};

/** Only the literal string "true" enables a flag; all other values are false. */
function isExplicitTrue(value: string | undefined): boolean {
	return value === "true";
}

/**
 * Resolve product flags from server environment variables. The NarraFork
 * prefix is canonical; the NovelFork prefix is accepted for deployments that
 * configure product-owned environment variables under that namespace.
 */
export function getProductFeatureFlags(
	env: Record<string, string | undefined> = process.env,
): ProductFeatureFlags {
	return Object.fromEntries(
		PRODUCT_FEATURE_NAMES.map((name) => {
			const suffix = FEATURE_ENV_SUFFIX[name];
			const value = env[`NARRAFORK_FEATURE_${suffix}`] ?? env[`NOVELFORK_FEATURE_${suffix}`];
			return [name, isExplicitTrue(value)];
		}),
	) as ProductFeatureFlags;
}

export type RuntimeEntityCapabilities = {
	read: boolean;
	create: boolean;
	update: boolean;
	delete: boolean;
	send: boolean;
	interrupt: boolean;
};

export type ProductBootstrapCapabilities = {
	books: RuntimeEntityCapabilities;
	narrators: RuntimeEntityCapabilities;
	workspace: RuntimeEntityCapabilities;
};

const READ_ONLY: RuntimeEntityCapabilities = {
	read: true,
	create: false,
	update: false,
	delete: false,
	send: false,
	interrupt: false,
};

const PRODUCT_BOOTSTRAP_CAPABILITIES: ProductBootstrapCapabilities = {
	books: { ...READ_ONLY, create: true, delete: true },
	narrators: { ...READ_ONLY, create: true },
	workspace: { ...READ_ONLY, create: true, update: true },
};

/** Return a fresh capability collection for each bootstrap response. */
export function getProductBootstrapCapabilities(): ProductBootstrapCapabilities {
	return {
		books: { ...PRODUCT_BOOTSTRAP_CAPABILITIES.books },
		narrators: { ...PRODUCT_BOOTSTRAP_CAPABILITIES.narrators },
		workspace: { ...PRODUCT_BOOTSTRAP_CAPABILITIES.workspace },
	};
}

export type ProductBootstrapContract = {
	contractVersion: typeof PRODUCT_CONTRACT_VERSION;
	features: ProductFeatureFlags;
	capabilities: ProductBootstrapCapabilities;
};

export function getProductBootstrapContract(): ProductBootstrapContract {
	return {
		contractVersion: PRODUCT_CONTRACT_VERSION,
		features: getProductFeatureFlags(),
		capabilities: getProductBootstrapCapabilities(),
	};
}
