import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FOLLOW_DEFAULT_MODEL, settings } from "@vivy1024/narrafork-runtime-bridge";
import { canSendToConfiguredModel, getProductModelStatus } from "./book-provision";
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
	geminiProviders: settings.geminiProviders,
};
const originalDefaultModel = settings.agent.defaultModel;

beforeEach(() => {
	settings.agent.defaultModel = "";
	settings.customApiProviders = [];
	settings.openaiProviders = [];
	settings.anthropicProviders = [];
	settings.nugProviders = [];
	settings.geminiProviders = [];
});

afterEach(() => {
	Object.assign(settings, originalProviders);
	settings.agent.defaultModel = originalDefaultModel;
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
	test("counts a complete enabled Gemini provider as configured", () => {
		settings.geminiProviders = [
			{
				id: "gemini-1",
				name: "Gemini",
				prefix: "gemini",
				apiKey: "key",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				defaultModel: "gemini-2.5-flash",
			},
		];
		expect(getProductModelStatus()).toEqual({ setupRequired: false, label: "已配置：Gemini" });
	});

	test("does not count an incomplete or disabled Gemini provider", () => {
		settings.geminiProviders = [
			{
				id: "gemini-1",
				name: "Gemini",
				prefix: "gemini",
				apiKey: "",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				defaultModel: "gemini-2.5-flash",
			},
		];
		expect(getProductModelStatus()).toEqual({ setupRequired: true, label: NO_PROVIDER_LABEL });
		settings.geminiProviders[0] = {
			...settings.geminiProviders[0],
			apiKey: "key",
			disabled: true,
		};
		expect(getProductModelStatus()).toEqual({ setupRequired: true, label: NO_PROVIDER_LABEL });
	});

	test("counts a NUG provider without its own default model when the global default model belongs to it", () => {
		// NUG 从网关目录选模型，常见配置是供应商默认模型留空、全局默认模型写完整 ID
		settings.agent.defaultModel = "like:antigravity:gemini-3.8-flash-high";
		settings.nugProviders = [nugProvider()];
		expect(getProductModelStatus()).toEqual({ setupRequired: false, label: "已配置：like" });
		expect(canSendToConfiguredModel(null)).toBe(true);
		expect(canSendToConfiguredModel("like:kiro:claude-sonnet-4.5")).toBe(true);
	});

	test("treats the follow-default sentinel as no provider default model", () => {
		settings.agent.defaultModel = "like:antigravity:gemini-3.8-flash-high";
		settings.nugProviders = [nugProvider({ defaultModel: FOLLOW_DEFAULT_MODEL })];
		expect(getProductModelStatus()).toEqual({ setupRequired: false, label: "已配置：like" });
	});

	test("names the provider that lacks a model instead of claiming none is configured", () => {
		settings.agent.defaultModel = "other:model";
		settings.nugProviders = [nugProvider()];
		const status = getProductModelStatus();
		expect(status.setupRequired).toBe(true);
		expect(status.label).toContain("供应商 like 还没有可用的模型");
		// 叙述者自己选了 like 的完整模型 ID 时仍可发送；全局默认模型的供应商不存在则不行
		expect(canSendToConfiguredModel("like:antigravity:gemini-3.8-flash-high")).toBe(true);
		expect(canSendToConfiguredModel(null)).toBe(false);
	});

	test("does not let a provider without credentials send", () => {
		settings.agent.defaultModel = "like:antigravity:gemini-3.8-flash-high";
		settings.nugProviders = [nugProvider({ apiKey: "" })];
		expect(getProductModelStatus()).toEqual({ setupRequired: true, label: NO_PROVIDER_LABEL });
		expect(canSendToConfiguredModel(null)).toBe(false);
	});
});

const NO_PROVIDER_LABEL = "尚未配置 AI 供应商：请在设置中添加供应商，并填写 API Key 与服务地址。";

function nugProvider(overrides: Partial<NonNullable<typeof settings.nugProviders>[number]> = {}) {
	return {
		id: "nug-1",
		name: "like",
		prefix: "like",
		apiKey: "key",
		baseUrl: "https://nug.test/",
		defaultModel: "",
		...overrides,
	};
}
