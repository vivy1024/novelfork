import { lazy, Suspense, useEffect, useState } from "react";

import { RuntimePageMount } from "../runtime/RuntimePageMount";
import { RUNTIME_PAGE_SECTIONS } from "../runtime/runtime-page-sections";
import type { RoutinesRoute, ShellBookItem } from "../shell/shell-route";
import { NOVELFORK_ROUTINES_EXTENSION } from "./novelfork-routines-extension";

const RUNTIME_ROUTINES_ROOT = RUNTIME_PAGE_SECTIONS.routines;

// 工作流页属于小说领域，由 novel-plugin 提供；只有切到它时才加载。
const WorkflowsPage = lazy(() =>
	import("@vivy1024/novelfork-novel-plugin/pages/workflows").then((m) => ({ default: m.WorkflowsPage })),
);

export interface RoutinesNextPageProps {
	readonly route: RoutinesRoute;
	readonly onNavigate: (route: RoutinesRoute) => void;
	/** Runtime 原页要去 /routines 以外的 Runtime 路径（叙述者、设置……），由外壳决定去哪。 */
	readonly onNavigateRuntimePath: (path: string) => void;
	/** 工作流按书保存：页面顶部选书。 */
	readonly books?: readonly ShellBookItem[];
	readonly selectedBookId?: string | null;
	readonly onSelectBook?: (bookId: string) => void;
}

/**
 * 套路页：Runtime 原生套路页 + NovelFork 的「工作流」页。
 *
 * Runtime 套路页没有给产品插页签的扩展点（只有子代理可选工具 subagentTools），
 * 所以两页的切换放在 Studio 这一层：顶部一排切换按钮，「通用套路」嵌 Runtime 原页，
 * 「工作流」是小说写章流程（按书的方案、运行、子代理一览）。
 * 按书的其它设置仍只有写作台 › 本书设置一个入口。
 */
export function RoutinesNextPage({
	route,
	onNavigate,
	onNavigateRuntimePath,
	books = [],
	selectedBookId = null,
	onSelectBook,
}: RoutinesNextPageProps) {
	const panel = "panel" in route ? route.panel : null;
	const routeRuntimePath = panel ? null : (("path" in route ? route.path : undefined) ?? RUNTIME_ROUTINES_ROOT);
	const [lastRuntimePath, setLastRuntimePath] = useState(routeRuntimePath ?? RUNTIME_ROUTINES_ROOT);
	const [localBookId, setLocalBookId] = useState<string | null>(selectedBookId);

	useEffect(() => {
		if (routeRuntimePath === null) return;
		setLastRuntimePath(routeRuntimePath);
	}, [routeRuntimePath]);

	useEffect(() => {
		if (selectedBookId) setLocalBookId(selectedBookId);
	}, [selectedBookId]);

	const tabClass = (active: boolean) =>
		`rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
			active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
		}`;

	return (
		<section aria-label="套路" data-testid="routines-page" className="flex h-full min-h-0 w-full flex-col">
			<h1 className="sr-only">套路</h1>
			<nav aria-label="套路分区" className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
				<div className="inline-flex rounded-lg bg-muted p-[3px]">
					<button
						type="button"
						aria-current={panel === null ? "page" : undefined}
						className={tabClass(panel === null)}
						onClick={() => onNavigate({ kind: "routines", path: lastRuntimePath })}
						data-testid="routines-tab-runtime"
					>
						通用套路
					</button>
					<button
						type="button"
						aria-current={panel === "workflows" ? "page" : undefined}
						className={tabClass(panel === "workflows")}
						onClick={() => onNavigate({ kind: "routines", panel: "workflows" })}
						data-testid="routines-tab-workflows"
					>
						工作流
					</button>
				</div>
			</nav>

			{panel === "workflows" ? (
				<div className="min-h-0 flex-1" data-testid="routines-workflows-page">
					<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">正在载入…</div>}>
						<WorkflowsPage
							books={books.map((book) => ({ id: book.id, title: book.title }))}
							selectedBookId={localBookId}
							onSelectBook={(bookId) => {
								setLocalBookId(bookId);
								onSelectBook?.(bookId);
							}}
						/>
					</Suspense>
				</div>
			) : (
				<div className="min-h-0 flex-1" data-testid="routines-runtime-page">
					<RuntimePageMount
						section="routines"
						hostExtension={NOVELFORK_ROUTINES_EXTENSION}
						path={routeRuntimePath ?? lastRuntimePath}
						onPathChange={(path) => onNavigate({ kind: "routines", path })}
						onNavigateOutside={onNavigateRuntimePath}
					/>
				</div>
			)}
		</section>
	);
}
