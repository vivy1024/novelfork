import { lazy, Suspense, useCallback } from "react";

import { useColorScheme } from "@/hooks/use-color-scheme";

import { RUNTIME_PAGE_SECTIONS, runtimePathInSection, type RuntimePageSection } from "./runtime-page-sections";

const EmbeddedRuntimePageHost = lazy(() =>
  import("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page").then((module) => ({
    default: module.EmbeddedRuntimePageHost,
  })),
);

export interface RuntimePageMountProps {
  readonly section: RuntimePageSection;
  /** Runtime 路径（含查询串），缺省为入口根路径。 */
  readonly path?: string;
  /** 页面在本入口内跳转：Studio 把它同步进自己的地址栏。 */
  readonly onPathChange: (path: string) => void;
  /** 页面要去别处（叙述者、别的原页……）：由 Studio 外壳决定去哪。 */
  readonly onNavigateOutside: (path: string) => void;
}

export function RuntimePageMount({ section, path, onPathChange, onNavigateOutside }: RuntimePageMountProps) {
  const colorScheme = useColorScheme();
  const isEmbeddedPath = useCallback((pathname: string) => runtimePathInSection(section, pathname), [section]);
  return (
    <div data-testid="runtime-page-mount" data-runtime-section={section} className="h-full min-h-0 overflow-auto">
      <Suspense fallback={<div role="status" className="p-4 text-sm text-muted-foreground">正在加载…</div>}>
        <EmbeddedRuntimePageHost
          key={section}
          path={path ?? RUNTIME_PAGE_SECTIONS[section]}
          isEmbeddedPath={isEmbeddedPath}
          onPathChange={onPathChange}
          onNavigateOutside={onNavigateOutside}
          colorScheme={colorScheme}
        />
      </Suspense>
    </div>
  );
}
