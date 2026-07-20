import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { settings } from "@vivy1024/narrafork-runtime-bridge";
import { getProductModelStatus } from "./book-provision";
import {
	getProductBootstrapCapabilities,
	getProductBootstrapContract,
	getProductFeatureFlags,
	PRODUCT_CONTRACT_VERSION,
	PRODUCT_FEATURE_NAMES,
} from "./product-contract";

const originalProviders = {
	customApiProviders: settings.customApiProviders,
	openaiProviders: settings.openaiProviders,
	anthropicProviders: settings.anthropicProviders,
	nugProviders: settings.nugProviders,
	clineProviders: settings.clineProviders,
};
const originalDisableKiro = process.env.NARRAFORK_DISABLE_KIRO_PROVIDER;

beforeEach(() => {
	settings.customApiProviders = [];
	settings.openaiProviders = [];
	settings.anthropicProviders = [];
	settings.nugProviders = [];
	settings.clineProviders = [];
	process.env.NARRAFORK_DISABLE_KIRO_PROVIDER = "1";
});

afterEach(() => {
	Object.assign(settings, originalProviders);
	if (originalDisableKiro === undefined) delete process.env.NARRAFORK_DISABLE_KIRO_PROVIDER;
	else process.env.NARRAFORK_DISABLE_KIRO_PROVIDER = originalDisableKiro;
});

describe("NovelFork product bootstrap contract", () => {
	test("declares all feature flags disabled by default", () => {
		const flags = getProductFeatureFlags({});
		expect(Object.keys(flags)).toEqual([...PRODUCT_FEATURE_NAMES]);
		expect(Object.values(flags)).toEqual(Array(PRODUCT_FEATURE_NAMES.length).fill(false));
	});

	test("maps server env flags and accepts only the literal true value", () => {
		const flags = getProductFeatureFlags({
			NARRAFORK_FEATURE_RUNTIME_NARRATOR_PARITY: "true",
			NARRAFORK_FEATURE_LEARNING_CENTER: "TRUE",
			NARRAFORK_FEATURE_RUNTIME_ADMIN_ADVANCED: "1",
			NOVELFORK_FEATURE_KNOWLEDGE_BASE: "true",
		});
		expect(flags).toMatchObject({
			runtimeNarratorParity: true,
			learningCenter: false,
			runtimeAdminAdvanced: false,
			knowledgeBase: true,
		});
	});

	test("returns version, flags, and a fresh unified capability collection", () => {
		const first = getProductBootstrapContract();
		const second = getProductBootstrapCapabilities();
		expect(first.contractVersion).toBe(PRODUCT_CONTRACT_VERSION);
		expect(first.capabilities).toEqual({
			books: {
				read: true,
				create: true,
				update: false,
				delete: true,
				send: false,
				interrupt: false,
			},
			narrators: {
				read: true,
				create: true,
				update: false,
				delete: false,
				send: false,
				interrupt: false,
			},
			workspace: {
				read: true,
				create: true,
				update: true,
				delete: false,
				send: false,
				interrupt: false,
			},
		});
		expect(first.capabilities).not.toBe(second);
		expect(first.capabilities.books).not.toBe(second.books);
	});
});

describe("product model status", () => {
	test("counts a complete enabled Cline provider as configured", () => {
		settings.clineProviders = [
			{
				id: "cline-1",
				name: "Cline",
				prefix: "cline",
				baseUrl: "https://api.cline.test",
				accessToken: "token",
				defaultModel: "model",
			},
		];
		expect(getProductModelStatus()).toEqual({ setupRequired: false, label: "已配置：Cline" });
	});

	test("does not count an incomplete or disabled Cline provider", () => {
		settings.clineProviders = [
			{
				id: "cline-1",
				name: "Cline",
				prefix: "cline",
				baseUrl: "https://api.cline.test",
				defaultModel: "model",
			},
		];
		expect(getProductModelStatus()).toEqual({ setupRequired: true });
		settings.clineProviders[0] = {
			...settings.clineProviders[0],
			accessToken: "token",
			disabled: true,
		};
		expect(getProductModelStatus()).toEqual({ setupRequired: true });
	});
});
