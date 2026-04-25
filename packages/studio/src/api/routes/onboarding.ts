import { Hono } from "hono";
import { providerManager, type ProviderRuntimeStatus } from "../lib/provider-manager.js";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service.js";
import type { OnboardingSettingsPatch, OnboardingTaskSettings } from "../../types/settings.js";
import type { RouterContext } from "./context.js";

interface OnboardingStatusTasks extends OnboardingTaskSettings {
  readonly modelConfigured: boolean;
  readonly hasAnyBook: boolean;
  readonly hasAnyChapter: boolean;
}

interface OnboardingStatus {
  readonly dismissedFirstRun: boolean;
  readonly dismissedGettingStarted: boolean;
  readonly provider: ProviderRuntimeStatus;
  readonly tasks: OnboardingStatusTasks;
}

const PERSISTED_TASK_KEYS: ReadonlyArray<keyof OnboardingTaskSettings> = [
  "hasOpenedJingwei",
  "hasTriedAiWriting",
  "hasTriedAiTasteScan",
  "hasReadWorkbenchIntro",
];

function booleanPatch<T extends string>(source: unknown, keys: ReadonlyArray<T>): Partial<Record<T, boolean>> {
  if (!source || typeof source !== "object") {
    return {};
  }

  const record = source as Partial<Record<T, unknown>>;
  const patch: Partial<Record<T, boolean>> = {};
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      patch[key] = record[key];
    }
  }
  return patch;
}

async function hasAnyChapter(ctx: RouterContext, bookIds: ReadonlyArray<string>): Promise<boolean> {
  for (const bookId of bookIds) {
    const [chapterCount, chapterIndex] = await Promise.all([
      ctx.state.getPersistedChapterCount(bookId),
      ctx.state.loadChapterIndex(bookId),
    ]);
    if (chapterCount > 0 || chapterIndex.length > 0) {
      return true;
    }
  }
  return false;
}

async function buildOnboardingStatus(ctx: RouterContext): Promise<OnboardingStatus> {
  const [config, bookIds] = await Promise.all([
    loadUserConfig(),
    ctx.state.listBooks(),
  ]);
  const provider = providerManager.getRuntimeStatus();
  const chapterExists = await hasAnyChapter(ctx, bookIds);

  return {
    dismissedFirstRun: config.onboarding.dismissedFirstRun,
    dismissedGettingStarted: config.onboarding.dismissedGettingStarted,
    provider,
    tasks: {
      modelConfigured: provider.hasUsableModel,
      hasAnyBook: bookIds.length > 0,
      hasOpenedJingwei: config.onboarding.tasks.hasOpenedJingwei,
      hasAnyChapter: chapterExists,
      hasTriedAiWriting: config.onboarding.tasks.hasTriedAiWriting,
      hasTriedAiTasteScan: config.onboarding.tasks.hasTriedAiTasteScan,
      hasReadWorkbenchIntro: config.onboarding.tasks.hasReadWorkbenchIntro,
    },
  };
}

function normalizePatch(body: unknown): OnboardingSettingsPatch {
  if (!body || typeof body !== "object") {
    return {};
  }

  const record = body as {
    readonly dismissedFirstRun?: unknown;
    readonly dismissedGettingStarted?: unknown;
    readonly tasks?: unknown;
  };
  const patch: OnboardingSettingsPatch = {};

  if (typeof record.dismissedFirstRun === "boolean") {
    patch.dismissedFirstRun = record.dismissedFirstRun;
  }
  if (typeof record.dismissedGettingStarted === "boolean") {
    patch.dismissedGettingStarted = record.dismissedGettingStarted;
  }

  const tasks = booleanPatch(record.tasks, PERSISTED_TASK_KEYS);
  if (Object.keys(tasks).length > 0) {
    patch.tasks = tasks;
  }

  return patch;
}

export function createOnboardingRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    try {
      const status = await buildOnboardingStatus(ctx);
      return c.json({ status });
    } catch (error) {
      console.error("Failed to load onboarding status:", error);
      return c.json({ error: "Failed to load onboarding status" }, 500);
    }
  });

  app.patch("/status", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const patch = normalizePatch(body);
      await updateUserConfig({ onboarding: patch });
      const status = await buildOnboardingStatus(ctx);
      return c.json({ status });
    } catch (error) {
      console.error("Failed to update onboarding status:", error);
      return c.json({ error: "Failed to update onboarding status" }, 500);
    }
  });

  return app;
}
