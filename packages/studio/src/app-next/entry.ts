export type StudioNextRoute = "dashboard" | "workspace" | "settings" | "routines" | "workflow" | "search" | "sessions" | "studio";

export const STUDIO_NEXT_BASE_PATH = "/next";

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

export function resolveStudioNextRoute(pathname = globalThis.location?.pathname ?? STUDIO_NEXT_BASE_PATH): StudioNextRoute {
  const normalized = normalizePathname(pathname);
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/dashboard`) return "dashboard";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/settings`) return "settings";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/routines`) return "routines";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/workflow`) return "workflow";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/search`) return "search";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/sessions`) return "sessions";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/studio`) return "studio";
  return "workspace";
}
