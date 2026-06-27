import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { sceneSpecToContextCards } from "../context-card.js";

export interface SceneSpecChannelInput {
  readonly bookId: string;
  readonly sceneSpec?: SceneSpec;
}

export function createSceneSpecChannel(): NarrativeRetrievalChannel<SceneSpecChannelInput> {
  return {
    name: "scene-spec",
    run(input) {
      if (!input.sceneSpec) {
        return { status: "skipped", cards: [], warnings: ["SceneSpec 未提供，scene-spec 通道跳过。"] };
      }
      return {
        cards: sceneSpecToContextCards({ bookId: input.bookId, sceneSpec: input.sceneSpec }),
        warnings: [],
      };
    },
  };
}
