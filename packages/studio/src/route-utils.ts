import type { Route } from "./App";

export function deriveActiveBookId(route: Route): string | undefined {
  return route.page === "book"
    || route.page === "chapter"
    || route.page === "truth"
    || route.page === "analytics"
    || route.page === "diff"
    || route.page === "detect"
    || route.page === "intent"
    || route.page === "state"
    ? route.bookId
    : undefined;
}
