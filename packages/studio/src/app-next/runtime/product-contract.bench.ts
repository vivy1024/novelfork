import { bench, describe } from "vitest";

import { mapRuntimeBootstrap } from "./product-contract";

function bootstrapFixture() {
  return {
    books: Array.from({ length: 100 }, (_, index) => ({
      id: `book-${index}`,
      title: `作品 ${index}`,
      capabilities: { read: true, create: index === 0 },
    })),
    narrators: Array.from({ length: 100 }, (_, index) => ({
      id: `narrator-${index}`,
      bookId: `book-${index}`,
      title: `叙述者 ${index}`,
      capabilities: { read: true, send: true, interrupt: true },
    })),
    model: { setupRequired: false, label: "Runtime baseline" },
    capabilities: {
      books: { read: true, create: true },
      narrators: { read: true },
      workspace: { read: true, create: true, update: true },
    },
  };
}

describe("NovelFork Runtime product contract baseline", () => {
  bench("map 100 books and 100 narrators", () => {
    mapRuntimeBootstrap(bootstrapFixture());
  });
});
