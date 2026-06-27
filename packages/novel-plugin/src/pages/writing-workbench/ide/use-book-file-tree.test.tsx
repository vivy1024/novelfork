import { describe, expect, it } from "vitest";

import { mapBookFileEntryToNode } from "./use-book-file-tree";

describe("useBookFileTree", () => {
  it("classifies chapters/NNNN_*.md as chapters and other files as plain files", () => {
    const root = mapBookFileEntryToNode({
      name: "story",
      path: "story",
      type: "directory",
      children: [
        { name: "world-model.md", path: "story/world-model.md", type: "file" },
        { name: "notes.txt", path: "story/notes.txt", type: "file" },
        { name: "map.png", path: "story/map.png", type: "file" },
        { name: "0001_开端.md", path: "chapters/0001_开端.md", type: "file" },
      ],
    }, "book-1");

    const storyFile = root.children?.[0];
    const textFile = root.children?.[1];
    const imageFile = root.children?.[2];
    const chapter = root.children?.[3];

    expect(chapter?.kind).toBe("chapter");
    expect(chapter?.metadata?.isChapter).toBe(true);
    expect(chapter?.metadata?.isFile).toBe(true);

    expect(storyFile?.kind).toBe("file");
    expect(storyFile?.metadata?.isChapter).toBeUndefined();
    expect(storyFile?.capabilities.edit).toBe(true);

    expect(textFile?.kind).toBe("file");
    expect(textFile?.capabilities.open).toBe(true);

    expect(imageFile?.kind).toBe("file");
    expect(imageFile?.capabilities.open).toBe(true);
    expect(imageFile?.capabilities.edit).toBe(false);
  });
});
