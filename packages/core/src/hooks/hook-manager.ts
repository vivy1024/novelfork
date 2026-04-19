/**
 * HookManager - Central registry and executor for pipeline hooks
 */

import type {
  HookContext,
  HookHandler,
  PipelineHooks,
  PipelineStage,
  HookConfig,
} from "./types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Maps stage names to hook method names
 */
const STAGE_TO_HOOK_METHOD: Record<PipelineStage, keyof PipelineHooks> = {
  "before-plan": "onBeforePlan",
  "after-plan": "onAfterPlan",
  "before-compose": "onBeforeCompose",
  "after-compose": "onAfterCompose",
  "before-write": "onBeforeWrite",
  "after-write": "onAfterWrite",
  "before-normalize": "onBeforeNormalize",
  "after-normalize": "onAfterNormalize",
  "before-settle": "onBeforeSettle",
  "after-settle": "onAfterSettle",
  "before-audit": "onBeforeAudit",
  "after-audit": "onAfterAudit",
  "before-revise": "onBeforeRevise",
  "after-revise": "onAfterRevise",
  "chapter-complete": "onChapterComplete",
  "chapter-failed": "onChapterFailed",
};

/**
 * HookManager manages hook registration and execution
 */
export class HookManager {
  private hooks: Map<PipelineStage, HookHandler[]> = new Map();
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Register a hook handler for a specific stage
   */
  register(stage: PipelineStage, handler: HookHandler): void {
    if (!this.hooks.has(stage)) {
      this.hooks.set(stage, []);
    }
    this.hooks.get(stage)!.push(handler);
  }

  /**
   * Register multiple hooks from a PipelineHooks object
   */
  registerHooks(hooks: PipelineHooks): void {
    for (const [stage, methodName] of Object.entries(STAGE_TO_HOOK_METHOD)) {
      const handler = hooks[methodName];
      if (handler) {
        this.register(stage as PipelineStage, handler);
      }
    }
  }

  /**
   * Register hooks from configuration (novelfork.json)
   */
  async registerFromConfig(configs: ReadonlyArray<HookConfig>): Promise<void> {
    for (const config of configs) {
      if (config.enabled === false) continue;

      if (config.type === "builtin") {
        // Builtin hooks are registered separately (e.g., notification hook)
        continue;
      }

      if (config.type === "script" && config.script) {
        // Dynamic import of custom hook scripts
        try {
          const module = await import(config.script);
          const handler = module.default as HookHandler;
          for (const stage of config.stages) {
            this.register(stage, handler);
          }
          this.logger?.info(`Registered script hook: ${config.name}`);
        } catch (e) {
          this.logger?.error(`Failed to load hook script ${config.script}: ${e}`);
        }
      }
    }
  }

  /**
   * Execute all hooks registered for a stage
   */
  async execute(stage: PipelineStage, ctx: HookContext): Promise<void> {
    const handlers = this.hooks.get(stage);
    if (!handlers || handlers.length === 0) return;

    this.logger?.debug(`Executing ${handlers.length} hook(s) for stage: ${stage}`);

    // Execute hooks in parallel (they should be independent)
    const results = await Promise.allSettled(
      handlers.map((handler) => Promise.resolve(handler(ctx)))
    );

    // Log failures but don't throw - hooks should not block pipeline
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        this.logger?.error(
          `Hook ${i + 1} failed at stage ${stage}: ${result.reason}`
        );
      }
    }
  }

  /**
   * Clear all registered hooks
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Get count of registered hooks for a stage
   */
  getHookCount(stage: PipelineStage): number {
    return this.hooks.get(stage)?.length ?? 0;
  }

  /**
   * Get all registered stages
   */
  getRegisteredStages(): PipelineStage[] {
    return Array.from(this.hooks.keys());
  }
}

/**
 * Create a notification hook that dispatches messages at chapter-complete
 */
export function createNotificationHook(
  dispatcher: (title: string, body: string) => Promise<void>
): PipelineHooks {
  return {
    onChapterComplete: async (ctx) => {
      const { book, chapterNumber, metadata } = ctx;
      const title = metadata.title as string || `第${chapterNumber}章`;
      const wordCount = metadata.wordCount as number || 0;
      const auditPassed = metadata.auditPassed as boolean || false;

      const statusEmoji = auditPassed ? "✅" : "⚠️";
      const body = [
        `**${title}** | ${wordCount}字`,
        auditPassed ? "审计通过" : "审计发现问题",
      ].join("\n");

      await dispatcher(`${statusEmoji} ${book.title} 第${chapterNumber}章`, body);
    },
    onChapterFailed: async (ctx) => {
      const { book, chapterNumber, metadata } = ctx;
      const error = metadata.error as string || "未知错误";
      await dispatcher(
        `❌ ${book.title} 第${chapterNumber}章失败`,
        `错误: ${error}`
      );
    },
  };
}
