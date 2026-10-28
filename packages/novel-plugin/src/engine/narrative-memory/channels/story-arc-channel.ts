/**
 * 层级前情通道（story-arc）：本卷前情 / 前卷卷摘要 / 全书梗概。
 *
 * 卡片挂在 timeline 分段（channel = "timeline"，带 story-arc 标签），预算在 budget.ts 的
 * 层级前情档位里单独装箱：按 priority 降档/丢弃，顺序为 本卷前情 > 前卷（近→远）> 全书梗概；
 * 近章（recent-summary 通道）不在这个档位里，永远优先于它们。
 *
 * 内容全部由经纬章摘要现场派生（见 story-arc.ts），不落库；失败只跳过本通道。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NarrativeRetrievalChannel } from "../channels.js";
import { buildStoryArcCards } from "../story-arc.js";

export interface StoryArcChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  /** recent-summary 通道细粒度注入的最近章数；这些章不再进卷摘要。 */
  readonly recentChapterCount?: number;
  /** 单独出卡的前卷数（默认 5），更早的并入全书梗概。 */
  readonly priorVolumeCards?: number;
}

export function createStoryArcChannel(): NarrativeRetrievalChannel<StoryArcChannelInput> {
  return {
    name: "story-arc",
    run(input) {
      if (input.currentChapter === undefined || input.currentChapter <= 1) {
        return { status: "skipped", cards: [], warnings: [] };
      }
      try {
        const result = buildStoryArcCards({
          storage: input.storage,
          bookId: input.bookId,
          currentChapter: input.currentChapter,
          ...(input.recentChapterCount !== undefined ? { recentChapterCount: input.recentChapterCount } : {}),
          ...(input.priorVolumeCards !== undefined ? { priorVolumeCards: input.priorVolumeCards } : {}),
        });
        if (result.cards.length === 0) {
          return { status: "skipped", cards: [], warnings: [], diagnostics: result.diagnostics };
        }
        return { cards: result.cards, warnings: [], diagnostics: result.diagnostics };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: "skipped", cards: [], warnings: [`story-arc 层级前情失败已跳过：${message}`] };
      }
    },
  };
}
