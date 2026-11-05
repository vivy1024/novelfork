import { useEffect, useState } from "react";

import { RuntimePageMount } from "../runtime/RuntimePageMount";
import { RUNTIME_PAGE_SECTIONS } from "../runtime/runtime-page-sections";
import type { RoutinesRoute } from "../shell/shell-route";
import { NOVELFORK_ROUTINES_EXTENSION } from "./novelfork-routines-extension";

const RUNTIME_ROUTINES_ROOT = RUNTIME_PAGE_SECTIONS.routines;

export interface RoutinesNextPageProps {
	readonly route: RoutinesRoute;
	readonly onNavigate: (route: RoutinesRoute) => void;
	/** Runtime 原页要去 /routines 以外的 Runtime 路径（叙述者、设置……），由外壳决定去哪。 */
	readonly onNavigateRuntimePath: (path: string) => void;
}

/**
 * 套路页：只有 Runtime 原生套路页这一层。
 *
 * Studio 不再维护「本书设置」副本——按书的设置只有写作台 › 本书设置一个入口，那里嵌的
 * 是 Runtime 自己的项目设置界面（见 RuntimeProjectSettingsMount）。
 */
export function RoutinesNextPage({
	route,
	onNavigate,
	onNavigateRuntimePath,
}: RoutinesNextPageProps) {
	const routeRuntimePath = "panel" in route ? null : (route.path ?? RUNTIME_ROUTINES_ROOT);
	const [lastRuntimePath, setLastRuntimePath] = useState(routeRuntimePath ?? RUNTIME_ROUTINES_ROOT);

	useEffect(() => {
		if (routeRuntimePath === null) return;
		setLastRuntimePath(routeRuntimePath);
	}, [routeRuntimePath]);

	return (
		<section aria-label="套路" data-testid="routines-page" className="flex h-full min-h-0 w-full flex-col">
			<h1 className="sr-only">套路</h1>

			<div className="min-h-0 flex-1" data-testid="routines-runtime-page">
				<RuntimePageMount
					section="routines"
					hostExtension={NOVELFORK_ROUTINES_EXTENSION}
					path={routeRuntimePath ?? lastRuntimePath}
					onPathChange={(path) => onNavigate({ kind: "routines", path })}
					onNavigateOutside={onNavigateRuntimePath}
				/>
			</div>
		</section>
	);
}
