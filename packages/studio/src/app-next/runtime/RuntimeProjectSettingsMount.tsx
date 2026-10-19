import { lazy, Suspense } from "react";

import { useColorScheme } from "@/hooks/use-color-scheme";

const EmbeddedProjectSettingsHost = lazy(() =>
	import("@vivy1024/narrafork-runtime-bridge/frontend/project-settings").then(
		(module) => ({ default: module.EmbeddedProjectSettingsHost }),
	),
);

export interface RuntimeProjectSettingsMountProps {
	/** Runtime project id the rendered settings belong to; one book binds exactly one project. */
	readonly projectId: string;
}

/**
 * The native Runtime project settings surface (skills, optional tools) inside the writing
 * workbench's book settings.
 *
 * The product shell only chooses where it goes and follows Studio's light/dark switch:
 * storage, capability gates and every write stay Runtime's, so Runtime stays the single
 * authority for project-scoped configuration. Studio no longer keeps a second copy of
 * these panels.
 */
export function RuntimeProjectSettingsMount({ projectId }: RuntimeProjectSettingsMountProps) {
	const colorScheme = useColorScheme();
	return (
		<section
			className="min-h-0 w-full"
			data-testid="runtime-project-settings-mount"
			data-runtime-project-id={projectId}
		>
			<Suspense
				fallback={
					<div role="status" className="p-4 text-sm text-muted-foreground">
						正在加载 Runtime 项目设置…
					</div>
				}
			>
				<EmbeddedProjectSettingsHost key={projectId} projectId={projectId} colorScheme={colorScheme} />
			</Suspense>
		</section>
	);
}
