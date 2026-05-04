import { parseShellRoute, STUDIO_NEXT_BASE_PATH, type ShellRoute } from "./shell/shell-route";

export { STUDIO_NEXT_BASE_PATH };
export type StudioNextRoute = ShellRoute;

export function resolveStudioNextRoute(pathname = globalThis.location?.pathname ?? STUDIO_NEXT_BASE_PATH): StudioNextRoute {
  return parseShellRoute(pathname);
}
