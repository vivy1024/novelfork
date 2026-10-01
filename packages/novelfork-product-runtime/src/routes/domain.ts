import { dirname, join } from "node:path";
import { Hono } from "hono";
import {
	getStorageDatabase,
	loadRuntimeStateSnapshot,
	resolveBookStorageDir,
	StateManager,
} from "@vivy1024/novelfork-core";
import {
	createBookArchiveRouter,
	createCharacterVoiceRouter,
	createCockpitRouter,
	createComplianceRouter,
	createEntityGraphRouter,
	createEmbeddingSettingsRouter,
	createFilterRouter,
	createJingweiRouter,
	createKnowledgeRouter,
	createMarketRouter,
	createNarrativeLineRouter,
	createNarrativeMemoryRouter,
	createPendingReviewRouter,
	createOverviewRouter,
	createQualityTrendRouter,
	createWriteReadinessRouter,
	createWritingLayersRouter,
	createWritingModesRouter,
	createStyleDistillationsRouter,
	createWritingResourceRouter,
	createWritingSkillsRouter,
	createWritingToolsRouter,
	createWorkflowsRouter,
	createWorkflowRunsRouter,
	createNarrativeStructureRouter,
	type RouterContext,
} from "@vivy1024/novelfork-novel-plugin/routes";
import {
	ValidationError,
	runtimeProductHostServices,
	type RuntimeProductHostServices,
	type RuntimeProductTextGenerationStatus,
} from "@vivy1024/narrafork-runtime-bridge";
import { getControlledBooksRoot } from "../services/book-binding";
import { novelForkProductBookService } from "../services/book-provision";
import rootPackage from "../../../../package.json";
import { assertBookNarratorAccess } from "../services/narrator-access";

/**
 * Novel-domain HTTP surface hosted by the NarraFork Runtime process.
 *
 * Authentication and book ownership are enforced by app.ts before this router
 * runs. The domain implementations remain owned by novel-plugin; this module
 * follows the server-side NovelFork repository binding only after that ACL guard.
 */
export const novelDomainRoutes = new Hono();

/**
 * Prefer the product binding's absolute book root (external workspaces included).
 * Fall back to the controlled books layout used by older local books.
 */
export function resolveDomainBookRoot(bookId: string): string {
	const normalized = bookId.trim();
	if (!normalized) return resolveBookStorageDir(dirname(getControlledBooksRoot()), bookId);
	try {
		const storage = getStorageDatabase();
		const row = storage.sqlite
			.prepare(`SELECT book_root FROM book_runtime_bindings WHERE book_id = ?`)
			.get(normalized) as { book_root?: string } | undefined;
		if (row?.book_root?.trim()) return row.book_root.trim();
	} catch {
		// Storage may not be initialized in pure unit contexts.
	}
	return resolveBookStorageDir(dirname(getControlledBooksRoot()), normalized);
}

type ProductTextGenerationResolver = NonNullable<RouterContext["resolveTextGeneration"]>;
type ProductTextGenerationAvailability = Awaited<ReturnType<ProductTextGenerationResolver>>;

function explainUnavailableModel(
	status: Extract<RuntimeProductTextGenerationStatus, { available: false }>,
): ProductTextGenerationAvailability {
	if (status.code === "MODEL_NOT_CONFIGURED") {
		return {
			available: false,
			code: status.code,
			message: "还没有设置默认模型。",
			suggestedAction: "在设置里配置 AI 供应商并选定默认模型后重试。",
		};
	}
	return {
		available: false,
		code: status.code,
		message: `默认模型当前不可用：${status.message}`,
		suggestedAction: "在设置里检查默认模型的供应商是否已启用、凭据是否有效，或改选其他默认模型后重试。",
	};
}

/**
 * Server-side text generation for novel HTTP routes, provided by the Runtime
 * through the Product Host SPI. Generation follows the Runtime's configured
 * default model (the model a narrator uses without an override) and every
 * request is attributed to the authenticated user for usage accounting. The
 * product never reads provider credentials or picks a model itself.
 */
export function createProductTextGenerationResolver(
	services: RuntimeProductHostServices = runtimeProductHostServices,
): ProductTextGenerationResolver {
	return async (c) => {
		const user = c.get("user") as { sub?: unknown } | undefined;
		const userId = typeof user?.sub === "string" ? user.sub.trim() : "";
		if (!userId) {
			return {
				available: false,
				code: "UNAUTHENTICATED",
				message: "这次请求没有登录身份，服务端模型只对已登录的作者开放。",
				suggestedAction: "重新登录后再试。",
			};
		}
		const status = await services.getTextGenerationStatus("default");
		if (!status.available) return explainUnavailableModel(status);
		return {
			available: true,
			model: `${status.provider}:${status.model}`,
			generateText: (request) =>
				services.generateText(
					{
						messages: request.messages,
						...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
						...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
						modelRole: "default",
					},
					{ userId },
				),
		};
	};
}

const resolveProductTextGeneration = createProductTextGenerationResolver();

class ProductBookStateManager extends StateManager {
	bookDir(bookId: string): string {
		return resolveDomainBookRoot(bookId);
	}
}

function createProductRouterContext(): RouterContext {
	const root = dirname(getControlledBooksRoot());
	const state = new ProductBookStateManager(root);
	return {
		state,
		root,
		broadcast: () => undefined,
		buildPipelineConfig: async () => {
			throw new Error("AI pipeline is not available from this product HTTP adapter");
		},
		// 产品层不接触供应商密钥：服务端模型调用一律走 resolveTextGeneration。
		getSessionLlm: async () => undefined,
		resolveTextGeneration: resolveProductTextGeneration,
		getRuntimeModelStatus: async () => ({ hasUsableModel: false }),
	};
}

// novel-plugin intentionally owns its own Hono dependency. Both versions expose
// the same runtime router contract, but their private TypeScript fields differ.
function asRuntimeRouter(router: unknown): Hono {
	return router as Hono;
}

const productRouterContext = createProductRouterContext();

novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWritingResourceRouter({
			resolveBookDir: resolveDomainBookRoot,
		}),
	),
);
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createNarrativeMemoryRouter({
			resolveBookRoot: resolveDomainBookRoot,
			resolveTextGeneration: resolveProductTextGeneration,
		}),
	),
);
// 关系图谱：按实体 id 查第 N 章关系、关系史、焦点人物网络、共同关系人与趋势；数据只读实体索引。
novelDomainRoutes.route("", asRuntimeRouter(createEntityGraphRouter()));
// 知情边界：按实体 id 查第 N 章「他知道什么 / 还不知道什么」与现状，数据只读知情账与状态流水。
novelDomainRoutes.route("", asRuntimeRouter(createKnowledgeRouter()));
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createOverviewRouter({ loadChapterIndex: (bookId) => productRouterContext.state.loadChapterIndex(bookId) }),
	),
);
novelDomainRoutes.route("", asRuntimeRouter(createJingweiRouter()));
// 角色声线：权威源是经纬角色条目 fields_json.voice；草稿待审、作者逐项确认，写入带版本校验。
// 「请模型增补」走 Runtime 提供的服务端文本生成（当前用户、默认模型）；没有模型时只出规则初稿并说明原因。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createCharacterVoiceRouter({
			resolveBookRoot: resolveDomainBookRoot,
			resolveTextGeneration: resolveProductTextGeneration,
		}),
	),
);
// 驾驶舱「近期章节结果 + 待回收伏笔」轻声提示面板。复用 CockpitService 的只读查询。
novelDomainRoutes.route("", asRuntimeRouter(createCockpitRouter(productRouterContext)));
// 叙事线快照 + proposal 审批。propose 只算预览，apply 才写入并留审批台账。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createNarrativeLineRouter({
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
// Workbench tool panels (arcs/health/progress/pov/…) previously existed only on
// the retired Studio server. Mount them on the product Runtime surface.
novelDomainRoutes.route("", asRuntimeRouter(createWritingToolsRouter(productRouterContext)));
// 写作视图的只读就绪查询（write.preflight / 卷纲）。写动作仍走工具与权限确认。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWriteReadinessRouter({
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
novelDomainRoutes.route("", asRuntimeRouter(createComplianceRouter(productRouterContext)));
novelDomainRoutes.route("", asRuntimeRouter(createFilterRouter()));
// Writing Skills 全局目录与作者副本编辑。内容权威源始终是 SKILL.md 文件，
// 作品级生效状态由可信根目录 `.novelfork/skills` 自动扫描决定。
novelDomainRoutes.route("", asRuntimeRouter(createWritingSkillsRouter()));
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWritingLayersRouter(productRouterContext, {
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
// 创作工作流方案持久化路由：按书籍目录落盘 story/workflow_recipes.json。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWorkflowsRouter(productRouterContext, {
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
// 创作工作流运行：产品持有的工序状态机。叙述者归属经可信绑定校验，不接受任意 narratorId。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWorkflowRunsRouter({
			resolveBookRoot: resolveDomainBookRoot,
			authorizeNarrator: async (c, bookId, narratorId) => {
				const user = c.get("user") as { sub: string; role: "admin" | "user" } | undefined;
				if (!user) return false;
				try {
					await assertBookNarratorAccess({ userId: user.sub, role: user.role }, bookId, narratorId);
					return true;
				} catch {
					return false;
				}
			},
		}),
	),
);
// 全书叙事结构聚合读模型：一次请求返回卷、章、场景、剧情线、挂载、伏笔与实体快照。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createNarrativeStructureRouter({
			// 伏笔阈值由作者按书设置，存于 book.json。
			loadBookConfig: (bookId) => productRouterContext.state.loadBookConfig(bookId),
		}),
	),
);
// 「待确认」聚合（只读）：声线/文风规则/伏笔草稿/待审事件/事实与金库未采纳改稿段一次聚齐。
// 各审批动作仍走原有入口，本路由只回答「去哪确认」。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createPendingReviewRouter({
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
// 质量趋势（章级 AI 味/漂移分/质量分时间序列）和写作模式（文风漂移检测基线）。
novelDomainRoutes.route("", asRuntimeRouter(createQualityTrendRouter(productRouterContext)));
novelDomainRoutes.route("", asRuntimeRouter(createWritingModesRouter(productRouterContext)));
novelDomainRoutes.route("", asRuntimeRouter(createStyleDistillationsRouter(productRouterContext, {
	resolveBookRoot: resolveDomainBookRoot,
})));
// 项目档案：导出整本书为单个 zip；导入只能导入为新书。作品目录只经可信绑定解析，
// 导入的建书、目录转正与 Runtime 绑定由产品书籍服务完成，失败整体撤销。
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createBookArchiveRouter({
			resolveBookRoot: resolveDomainBookRoot,
			novelforkVersion: typeof rootPackage.version === "string" ? rootPackage.version : "unknown",
			importArchive: async (c, request) => {
				const user = c.get("user") as { sub?: string; role?: "admin" | "user" } | undefined;
				if (!user?.sub) throw new ValidationError("导入作品需要登录");
				return novelForkProductBookService.importBookArchive(
					{ userId: user.sub, role: user.role === "admin" ? "admin" : "user" },
					request.idempotencyKey,
					request.bytes,
					request.modules,
				);
			},
		}),
	),
);
novelDomainRoutes.route("", asRuntimeRouter(createMarketRouter()));
// 独立 embedding 提供商：落到 NovelFork 产品库，不挤进 Runtime AI 供应商。
novelDomainRoutes.route("", asRuntimeRouter(createEmbeddingSettingsRouter()));

// Runtime state panel: knowledge / timeline / resource ledger from story/state.
novelDomainRoutes.get("/api/books/:bookId/state", async (c) => {
	const bookId = c.req.param("bookId");
	const bookDir = resolveDomainBookRoot(bookId);
	try {
		const snapshot = await loadRuntimeStateSnapshot(bookDir);
		return c.json({
			knowledge: snapshot.knowledge ?? { events: [] },
			timeline: snapshot.timeline ?? { entries: [] },
			resourceLedger: snapshot.resourceLedger ?? { resources: [] },
		});
	} catch {
		// External/new books may not have story/state yet — return empty panels.
		return c.json({
			knowledge: { events: [] },
			timeline: { entries: [] },
			resourceLedger: { resources: [] },
		});
	}
});

// Collaboration panel used legacy Studio /api/git/* routes. Prefer product book
// workspace root for commit history binding; worktrees remain best-effort empty
// until a Runtime-native worktree list is exposed for book projects.
novelDomainRoutes.get("/api/books/:bookId/collaboration-context", async (c) => {
	const bookId = c.req.param("bookId");
	const bookRoot = resolveDomainBookRoot(bookId);
	return c.json({
		repositoryPath: bookRoot,
		// Runtime 把章节 worktree 建在 <gitPath>/.worktrees 下（chapter-fork / chapter-cleanup），
		// 书籍绑定时 gitPath 与 book_root 是同一个目录；这里只把目录路径交给面板展示，
		// 不依赖已下线的 Studio git API。
		worktreeRoot: join(bookRoot, ".worktrees"),
	});
});
