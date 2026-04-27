export type StudioEntryMode = "legacy" | "next";
export type StudioNextRoute = "dashboard" | "workspace" | "settings" | "routines" | "workflow";

export const STUDIO_NEXT_BASE_PATH = "/next";

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

export function resolveStudioEntryMode(pathname = globalThis.location?.pathname ?? "/"): StudioEntryMode {
  const normalized = normalizePathname(pathname);
  return normalized === STUDIO_NEXT_BASE_PATH || normalized.startsWith(`${STUDIO_NEXT_BASE_PATH}/`)
    ? "next"
    : "legacy";
}

export function resolveStudioNextRoute(pathname = globalThis.location?.pathname ?? STUDIO_NEXT_BASE_PATH): StudioNextRoute {
  const normalized = normalizePathname(pathname);
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/dashboard`) return "dashboard";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/settings`) return "settings";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/routines`) return "routines";
  if (normalized === `${STUDIO_NEXT_BASE_PATH}/workflow`) return "workflow";
  return "workspace";
}
