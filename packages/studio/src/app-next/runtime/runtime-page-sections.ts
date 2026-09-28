/** Runtime 原页在 Studio 里的入口：每个入口管 Runtime 的一段路径（Studio 地址是 `/next` + Runtime 路径）。 */
export const RUNTIME_PAGE_SECTIONS = {
  search: "/search",
  knowledge: "/knowledge",
  "scheduled-tasks": "/scheduled-tasks",
  learn: "/learn",
} as const;

export type RuntimePageSection = keyof typeof RUNTIME_PAGE_SECTIONS;

export function isRuntimePageSection(value: string): value is RuntimePageSection {
  return Object.hasOwn(RUNTIME_PAGE_SECTIONS, value);
}

/** Runtime 路径是否落在这个入口管的那段里（`/knowledge` 管 `/knowledge` 与 `/knowledge/…`）。 */
export function runtimePathInSection(section: RuntimePageSection, pathname: string): boolean {
  const root = RUNTIME_PAGE_SECTIONS[section];
  return pathname === root || pathname.startsWith(`${root}/`);
}

/** Runtime 路径属于哪个入口；不属于任何入口时返回 null。 */
export function runtimePageSectionOf(pathname: string): RuntimePageSection | null {
  for (const section of Object.keys(RUNTIME_PAGE_SECTIONS) as RuntimePageSection[]) {
    if (runtimePathInSection(section, pathname)) return section;
  }
  return null;
}
