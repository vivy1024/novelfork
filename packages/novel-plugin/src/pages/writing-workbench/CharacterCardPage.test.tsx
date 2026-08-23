import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({ fetchJson: fetchJsonMock }));
vi.mock("@tiptap/react", () => ({
  useEditor: () => null,
  EditorContent: () => null,
}));

import { CharacterCardPage } from "./CharacterCardPage";

const entry = {
  id: "character-1",
  title: "薛行之",
  contentMd: "",
  category: "characters",
  fields: {
    core_motive: "护住身边的人",
    relationship_summary: "白起=亦敌亦友",
  },
  visibility: "tracked" as const,
};

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("CharacterCardPage", () => {
  it("保留静态编辑区并渲染叙事记忆发展历程", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("facts/by-entity")) {
        return {
          groups: [{ entity: "薛行之", facts: [
            { id: "fact-realm", predicate: "修为", object: "筑基后期", sourceChapter: 12 },
            { id: "fact-item", predicate: "持有", object: "青锋剑", sourceChapter: 11 },
            { id: "fact-injury", predicate: "伤势", object: "左臂骨折", sourceChapter: 13 },
          ] }],
        };
      }
      if (url.includes("view=event_chain")) {
        return { events: [{ chapterNumber: 13, eventType: "character_state_changed", evidenceText: "薛行之为救白起受伤。" }] };
      }
      return {
        facts: [{ subject: "薛行之", predicate: "亦敌亦友", object: "白起", sourceChapter: 13 }],
        events: [{ chapterNumber: 13, eventType: "relationship_changed", subject: "薛行之", predicate: "信任上升", object: "白起" }],
      };
    });

    render(<CharacterCardPage entry={entry} bookId="book-1" saving={false} onSave={vi.fn(async () => undefined)} />);

    expect(screen.getByText("经典台词")).toBeTruthy();
    expect(screen.getByDisplayValue("白起=亦敌亦友")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/筑基后期/)).toBeTruthy());
    expect(screen.getByText("薛行之为救白起受伤。")).toBeTruthy();
    expect(screen.getByText("关系演化")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledTimes(3);
  });
});
