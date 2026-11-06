import { describe, expect, it } from "vitest";

import { CATEGORY_META } from "../../../engine/jingwei/unified-categories";
import { workspaceForCategory } from "../lore-workspace-split";
import {
  STORYLINE_SUB_TABS,
  WORKBENCH_VIEW_ARTIFACT_KIND,
  parseStorylineViewArtifact,
  storylineTabForCategory,
  storylineViewArtifactId,
} from "./sidebar-tabs-model";

describe("sidebar-tabs-model", () => {
  it("每个随剧情变化的分类在故事推进都有页签；静态设定分类不进故事推进", () => {
    for (const meta of CATEGORY_META) {
      const tab = storylineTabForCategory(meta.id);
      if (workspaceForCategory(meta.id) === "progress") {
        expect(tab, meta.id).toBeDefined();
        expect(STORYLINE_SUB_TABS).toContain(tab);
      } else {
        expect(tab, meta.id).toBeUndefined();
      }
    }
  });

  it("结果卡产物与页签互相还原；别的产物与未知页签一律不认", () => {
    expect(parseStorylineViewArtifact({ kind: WORKBENCH_VIEW_ARTIFACT_KIND, id: storylineViewArtifactId("timeline") })).toBe("timeline");
    expect(parseStorylineViewArtifact({ kind: WORKBENCH_VIEW_ARTIFACT_KIND, id: "storyline:nope" })).toBeNull();
    expect(parseStorylineViewArtifact({ kind: "chapter", id: "storyline:timeline" })).toBeNull();
    expect(parseStorylineViewArtifact({ kind: WORKBENCH_VIEW_ARTIFACT_KIND, id: 3 })).toBeNull();
  });
});
