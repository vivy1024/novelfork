import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeRoot = join(process.cwd(), "src", "app-next", "runtime");
const nativeHostPath = join(
	process.cwd(),
	"..",
	"narrafork-runtime-private",
	"frontend",
	"components",
	"narrator",
	"NovelForkNarratorPanelHost.tsx",
);

const currentProductRoutes = [
	"/api/novelfork/bootstrap",
	"/api/novelfork/books",
	"/api/books/:bookId/narrators",
	"/api/books/:bookId/workspace",
] as const;

async function collectProductionTsxFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (entry.isDirectory()) return collectProductionTsxFiles(path);
			if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx"))
				return [];
			return [path];
		}),
	);
	return nested.flat();
}

describe("NovelFork Runtime product capability matrix", () => {
	it("keeps trusted book bootstrap and workspace resource bindings", async () => {
		const source = await readFile(
			join(runtimeRoot, "product-contract.ts"),
			"utf8",
		);
		expect(source).toContain("RUNTIME_BOOTSTRAP_PATH");
		expect(source).toContain("buildBookScopedNarratorPath");
		expect(source).toContain("buildBookWorkspacePath");
		expect(source).not.toContain("/api/sessions");
		for (const route of currentProductRoutes)
			expect(route.length).toBeGreaterThan(0);
	});

	it("uses one guarded Studio mount for the native NarratorPanel", async () => {
		const appNextRoot = join(process.cwd(), "src", "app-next");
		const files = await collectProductionTsxFiles(appNextRoot);
		const nativeHostImportOwners: string[] = [];
		for (const file of files) {
			const source = await readFile(file, "utf8");
			if (
				source.includes(
					'from "@frontend/components/narrator/NovelForkNarratorPanelHost"',
				) ||
				source.includes(
					'import("@frontend/components/narrator/NovelForkNarratorPanelHost")',
				)
			) {
				nativeHostImportOwners.push(
					relative(appNextRoot, file).replaceAll("\\", "/"),
				);
			}
		}

		const mountSource = await readFile(
			join(runtimeRoot, "RuntimeNarratorPanelMount.tsx"),
			"utf8",
		);
		const routeSource = await readFile(
			join(runtimeRoot, "RuntimeNarratorConversationRoute.tsx"),
			"utf8",
		);
		const workbenchSource = await readFile(
			join(runtimeRoot, "RuntimeWritingWorkbenchRoute.tsx"),
			"utf8",
		);
		const p0Source = await readFile(
			join(
				process.cwd(),
				"src",
				"app-next",
				"p0",
				"RuntimeNarratorConversation.tsx",
			),
			"utf8",
		);
		const hostSource = await readFile(nativeHostPath, "utf8");

		expect(nativeHostImportOwners).toEqual([
			"runtime/RuntimeNarratorPanelMount.tsx",
		]);
		expect(mountSource).toContain("narrator.bookId !== bookId");
		expect(mountSource).toContain("narrator.capabilities.read !== true");
		expect(mountSource).toContain(
			'window.addEventListener("hashchange", update)',
		);
		expect(mountSource).toContain(
			'data-testid="native-runtime-narrator-panel"',
		);
		expect(routeSource).toContain("RuntimeNarratorPanelMount");
		expect(workbenchSource).toContain("RuntimeNarratorPanelMount");
		expect(workbenchSource).toContain("compact");
		expect(p0Source).toContain("RuntimeNarratorPanelMount");
		expect(routeSource).not.toContain("NovelForkNarratorPanelHost");
		expect(workbenchSource).not.toContain("NovelForkNarratorPanelHost");
		expect(p0Source).not.toContain("NovelForkNarratorPanelHost");
		expect(hostSource).toContain(
			'import { NarratorDock } from "./dock/NarratorDock"',
		);
		expect(hostSource).toContain(
			'import { NarratorDockProvider } from "./dock/NarratorDockContext"',
		);
		expect(hostSource).toContain("<NarratorDockProvider");
		expect(hostSource).toContain('<NarratorDock device="desktop" />');
	});

	it("removes the parallel ConversationSurface implementation from Studio", async () => {
		const appSource = await readFile(
			join(process.cwd(), "src", "app-next", "StudioNextApp.tsx"),
			"utf8",
		);
		const legacyConversationRoot = join(
			process.cwd(),
			"src",
			"app-next",
			"agent-conversation",
		);

		await expect(access(legacyConversationRoot)).rejects.toThrow();
		expect(appSource).not.toContain("ConversationSurface");
		expect(appSource).not.toContain("ConversationRouteLive");
		expect(appSource).not.toContain("useAgentConversationRuntime");
		expect(appSource).not.toContain("RuntimeConversationViewModel");
	});

	it("projects novel Runtime renderer metadata into the native ToolCallCard", async () => {
		const mountSource = await readFile(
			join(runtimeRoot, "RuntimeNarratorPanelMount.tsx"),
			"utf8",
		);
		const nativeToolCardSource = await readFile(
			join(
				process.cwd(),
				"..",
				"narrafork-runtime-private",
				"frontend",
				"components",
				"narrator",
				"ToolCallCard.tsx",
			),
			"utf8",
		);
		expect(mountSource).toContain("toolResultRenderer={renderToolResult}");
		expect(nativeToolCardSource).toContain("runtimeRenderer");
		expect(nativeToolCardSource).toContain("data-runtime-renderer");
	});

	it("keeps native NarraFork navigation inside the NovelFork product shell", async () => {
		const routerSource = await readFile(
			join(process.cwd(), "src", "app-next", "router.ts"),
			"utf8",
		);
		expect(routerSource).toContain('path: "/narrators/$narratorId"');
		expect(routerSource).toContain('to: "/next/narrators/$sessionId"');
		expect(routerSource).toContain('path: "/narrators"');
		expect(routerSource).toContain('to: "/next/sessions"');
	});

	it("does not construct client-supplied filesystem or Runtime project identities", async () => {
		const source = await readFile(
			join(runtimeRoot, "product-contract.ts"),
			"utf8",
		);
		const createBookInput = source.slice(
			source.indexOf("export interface RuntimeCreateBookInput"),
			source.indexOf("export interface RuntimeBookProvisionOperation"),
		);
		expect(source).not.toContain("bookRoot");
		expect(source).not.toContain("filesystemPath");
		expect(createBookInput).not.toContain("projectId");
		expect(source).toContain("withoutProjectId");
	});
});
