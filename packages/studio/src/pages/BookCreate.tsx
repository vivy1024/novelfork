import { useEffect, useMemo, useState } from "react";
import {
  normalizeStudioProjectInit,
  type StudioRepositorySource,
  type StudioTemplatePreset,
  type StudioWorkflowMode,
  suggestStudioWorktreeName,
} from "../api/book-create";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
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

interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly title: string;
  readonly description: string;
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

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;

function repositorySourceOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioRepositorySource>> {
  if (language === "en") {
    return [
      { value: "new", title: "New repo", description: "Start from the current workspace and reserve a clean project root." },
      { value: "existing", title: "Existing repo", description: "Bind this book to an already prepared local repository." },
      { value: "clone", title: "Clone remote", description: "Reserve remote clone information for the next Git bootstrap step." },
    ];
  }

  return [
    { value: "new", title: "新建仓库", description: "从当前工作区起一个新的项目根目录，适合全新开书。" },
    { value: "existing", title: "已有仓库", description: "把本书挂到已经准备好的本地仓库，先对齐写作工作区。" },
    { value: "clone", title: "克隆仓库", description: "先登记远端来源，为后续 clone / Git 接管留好入口。" },
  ];
}

function workflowModeOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioWorkflowMode>> {
  if (language === "en") {
    return [
      { value: "outline-first", title: "Outline first", description: "Land the bible and world rules first, then expand into chapter work." },
      { value: "draft-first", title: "Draft first", description: "Keep the setup lighter and reach the first writable draft faster." },
      { value: "serial-ops", title: "Serial ops", description: "Prepare for long-running serial work with higher chapter and cadence defaults." },
    ];
  }

  return [
    { value: "outline-first", title: "先大纲", description: "先把故事圣经、世界规则和基础骨架立起来，再进入章节生产。" },
    { value: "draft-first", title: "先开稿", description: "减少前置铺垫，先得到一套可写的初始工程，适合快速起盘。" },
    { value: "serial-ops", title: "连载推进", description: "按长期连载准备更高章数与节奏预设，方便后续持续推进。" },
  ];
}

function templatePresetOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioTemplatePreset>> {
  if (language === "en") {
    return [
      { value: "genre-default", title: "Genre default", description: "Follow the selected genre as the first-round scaffold." },
      { value: "blank-slate", title: "Blank slate", description: "Keep the initial skeleton lighter for manual worldbuilding." },
      { value: "web-serial", title: "Web serial", description: "Bias the setup toward web-serial pacing and chapter cadence." },
    ];
  }

  return [
    { value: "genre-default", title: "跟随题材", description: "用当前题材作为第一轮初始化骨架，保留原有书籍生成主链。" },
    { value: "blank-slate", title: "空白模板", description: "减少预设束缚，适合先自己铺设世界观和角色底稿。" },
    { value: "web-serial", title: "网文快启", description: "偏向网文连载节奏，默认给更积极的章节推进预设。" },
  ];
}

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

function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-xl border px-4 py-3 text-left transition-all ${
            value === option.value
              ? "border-primary/40 bg-primary/10"
              : "border-border/60 bg-background hover:border-border"
          }`}
        >
          <div className="text-sm font-medium text-foreground">{option.title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
        </button>
      ))}
    </div>
  );
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
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
        breadcrumb: "Initialize project",
        title: "Initialize a writing workspace",
        subtitle: "Keep the current /books/create entry, but let this first step decide repo source, workflow mode, template bias and reserved Git fields.",
        initSection: "Initialization workflow",
        initHint: "This round does not replace the existing book pipeline. It adds a first-class setup pass before the first book is generated.",
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
        submit: "Initialize project and create book",
        creating: "Initializing...",
      }
    : {
        breadcrumb: "初始化项目",
        title: "先把写作工作流起出来",
        subtitle: "保留当前 /books/create 入口，但把第一步前移成仓库来源、工作流模式、模板偏向与 Git 预留字段的初始化。",
        initSection: "初始化工作流",
        initHint: "这一轮不替换现有建书主链，只是在生成第一本书前补一层项目初始化。",
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
        submit: "初始化项目并创建书籍",
        creating: "初始化中...",
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
      const result = await postApi<{ bookId: string }>("/books/create", {
        title: title.trim(),
        genre,
        language: projectLang,
        platform,
        chapterWordCount: parseInt(chapterWords, 10),
        targetChapters: parseInt(targetChapters, 10),
        projectInit,
      });
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
              placeholder={projectLang === "en" ? "https://github.com/org/repo.git" : "https://github.com/org/repo.git"}
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
              placeholder={projectLang === "en" ? "D:/DESKTOP/novelfork-workspace" : "D:/DESKTOP/novelfork-workspace"}
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
