import { BookOpen, Bot, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { RuntimePageMount } from "../runtime/RuntimePageMount";
import { RUNTIME_PAGE_SECTIONS } from "../runtime/runtime-page-sections";
import type { RoutinesNovelPanel, RoutinesRoute, ShellBookItem } from "../shell/shell-route";
import { BookRoutineSettingsPanel } from "./BookRoutineSettingsPanel";
import { SubagentNovelToolsPanel } from "./SubagentNovelToolsPanel";

const RUNTIME_ROUTINES_ROOT = RUNTIME_PAGE_SECTIONS.routines;

const TABS: ReadonlyArray<{
	readonly id: RoutinesNovelPanel | "runtime";
	readonly label: string;
	readonly icon: typeof Workflow;
	readonly description: string;
}> = [
	{
		id: "runtime",
		label: "通用套路",
		icon: Workflow,
		description:
			"NarraFork Runtime 自带的套路页，全局生效：命令、可选工具（手动 / 自动 / 常驻）、工具权限、技能、子代理、提示词、MCP 与钩子，对所有作品和叙述者都起作用。",
	},
	{
		id: "book",
		label: "本书设置",
		icon: BookOpen,
		description:
			"只对一本书生效。写作配置是小说专属，只在这里；可选工具、技能、规则、MCP 权限与钩子在这里按书覆盖「通用套路」，没有覆盖的项沿用全局。",
	},
	{
		id: "subagent-tools",
		label: "子代理小说工具",
		icon: Bot,
		description: "给「通用套路 › 自定义子代理」里的子代理加上读章节、经纬、记忆等小说工具；Runtime 原页只列通用工具。",
	},
];

export interface RoutinesNextPageProps {
	readonly route: RoutinesRoute;
	readonly onNavigate: (route: RoutinesRoute) => void;
	/** Runtime 原页要去 /routines 以外的 Runtime 路径（叙述者、设置……），由外壳决定去哪。 */
	readonly onNavigateRuntimePath: (path: string) => void;
	readonly books: readonly ShellBookItem[];
	readonly selectedBook: ShellBookItem | null;
	readonly onSelectBook: (bookId: string) => void;
}

/**
 * 套路页：通用部分直接嵌 Runtime 原生套路页（Studio 不再维护复制品），
 * Runtime 没有的小说专属设置是 NovelFork 自己的两个面板。
 */
export function RoutinesNextPage({
	route,
	onNavigate,
	onNavigateRuntimePath,
	books,
	selectedBook,
	onSelectBook,
}: RoutinesNextPageProps) {
	const panel = "panel" in route ? route.panel : null;
	const routeRuntimePath = "panel" in route ? null : (route.path ?? RUNTIME_ROUTINES_ROOT);
	// 切到 NovelFork 面板时 Runtime 原页只是藏起来：回来时仍停在原来的子页与页签上。
	const [lastRuntimePath, setLastRuntimePath] = useState(routeRuntimePath ?? RUNTIME_ROUTINES_ROOT);
	const [runtimeMounted, setRuntimeMounted] = useState(routeRuntimePath !== null);

	useEffect(() => {
		if (routeRuntimePath === null) return;
		setLastRuntimePath(routeRuntimePath);
		setRuntimeMounted(true);
	}, [routeRuntimePath]);

	const activeTab = TABS.find((tab) => tab.id === (panel ?? "runtime")) ?? TABS[0]!;

	function openTab(id: RoutinesNovelPanel | "runtime") {
		if (id !== "runtime") {
			onNavigate({ kind: "routines", panel: id });
			return;
		}
		onNavigate(lastRuntimePath === RUNTIME_ROUTINES_ROOT ? { kind: "routines" } : { kind: "routines", path: lastRuntimePath });
	}

	return (
		<section aria-label="套路" data-testid="routines-page" className="flex h-full min-h-0 w-full flex-col">
			{/* 宽度对齐 Runtime 原页的 Container（Mantine md = 960px，两侧 16px 内边距） */}
			<header className="shrink-0 border-b bg-background py-3">
				<div className="mx-auto flex w-full max-w-[960px] flex-col gap-2 px-4">
					<h1 className="sr-only">套路</h1>
					<div role="tablist" aria-label="套路页签" className="flex flex-wrap gap-1">
						{TABS.map((tab) => {
							const Icon = tab.icon;
							const selected = tab.id === activeTab.id;
							return (
								<Button
									key={tab.id}
									type="button"
									role="tab"
									aria-selected={selected}
									variant={selected ? "secondary" : "ghost"}
									size="sm"
									onClick={() => openTab(tab.id)}
								>
									<Icon data-icon="inline-start" />
									{tab.label}
								</Button>
							);
						})}
					</div>
					<p className="text-sm text-muted-foreground">{activeTab.description}</p>
				</div>
			</header>

			<div className="min-h-0 flex-1">
				{runtimeMounted && (
					<div hidden={panel !== null} className="h-full min-h-0" data-testid="routines-runtime-page">
						<RuntimePageMount
							section="routines"
							path={routeRuntimePath ?? lastRuntimePath}
							onPathChange={(path) => onNavigate({ kind: "routines", path })}
							onNavigateOutside={onNavigateRuntimePath}
						/>
					</div>
				)}
				{panel !== null && (
					<div role="tabpanel" aria-label={activeTab.label} className="h-full min-h-0 overflow-y-auto">
						<div className="mx-auto w-full max-w-[960px] p-4">
							{panel === "book" ? (
								<BookRoutineSettingsPanel books={books} selectedBook={selectedBook} onSelectBook={onSelectBook} />
							) : (
								<SubagentNovelToolsPanel />
							)}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
