/**
 * Builtin hooks - Pre-built hook handlers for common use cases
 */

import type { HookContext, PipelineHooks } from "./types.js";
import type { NotifyChannel } from "../models/project.js";
import { dispatchNotification, dispatchWebhookEvent } from "../notify/dispatcher.js";

/**
 * Create a notification hook that sends messages via configured channels
 */
export function createNotificationHook(
  channels: ReadonlyArray<NotifyChannel>
): PipelineHooks {
  if (!channels || channels.length === 0) {
    return {};
  }

  return {
    onChapterComplete: async (ctx) => {
      const { book, chapterNumber, metadata } = ctx;
      const title = (metadata.title as string) || `第${chapterNumber}章`;
      const wordCount = (metadata.wordCount as number) || 0;
      const auditPassed = (metadata.auditPassed as boolean) || false;
      const lengthFormatted = (metadata.lengthFormatted as string) || `${wordCount}字`;

      const statusEmoji = auditPassed ? "✅" : "⚠️";
      const body = [
        `**${title}** | ${lengthFormatted}`,
        auditPassed ? "审计通过" : "审计发现问题",
        metadata.auditSummary ? `\n${metadata.auditSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await dispatchNotification(channels, {
        title: `${statusEmoji} ${book.title} 第${chapterNumber}章`,
        body,
      });

      // Also dispatch structured webhook event
      await dispatchWebhookEvent(channels, {
        event: "chapter-complete",
        bookId: book.id || "",
        chapterNumber,
        timestamp: ctx.timestamp.toISOString(),
        data: {
          title,
          wordCount,
          auditPassed,
        },
      });
    },

    onChapterFailed: async (ctx) => {
      const { book, chapterNumber, metadata } = ctx;
      const error = (metadata.error as string) || "未知错误";
      const stage = (metadata.failedStage as string) || "unknown";

      await dispatchNotification(channels, {
        title: `❌ ${book.title} 第${chapterNumber}章失败`,
        body: `阶段: ${stage}\n错误: ${error}`,
      });

      await dispatchWebhookEvent(channels, {
        event: "chapter-failed",
        bookId: book.id || "",
        chapterNumber,
        timestamp: ctx.timestamp.toISOString(),
        data: {
          stage,
          error,
        },
      });
    },
  };
}

/**
 * Create a logging hook that logs pipeline progress
 */
export function createLoggingHook(
  logger: { info: (msg: string) => void }
): PipelineHooks {
  return {
    onBeforePlan: async (ctx) => {
      logger.info(`[Hook] Starting plan for chapter ${ctx.chapterNumber}`);
    },
    onAfterWrite: async (ctx) => {
      const wordCount = ctx.metadata.wordCount as number;
      logger.info(
        `[Hook] Completed write for chapter ${ctx.chapterNumber}: ${wordCount} words`
      );
    },
    onChapterComplete: async (ctx) => {
      logger.info(`[Hook] Chapter ${ctx.chapterNumber} pipeline complete`);
    },
    onChapterFailed: async (ctx) => {
      const error = ctx.metadata.error as string;
      logger.info(`[Hook] Chapter ${ctx.chapterNumber} failed: ${error}`);
    },
  };
}

/**
 * Create an auto-backup hook that saves artifacts at key stages
 */
export function createAutoBackupHook(
  backupFn: (chapterNumber: number, stage: string) => Promise<void>
): PipelineHooks {
  return {
    onAfterWrite: async (ctx) => {
      await backupFn(ctx.chapterNumber, "write");
    },
    onAfterAudit: async (ctx) => {
      await backupFn(ctx.chapterNumber, "audit");
    },
    onChapterComplete: async (ctx) => {
      await backupFn(ctx.chapterNumber, "complete");
    },
  };
}
