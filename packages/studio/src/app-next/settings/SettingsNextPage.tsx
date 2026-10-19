import { RuntimePageMount } from "../runtime/RuntimePageMount";
import { RUNTIME_PAGE_SECTIONS } from "../runtime/runtime-page-sections";
import type { SettingsRoute } from "../shell/shell-route";
import { NOVELFORK_SETTINGS_EXTENSION } from "./novelfork-settings-extension";

const RUNTIME_SETTINGS_ROOT = RUNTIME_PAGE_SECTIONS.settings;

export interface SettingsNextPageProps {
	readonly route: SettingsRoute;
	readonly onNavigate: (route: SettingsRoute) => void;
	/** Runtime 原页要去 /settings 以外的 Runtime 路径（叙述者、套路……），由外壳决定去哪。 */
	readonly onNavigateRuntimePath: (path: string) => void;
}

/**
 * 设置页只有一层导航：Runtime 原生设置页（左侧栏），产品设置作为其中的「小说」分组
 * 经 hostExtension 并入同一侧栏。初始向导也只用 Runtime 自己的（fork 层在设置页里挂载）。
 */
export function SettingsNextPage({ route, onNavigate, onNavigateRuntimePath }: SettingsNextPageProps) {
	const routeRuntimePath = route.path ?? RUNTIME_SETTINGS_ROOT;

	return (
		<section aria-label="设置" data-testid="settings-page" className="flex h-full min-h-0 w-full flex-col">
			<div className="min-h-0 flex-1" data-testid="settings-runtime-page">
				<RuntimePageMount
					section="settings"
					path={routeRuntimePath}
					hostExtension={NOVELFORK_SETTINGS_EXTENSION}
					onPathChange={(path) => onNavigate({ kind: "settings", path })}
					onNavigateOutside={onNavigateRuntimePath}
				/>
			</div>
		</section>
	);
}
