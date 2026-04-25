import type { Platform } from "@vivy1024/novelfork-core";

import type { NarratorSessionChatSnapshot, NarratorSessionRecord } from "../shared/session-types.js";

export const STUDIO_REPOSITORY_SOURCES = ["new", "existing", "clone"] as const;
export type StudioRepositorySource = (typeof STUDIO_REPOSITORY_SOURCES)[number];

export const STUDIO_WORKFLOW_MODES = ["outline-first", "draft-first", "serial-ops"] as const;
export type StudioWorkflowMode = (typeof STUDIO_WORKFLOW_MODES)[number];

export const STUDIO_TEMPLATE_PRESETS = ["genre-default", "blank-slate", "web-serial"] as const;
export type StudioTemplatePreset = (typeof STUDIO_TEMPLATE_PRESETS)[number];

export interface StudioProjectInitDraft {
  readonly repositorySource: StudioRepositorySource;
  readonly workflowMode: StudioWorkflowMode;
  readonly templatePreset: StudioTemplatePreset;
  readonly repositoryPath?: string;
  readonly cloneUrl?: string;
  readonly gitBranch?: string;
  readonly worktreeName?: string;
}

export interface StudioProjectInitializationPlan {
  readonly phase: "project-create";
  readonly nextStage: "book-create";
  readonly readyToContinue: boolean;
  readonly blockingField?: "repositoryPath" | "cloneUrl";
}

export interface StudioProjectCreateDraft {
  readonly title?: string;
  readonly projectInit: StudioProjectInitDraft;
  readonly initializationPlan: StudioProjectInitializationPlan;
}

export interface StudioAiInitializationOptions {
  readonly generateJingwei: boolean;
  readonly generatePitch: boolean;
  readonly generateFirstChapterDirections: boolean;
}

export interface StudioCreateBookBody {
  readonly title: string;
  readonly genre: string;
  readonly language?: string;
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly projectInit?: Partial<StudioProjectInitDraft>;
  readonly initializationPlan?: StudioProjectInitializationPlan;
  readonly aiInitialization?: StudioAiInitializationOptions;
}

export interface StudioCreateBookResponse {
  readonly status: "creating";
  readonly bookId: string;
  readonly defaultSession: NarratorSessionRecord;
  readonly defaultSessionSnapshot: NarratorSessionChatSnapshot;
}

export interface StudioBookConfigDraft {
  readonly id: string;
  readonly title: string;
  readonly platform: Platform;
  readonly genre: string;
  readonly status: "outlining";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly language?: "zh" | "en";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StudioProjectBootstrapRecord {
  readonly status: "prepared";
  readonly repositoryRoot: string;
  readonly baseBranch: string;
  readonly baseBranchFallback?: boolean;
  readonly worktreePath: string;
  readonly worktreeBranch: string;
  readonly repositoryCreated: boolean;
  readonly worktreeCreated: boolean;
}

export interface StudioProjectInitRecord {
  readonly title: string;
  readonly genre: string;
  readonly platform: Platform;
  readonly language?: "zh" | "en";
  readonly repositorySource: StudioRepositorySource;
  readonly workflowMode: StudioWorkflowMode;
  readonly templatePreset: StudioTemplatePreset;
  readonly repositoryPath?: string;
  readonly cloneUrl?: string;
  readonly gitBranch: string;
  readonly worktreeName: string;
  readonly initializationPlan: StudioProjectInitializationPlan;
  readonly createdAt: string;
  readonly bootstrap?: StudioProjectBootstrapRecord;
}

interface StudioBookDetail {
  readonly book: { readonly id: string };
  readonly chapters: ReadonlyArray<unknown>;
  readonly nextChapter: number;
}

interface WaitForStudioBookReadyOptions {
  readonly fetchImpl?: typeof fetch;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

const DEFAULT_PROJECT_INIT_BRANCH = "main";
const DEFAULT_PROJECT_INIT_WORKTREE = "draft-main";

const DEFAULT_PROJECT_INIT: StudioProjectInitDraft = {
  repositorySource: "new",
  workflowMode: "outline-first",
  templatePreset: "genre-default",
  gitBranch: DEFAULT_PROJECT_INIT_BRANCH,
  worktreeName: DEFAULT_PROJECT_INIT_WORKTREE,
};

function trimOptionalValue(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildStudioProjectInitializationPlan(
  projectInit: StudioProjectInitDraft,
): StudioProjectInitializationPlan {
  if (projectInit.repositorySource === "clone" && !projectInit.cloneUrl) {
    return {
      phase: "project-create",
      nextStage: "book-create",
      readyToContinue: false,
      blockingField: "cloneUrl",
    };
  }

  if (projectInit.repositorySource === "existing" && !projectInit.repositoryPath) {
    return {
      phase: "project-create",
      nextStage: "book-create",
      readyToContinue: false,
      blockingField: "repositoryPath",
    };
  }

  return {
    phase: "project-create",
    nextStage: "book-create",
    readyToContinue: true,
  };
}

function resolveStudioProjectInitializationPlan(
  projectInit: StudioProjectInitDraft,
  initializationPlan?: StudioProjectInitializationPlan,
): StudioProjectInitializationPlan {
  const normalizedPlan = buildStudioProjectInitializationPlan(projectInit);

  if (!initializationPlan) {
    return normalizedPlan;
  }

  if (
    initializationPlan.phase !== normalizedPlan.phase
    || initializationPlan.nextStage !== normalizedPlan.nextStage
    || initializationPlan.readyToContinue !== normalizedPlan.readyToContinue
    || initializationPlan.blockingField !== normalizedPlan.blockingField
  ) {
    return normalizedPlan;
  }

  return initializationPlan;
}

export function normalizeStudioPlatform(platform?: string): Platform {
  switch (platform) {
    case "tomato":
    case "feilu":
    case "qidian":
      return platform;
    default:
      return "other";
  }
}

export function suggestStudioWorktreeName(title?: string): string {
  const normalized = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return normalized ? `draft-${normalized}` : DEFAULT_PROJECT_INIT_WORKTREE;
}

export function normalizeStudioProjectInit(
  projectInit?: Partial<StudioProjectInitDraft>,
  title?: string,
): StudioProjectInitDraft {
  const repositorySource = STUDIO_REPOSITORY_SOURCES.includes(projectInit?.repositorySource as StudioRepositorySource)
    ? (projectInit?.repositorySource as StudioRepositorySource)
    : DEFAULT_PROJECT_INIT.repositorySource;
  const workflowMode = STUDIO_WORKFLOW_MODES.includes(projectInit?.workflowMode as StudioWorkflowMode)
    ? (projectInit?.workflowMode as StudioWorkflowMode)
    : DEFAULT_PROJECT_INIT.workflowMode;
  const templatePreset = STUDIO_TEMPLATE_PRESETS.includes(projectInit?.templatePreset as StudioTemplatePreset)
    ? (projectInit?.templatePreset as StudioTemplatePreset)
    : DEFAULT_PROJECT_INIT.templatePreset;
  const repositoryPath = repositorySource === "clone"
    ? undefined
    : trimOptionalValue(projectInit?.repositoryPath);
  const cloneUrl = repositorySource === "clone"
    ? trimOptionalValue(projectInit?.cloneUrl)
    : undefined;

  return {
    repositorySource,
    workflowMode,
    templatePreset,
    ...(repositoryPath ? { repositoryPath } : {}),
    ...(cloneUrl ? { cloneUrl } : {}),
    gitBranch: trimOptionalValue(projectInit?.gitBranch) ?? DEFAULT_PROJECT_INIT_BRANCH,
    worktreeName: trimOptionalValue(projectInit?.worktreeName) ?? suggestStudioWorktreeName(title),
  };
}

export function normalizeStudioProjectCreateDraft(
  draft?: Partial<StudioProjectCreateDraft>,
): StudioProjectCreateDraft {
  const title = trimOptionalValue(draft?.title);
  const projectInit = normalizeStudioProjectInit(draft?.projectInit, title);

  return {
    ...(title ? { title } : {}),
    projectInit,
    initializationPlan: buildStudioProjectInitializationPlan(projectInit),
  };
}

export function buildDefaultBookSessionTitle(title: string, language?: string): string {
  const normalizedTitle = title.trim();
  return language === "en"
    ? `New book “${normalizedTitle}” writing session`
    : `新书《${normalizedTitle}》写作会话`;
}

export function buildStudioBookConfig(body: StudioCreateBookBody, now: string): StudioBookConfigDraft {
  return {
    id: body.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30),
    title: body.title,
    platform: normalizeStudioPlatform(body.platform),
    genre: body.genre,
    status: "outlining",
    targetChapters: body.targetChapters ?? 200,
    chapterWordCount: body.chapterWordCount ?? 3000,
    ...(body.language === "en"
      ? { language: "en" as const }
      : body.language === "zh"
        ? { language: "zh" as const }
        : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildStudioProjectInitRecord(
  body: StudioCreateBookBody,
  now: string,
): StudioProjectInitRecord {
  const projectInit = normalizeStudioProjectInit(body.projectInit, body.title);
  const initializationPlan = resolveStudioProjectInitializationPlan(projectInit, body.initializationPlan);

  return {
    title: body.title,
    genre: body.genre,
    platform: normalizeStudioPlatform(body.platform),
    ...(body.language === "en"
      ? { language: "en" as const }
      : body.language === "zh"
        ? { language: "zh" as const }
        : {}),
    repositorySource: projectInit.repositorySource,
    workflowMode: projectInit.workflowMode,
    templatePreset: projectInit.templatePreset,
    ...(projectInit.repositoryPath ? { repositoryPath: projectInit.repositoryPath } : {}),
    ...(projectInit.cloneUrl ? { cloneUrl: projectInit.cloneUrl } : {}),
    gitBranch: projectInit.gitBranch ?? DEFAULT_PROJECT_INIT_BRANCH,
    worktreeName: projectInit.worktreeName ?? suggestStudioWorktreeName(body.title),
    initializationPlan,
    createdAt: now,
  };
}

export function attachStudioProjectBootstrap(
  record: StudioProjectInitRecord,
  bootstrap: StudioProjectBootstrapRecord,
): StudioProjectInitRecord {
  return {
    ...record,
    bootstrap,
  };
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForStudioBookReady(
  bookId: string,
  options: WaitForStudioBookReadyOptions = {},
): Promise<StudioBookDetail> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? defaultWait;
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 150;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(`/api/books/${encodeURIComponent(bookId)}`);
    if (response.ok) {
      return await response.json() as StudioBookDetail;
    }

    if (attempt < maxAttempts && response.status === 404) {
      await wait(retryDelayMs);
      continue;
    }

    break;
  }

  throw new Error(`Book "${bookId}" was not ready after ${maxAttempts} attempts.`);
}
