import type { Route } from "./routes";

export function deriveActiveBookId(route: Route): string | undefined {
  return route.page === "book"
    || route.page === "chapter"
    || route.page === "truth"
    || route.page === "presets"
    || route.page === "bible"
    || route.page === "analytics"
    || route.page === "diff"
    || route.page === "detect"
    || route.page === "intent"
    || route.page === "state"
    ? route.bookId
    : undefined;
}
