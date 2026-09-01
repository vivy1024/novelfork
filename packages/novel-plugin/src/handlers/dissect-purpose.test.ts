import { describe, expect, it } from "vitest";

import { extractKnowledgePack } from "./dissect-knowledge.js";
import {
  filterKnowledgeForPurpose,
  resolveDissectPurpose,
  resolveDissectTargets,
  shouldStageKind,
} from "./dissect-purpose.js";

describe("dissect purpose", () => {
  it("accepts Chinese and English purpose aliases", () => {
    expect(resolveDissectPurpose(undefined)).toBe("continue");
    expect(resolveDissectPurpose("写后续")).toBe("continue");
    expect(resolveDissectPurpose("同人")).toBe("fanfic");
    expect(resolveDissectPurpose("改编")).toBe("adapt");
    expect(resolveDissectPurpose("AI漫剧剧本")).toBe("drama");
    expect(resolveDissectPurpose("mystery")).toBe("invalid");
  });

  it("keeps fanfic drafts to original-cast entities, not sequel progress", () => {
    const pack = extractKnowledgePack([
      {
        number: 1,
        title: "第一章",
        content: "韩立冷声道：「日后自有分晓。」他来到药园，不知为何心神不宁。",
      },
    ]);
    const filtered = filterKnowledgeForPurpose(pack, "fanfic");
    expect(filtered.characterCards.length).toBeGreaterThan(0);
    expect(filtered.worldElements.some((item) => item.category === "location")).toBe(true);
    expect(filtered.openHooks).toEqual([]);
    expect(filtered.detailedSummaries).toEqual([]);
    expect(shouldStageKind("fanfic", "foreshadowing")).toBe(false);
    expect(shouldStageKind("fanfic", "characters")).toBe(true);
    expect([...resolveDissectTargets("drama")]).toEqual(expect.arrayContaining(["characters", "summaries"]));
    expect(shouldStageKind("drama", "foreshadowing")).toBe(false);
    expect(shouldStageKind("drama", "chapter-summaries")).toBe(true);
  });
});
