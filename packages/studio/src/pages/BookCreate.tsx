import { useEffect, useMemo, useState } from "react";
import {
  normalizeStudioProjectCreateDraft,
  normalizeStudioProjectInit,
  type StudioCreateBookBody,
  type StudioProjectCreateDraft,
  type StudioProjectInitDraft,
  type StudioProjectInitializationPlan,
  type StudioRepositorySource,
  type StudioTemplatePreset,
  type StudioWorkflowMode,
  suggestStudioWorktreeName,
} from "../api/book-create";
import { ChoiceGrid } from "../components/Project/ChoiceGrid";
import {
  repositorySourceOptions,
  templatePresetOptions,
  workflowModeOptions,
} from "../components/Project/project-init-options";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toProjectCreate?: (draft?: Partial<StudioProjectCreateDraft>) => void;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en";
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "番茄小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "feilu", label: "飞卢" },
  { value: "other", label: "其他" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: "zh" | "en"): string {
  return language === "en" ? "2000" : "3000";
}

export function platformOptionsForLanguage(language: "zh" | "en"): ReadonlyArray<PlatformOption> {
  return language === "en" ? PLATFORMS_EN : PLATFORMS_ZH;
}

export function initializationDefaultsForMode(
  language: "zh" | "en",
  workflowMode: StudioWorkflowMode,
  templatePreset: StudioTemplatePreset,
): { chapterWords: string; targetChapters: string } {
  const baseWords = language === "en" ? 2000 : 3000;
  const baseChapters = workflowMode === "draft-first"
    ? 120
    : workflowMode === "serial-ops"
      ? 240
      : 180;
  const workflowWords = workflowMode === "draft-first"
    ? baseWords - 200
    : workflowMode === "serial-ops"
      ? baseWords + 400
      : baseWords;
  const templateDelta = templatePreset === "blank-slate"
    ? -40
    : templatePreset === "web-serial"
      ? 40
      : 0;

  return {
    chapterWords: String(workflowWords),
    targetChapters: String(Math.max(40, baseChapters + templateDelta)),
  };
}

export function buildStudioCreateBookRequest(input: {
  readonly title: string;
  readonly genre: string;
  readonly language: "zh" | "en";
  readonly platform: string;
  readonly chapterWords: string;
  readonly targetChapters: string;
  readonly projectInit: StudioProjectInitDraft;
  readonly initializationPlan?: StudioProjectInitializationPlan;
}): StudioCreateBookBody {
  return {
    title: input.title.trim(),
    genre: input.genre,
    language: input.language,
    platform: input.platform,
    chapterWordCount: parseInt(input.chapterWords, 10),
    targetChapters: parseInt(input.targetChapters, 10),
    projectInit: input.projectInit,
    ...(input.initializationPlan ? { initializationPlan: input.initializationPlan } : {}),
  };
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        if (status.status === "error") {
          throw new Error(status.error ?? `Book "${bookId}" failed to create`);
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(`Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(`Book "${bookId}" was not ready`);
}

interface BookCreateProps {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly projectCreateDraft?: Partial<StudioProjectCreateDraft>;
  readonly flowRevision?: number;
}

export function BookCreate({ nav, theme, t, projectCreateDraft, flowRevision = 0 }: BookCreateProps) {
  const c = useColors(theme);
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: project } = useApi<{ language: string }>("/project");

  const projectLang = (project?.language ?? "zh") as "zh" | "en";

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [platform, setPlatform] = useState("");
  const [repositorySource, setRepositorySource] = useState<StudioRepositorySource>("new");
  const [workflowMode, setWorkflowMode] = useState<StudioWorkflowMode>("outline-first");
  const [templatePreset, setTemplatePreset] = useState<StudioTemplatePreset>("genre-default");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [worktreeName, setWorktreeName] = useState("draft-main");
  const [chapterWords, setChapterWords] = useState(defaultChapterWordsForLanguage(projectLang));
  const [chapterWordsTouched, setChapterWordsTouched] = useState(false);
  const [targetChapters, setTargetChapters] = useState("200");
  const [targetChaptersTouched, setTargetChaptersTouched] = useState(false);
  const [worktreeTouched, setWorktreeTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allGenres = genreData?.genres ?? [];
  const genres = allGenres.filter((g) => g.language === projectLang || g.source === "project");
  const platforms = platformOptionsForLanguage(projectLang);
  const genreSignature = genres.map((g) => g.id).join("|");
  const platformSignature = platforms.map((p) => `${p.value}:${p.label}`).join("|");
  const managedProjectCreate = projectCreateDraft !== undefined;
  const repoOptions = useMemo(() => repositorySourceOptions(projectLang), [projectLang]);
  const workflowOptions = useMemo(() => workflowModeOptions(projectLang), [projectLang]);
  const templateOptions = useMemo(() => templatePresetOptions(projectLang), [projectLang]);
  const initDefaults = useMemo(
    () => initializationDefaultsForMode(projectLang, workflowMode, templatePreset),
    [projectLang, workflowMode, templatePreset],
  );
  const projectInit = normalizeStudioProjectInit({
    repositorySource,
    workflowMode,
    templatePreset,
    repositoryPath,
    cloneUrl,
    gitBranch,
    worktreeName,
  }, title);
  const currentProjectCreateDraft = normalizeStudioProjectCreateDraft({
    title,
    projectInit,
  });

  useEffect(() => {
    const initialDraft = normalizeStudioProjectCreateDraft(projectCreateDraft);
    const nextDefaults = initializationDefaultsForMode(
      projectLang,
      initialDraft.projectInit.workflowMode,
      initialDraft.projectInit.templatePreset,
    );

    setTitle(initialDraft.title ?? "");
    setGenre("");
    setPlatform("");
    setRepositorySource(initialDraft.projectInit.repositorySource);
    setWorkflowMode(initialDraft.projectInit.workflowMode);
    setTemplatePreset(initialDraft.projectInit.templatePreset);
    setRepositoryPath(initialDraft.projectInit.repositoryPath ?? "");
    setCloneUrl(initialDraft.projectInit.cloneUrl ?? "");
    setGitBranch(initialDraft.projectInit.gitBranch ?? "main");
    setWorktreeName(initialDraft.projectInit.worktreeName ?? suggestStudioWorktreeName(initialDraft.title));
    setChapterWords(nextDefaults.chapterWords);
    setChapterWordsTouched(false);
    setTargetChapters(nextDefaults.targetChapters);
    setTargetChaptersTouched(false);
    setWorktreeTouched(false);
    setCreating(false);
    setError(null);
  }, [flowRevision, projectCreateDraft, projectLang]);

  useEffect(() => {
    setGenre((current) => pickValidValue(current, genres.map((g) => g.id)));
  }, [genreSignature]);

  useEffect(() => {
    setPlatform((current) => pickValidValue(current, platforms.map((p) => p.value)));
  }, [platformSignature]);

  useEffect(() => {
    if (!chapterWordsTouched) {
      setChapterWords(initDefaults.chapterWords);
    }
  }, [chapterWordsTouched, initDefaults.chapterWords]);

  useEffect(() => {
    if (!targetChaptersTouched) {
      setTargetChapters(initDefaults.targetChapters);
    }
  }, [initDefaults.targetChapters, targetChaptersTouched]);

  useEffect(() => {
    if (!worktreeTouched) {
      setWorktreeName(suggestStudioWorktreeName(title));
    }
  }, [title, worktreeTouched]);

  const copy = projectLang === "en"
    ? {
        breadcrumb: managedProjectCreate ? "Create book" : "Initialize project",
        title: managedProjectCreate ? "Complete the first book scaffold" : "Initialize a writing workspace",
        subtitle: managedProjectCreate
          ? "ProjectCreate already captured the projectInit object. This step only keeps the book scaffold aligned with that state."
          : "Keep the current /books/create entry, but let this first step decide repo source, workflow mode, template bias and reserved Git fields.",
        initSection: "Initialization workflow",
        initHint: "This round does not replace the existing book pipeline. It adds a first-class setup pass before the first book is generated.",
        summaryLabel: "ProjectCreate object",
        summaryHint: "No clone / worktree execution yet. This summary only carries the reserved projectInit state forward.",
        summaryEdit: "Edit initialization",
        repoLabel: "Repository source",
        workflowLabel: "Workflow mode",
        templateLabel: "Template bias",
        repoPathLabel: repositorySource === "existing" ? "Existing repo path (reserved)" : "Project root path (reserved)",
        cloneLabel: "Clone URL (reserved)",
        gitBranchLabel: "Git branch (reserved)",
        worktreeLabel: "Worktree name (reserved)",
        planLabel: "This initialization will",
        planRepo: repoOptions.find((option) => option.value === repositorySource)?.title ?? repositorySource,
        planWorkflow: workflowOptions.find((option) => option.value === workflowMode)?.title ?? workflowMode,
        planTemplate: templateOptions.find((option) => option.value === templatePreset)?.title ?? templatePreset,
        submit: managedProjectCreate ? "Create book" : "Initialize project and create book",
        creating: managedProjectCreate ? "Creating..." : "Initializing...",
      }
    : {
        breadcrumb: managedProjectCreate ? "新建书籍" : "初始化项目",
        title: managedProjectCreate ? "把第一本书骨架补齐" : "先把写作工作流起出来",
        subtitle: managedProjectCreate
          ? "ProjectCreate 已经把 projectInit 对象收束好了，这一步只负责把书籍骨架接到同一条状态流上。"
          : "保留当前 /books/create 入口，但把第一步前移成仓库来源、工作流模式、模板偏向与 Git 预留字段的初始化。",
        initSection: "初始化工作流",
        initHint: "这一轮不替换现有建书主链，只是在生成第一本书前补一层项目初始化。",
        summaryLabel: "ProjectCreate 对象",
        summaryHint: "这一轮仍不执行 clone / worktree，只把前一步整理好的 projectInit 状态带进建书提交。",
        summaryEdit: "返回修改初始化",
        repoLabel: "仓库来源",
        workflowLabel: "工作流模式",
        templateLabel: "模板偏向",
        repoPathLabel: repositorySource === "existing" ? "已有仓库路径（预留）" : "项目根目录（预留）",
        cloneLabel: "克隆地址（预留）",
        gitBranchLabel: "Git 分支（预留）",
        worktreeLabel: "worktree 名称（预留）",
        planLabel: "本次初始化会：",
        planRepo: repoOptions.find((option) => option.value === repositorySource)?.title ?? repositorySource,
        planWorkflow: workflowOptions.find((option) => option.value === workflowMode)?.title ?? workflowMode,
        planTemplate: templateOptions.find((option) => option.value === templatePreset)?.title ?? templatePreset,
        submit: managedProjectCreate ? "创建书籍" : "初始化项目并创建书籍",
        creating: managedProjectCreate ? "创建中..." : "初始化中...",
      };

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(t("create.titleRequired"));
      return;
    }
    if (!genre) {
      setError(t("create.genreRequired"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await postApi<{ bookId: string }>("/books/create", buildStudioCreateBookRequest({
        title,
        genre,
        language: projectLang,
        platform,
        chapterWords,
        targetChapters,
        projectInit,
        initializationPlan: currentProjectCreateDraft.initializationPlan,
      }));
      await waitForBookReady(result.bookId);
      nav.toBook(result.bookId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create book");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{copy.breadcrumb}</span>
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-3xl">{copy.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
      </div>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {managedProjectCreate ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">{copy.summaryLabel}</div>
            <p className="text-xs leading-5 text-muted-foreground">{copy.summaryHint}</p>
          </div>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>{projectLang === "en" ? "Repo source" : "仓库来源"}：{copy.planRepo}</li>
            <li>{projectLang === "en" ? "Workflow mode" : "工作流模式"}：{copy.planWorkflow}</li>
            <li>{projectLang === "en" ? "Template bias" : "模板偏向"}：{copy.planTemplate}</li>
            <li>{projectLang === "en" ? "Reserved Git" : "Git 预留"}：{projectInit.gitBranch} / {projectInit.worktreeName}</li>
          </ul>

          {nav.toProjectCreate && (
            <button
              type="button"
              onClick={() => nav.toProjectCreate?.(currentProjectCreateDraft)}
              className={`px-4 py-3 ${c.btnSecondary} rounded-md font-medium text-base`}
            >
              {copy.summaryEdit}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">{copy.initSection}</div>
            <p className="text-xs leading-5 text-muted-foreground">{copy.initHint}</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground">{copy.repoLabel}</label>
            <ChoiceGrid options={repoOptions} value={repositorySource} onChange={setRepositorySource} />
          </div>

          {repositorySource === "clone" ? (
            <div>
              <label className="block text-sm text-muted-foreground mb-2">{copy.cloneLabel}</label>
              <input
                type="text"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
                placeholder="https://github.com/org/repo.git"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm text-muted-foreground mb-2">{copy.repoPathLabel}</label>
              <input
                type="text"
                value={repositoryPath}
                onChange={(e) => setRepositoryPath(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
                placeholder="D:/DESKTOP/novelfork-workspace"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground">{copy.workflowLabel}</label>
            <ChoiceGrid options={workflowOptions} value={workflowMode} onChange={setWorkflowMode} />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground">{copy.templateLabel}</label>
            <ChoiceGrid options={templateOptions} value={templatePreset} onChange={setTemplatePreset} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">{copy.gitBranchLabel}</label>
              <input
                type="text"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
                placeholder="main"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-2">{copy.worktreeLabel}</label>
              <input
                type="text"
                value={worktreeName}
                onChange={(e) => {
                  setWorktreeTouched(true);
                  setWorktreeName(e.target.value);
                }}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
                placeholder="draft-main"
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5 rounded-2xl border border-border/60 bg-background/50 p-5">
        <div className="text-sm font-medium text-foreground">
          {projectLang === "en" ? "Book scaffold" : "书籍骨架"}
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t("create.bookTitle")}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
            placeholder={t("create.placeholder")}
          />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t("create.genre")}</label>
          <div className="grid grid-cols-3 gap-2">
            {genres.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => setGenre(g.id)}
                className={`px-3 py-2.5 rounded-md text-sm text-left transition-all ${
                  genre === g.id
                    ? "bg-primary/15 text-primary border border-primary/30 font-medium"
                    : "bg-secondary text-secondary-foreground border border-transparent hover:border-border"
                }`}
              >
                {g.name}
                {g.source === "project" && <span className="text-xs text-muted-foreground ml-1">✦</span>}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t("create.platform")}</label>
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`px-3 py-2 rounded-md text-sm transition-all ${
                  platform === p.value
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "bg-secondary text-secondary-foreground border border-transparent hover:border-border"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-2">{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={chapterWords}
              onChange={(e) => {
                setChapterWordsTouched(true);
                setChapterWords(e.target.value);
              }}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-2">{t("create.targetChapters")}</label>
            <input
              type="number"
              value={targetChapters}
              onChange={(e) => {
                setTargetChaptersTouched(true);
                setTargetChapters(e.target.value);
              }}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-secondary/30 p-5">
        <div className="text-sm font-medium text-foreground">{copy.planLabel}</div>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>{projectLang === "en" ? "Repo source" : "仓库来源"}：{copy.planRepo}</li>
          <li>{projectLang === "en" ? "Workflow mode" : "工作流模式"}：{copy.planWorkflow}</li>
          <li>{projectLang === "en" ? "Template bias" : "模板偏向"}：{copy.planTemplate}</li>
          <li>{projectLang === "en" ? "Reserved Git" : "Git 预留"}：{projectInit.gitBranch} / {projectInit.worktreeName}</li>
        </ul>
      </div>

      <button
        onClick={handleCreate}
        disabled={creating || !title.trim()}
        className={`w-full px-4 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-base`}
      >
        {creating ? copy.creating : copy.submit}
      </button>
    </div>
  );
}
