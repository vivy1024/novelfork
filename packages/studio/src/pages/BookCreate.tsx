import { useEffect, useMemo, useState } from "react";
import type { JingweiTemplateSelection, PresetBundle } from "@vivy1024/novelfork-core";
import {
  normalizeStudioProjectCreateDraft,
  normalizeStudioProjectInit,
  type StudioAiInitializationOptions,
  type StudioCreateBookBody,
  type StudioCreateBookResponse,
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
import { useWindowStore } from "@/stores/windowStore";
import { notify } from "@/lib/notify";
import { Switch } from "@/components/ui/switch";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toSessions?: () => void;
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

interface ProviderRuntimeStatus {
  readonly hasUsableModel: boolean;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
}

interface JingweiTemplateOption {
  readonly templateId: JingweiTemplateSelection["templateId"];
  readonly title: string;
  readonly description: string;
}

interface PresetBundlesResponse {
  readonly bundles: ReadonlyArray<PresetBundle>;
}

interface PresetOption {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly promptInjection: string;
  readonly compatibleGenres?: ReadonlyArray<string>;
  readonly conflictGroup?: string;
}

const JINGWEI_TEMPLATE_OPTIONS_ZH: ReadonlyArray<JingweiTemplateOption> = [
  { templateId: "blank", title: "空白经纬", description: "不创建默认栏目，适合完全自定义。" },
  { templateId: "basic", title: "基础经纬", description: "人物、事件、设定、章节摘要。" },
  { templateId: "enhanced", title: "增强经纬", description: "基础栏目外追加伏笔、名场面、核心记忆。" },
  { templateId: "genre-recommended", title: "按题材推荐", description: "按当前题材给出候选栏目，可逐项勾选。" },
];

const JINGWEI_TEMPLATE_OPTIONS_EN: ReadonlyArray<JingweiTemplateOption> = [
  { templateId: "blank", title: "Blank jingwei", description: "Create no default sections; customize from scratch." },
  { templateId: "basic", title: "Basic jingwei", description: "People, events, settings and chapter summaries." },
  { templateId: "enhanced", title: "Enhanced jingwei", description: "Adds foreshadowing, iconic scenes and core memories." },
  { templateId: "genre-recommended", title: "Genre recommendations", description: "Review optional genre-specific section candidates." },
];

const GENRE_JINGWEI_CANDIDATES_ZH: Record<string, ReadonlyArray<{ key: string; name: string }>> = {
  xuanhuan: [
    { key: "power-system", name: "境界体系" },
    { key: "skills", name: "功法" },
    { key: "factions", name: "势力" },
    { key: "resources", name: "资源" },
    { key: "artifacts", name: "法宝" },
    { key: "secret-realms", name: "秘境" },
  ],
  xiuxian: [
    { key: "power-system", name: "境界体系" },
    { key: "skills", name: "功法" },
    { key: "factions", name: "势力" },
    { key: "resources", name: "资源" },
    { key: "artifacts", name: "法宝" },
    { key: "secret-realms", name: "秘境" },
  ],
  suspense: [
    { key: "clues", name: "线索" },
    { key: "mysteries", name: "谜团" },
    { key: "misdirections", name: "误导项" },
    { key: "case-timeline", name: "案件时间线" },
    { key: "truth-layer", name: "真相层" },
  ],
};

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
  readonly enabledPresetIds?: ReadonlyArray<string>;
  readonly projectInit: StudioProjectInitDraft;
  readonly initializationPlan?: StudioProjectInitializationPlan;
  readonly jingweiTemplate?: JingweiTemplateSelection;
  readonly aiInitialization?: StudioAiInitializationOptions;
}): StudioCreateBookBody {
  return {
    title: input.title.trim(),
    genre: input.genre,
    language: input.language,
    platform: input.platform,
    chapterWordCount: parseInt(input.chapterWords, 10),
    targetChapters: parseInt(input.targetChapters, 10),
    ...(input.enabledPresetIds?.length ? { enabledPresetIds: input.enabledPresetIds } : {}),
    projectInit: input.projectInit,
    ...(input.initializationPlan ? { initializationPlan: input.initializationPlan } : {}),
    ...(input.jingweiTemplate ? { jingweiTemplate: input.jingweiTemplate } : {}),
    ...(input.aiInitialization ? { aiInitialization: input.aiInitialization } : {}),
  };
}

function presetIdsForBundle(bundle: PresetBundle): ReadonlyArray<string> {
  return [
    bundle.toneId,
    bundle.settingBaseId,
    ...bundle.logicRiskIds,
  ].filter(Boolean);
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

type BookCreateStage = "idle" | "submitting" | "waiting" | "creating-session" | "opening-workspace";

type WorkspaceBootstrapFailure = {
  readonly bookId: string;
  readonly message: string;
};

function formatBookCreateError(error: unknown, language: "zh" | "en"): string {
  const errorCode = typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;

  if (errorCode === "PROJECT_BOOTSTRAP_WORKTREE_CONFLICT") {
    return language === "en"
      ? "This worktree is already owned by another book. Go back to project initialization and change the worktree name or repository source before retrying."
      : "当前 worktree 已被其他书占用，可以返回上一步修改 worktree 名称或仓库来源后再重试。";
  }

  if (error instanceof Error && error.message.includes("still being created")) {
    return language === "en"
      ? "The project bootstrap is still running. Wait a moment and refresh before retrying."
      : "项目初始化仍在进行中，请稍后刷新或稍等片刻后再试。";
  }

  if (error instanceof Error && error.message.includes("NOVELFORK_LLM_API_KEY")) {
    return language === "en"
      ? "Project initialization failed because the backend writing runtime is not fully configured yet. Check the LLM/API key setup and retry."
      : "项目初始化失败：后端写作运行时尚未配置完成。请先检查 LLM / API Key 配置，再重新尝试。";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return language === "en" ? "Failed to create book" : "创建书籍失败";
}

export function BookCreate({ nav, theme, t, projectCreateDraft, flowRevision = 0 }: BookCreateProps) {
  const c = useColors(theme);
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: project } = useApi<{ language: string }>("/project");
  const { data: providerStatusData } = useApi<{ status: ProviderRuntimeStatus }>("/providers/status");
  const { data: presetBundlesData } = useApi<PresetBundlesResponse>("/api/presets/bundles");
  const { data: presetsData } = useApi<{ presets: ReadonlyArray<PresetOption> }>("/api/presets");
  const addWindow = useWindowStore((state) => state.addWindow);

  const projectLang = (project?.language ?? "zh") as "zh" | "en";
  const providerStatus = providerStatusData?.status;
  const hasUsableModel = providerStatus?.hasUsableModel === true;

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
  const [jingweiTemplateId, setJingweiTemplateId] = useState<JingweiTemplateSelection["templateId"]>("basic");
  const [selectedGenreJingweiSectionKeys, setSelectedGenreJingweiSectionKeys] = useState<ReadonlyArray<string>>(["power-system", "factions"]);
  const [selectedPresetBundleId, setSelectedPresetBundleId] = useState("");
  const [enabledPresetIds, setEnabledPresetIds] = useState<ReadonlyArray<string>>([]);
  const [generateJingwei, setGenerateJingwei] = useState(false);
  const [generatePitch, setGeneratePitch] = useState(false);
  const [generateFirstChapterDirections, setGenerateFirstChapterDirections] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createStage, setCreateStage] = useState<BookCreateStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [workspaceBootstrapFailure, setWorkspaceBootstrapFailure] = useState<WorkspaceBootstrapFailure | null>(null);

  const allGenres = genreData?.genres ?? [];
  const genres = allGenres.filter((g) => g.language === projectLang || g.source === "project");
  const platforms = platformOptionsForLanguage(projectLang);
  const genreSignature = genres.map((g) => g.id).join("|");
  const platformSignature = platforms.map((p) => `${p.value}:${p.label}`).join("|");
  const presetBundles = presetBundlesData?.bundles ?? [];
  const allPresets = presetsData?.presets ?? [];
  const presetById = useMemo(
    () => new Map(allPresets.map((preset) => [preset.id, preset])),
    [allPresets],
  );
  const recommendedPresetBundles = presetBundles.filter((bundle) => !genre || bundle.genreIds.includes(genre));
  const presetBundleSignature = recommendedPresetBundles.map((bundle) => bundle.id).join("|");
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
    setJingweiTemplateId("basic");
    setSelectedGenreJingweiSectionKeys(["power-system", "factions"]);
    setSelectedPresetBundleId("");
    setEnabledPresetIds([]);
    setGenerateJingwei(false);
    setGeneratePitch(false);
    setGenerateFirstChapterDirections(false);
    setCreating(false);
    setCreateStage("idle");
    setError(null);
    setWorkspaceBootstrapFailure(null);
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

  useEffect(() => {
    if (!hasUsableModel) {
      setGenerateJingwei(false);
      setGeneratePitch(false);
      setGenerateFirstChapterDirections(false);
    }
  }, [hasUsableModel]);

  useEffect(() => {
    if (selectedPresetBundleId && !recommendedPresetBundles.some((bundle) => bundle.id === selectedPresetBundleId)) {
      setSelectedPresetBundleId("");
      setEnabledPresetIds([]);
    }
  }, [presetBundleSignature, recommendedPresetBundles, selectedPresetBundleId]);

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
        jingweiTemplateLabel: "Story jingwei structure",
        jingweiTemplateHint: "Choose the local memory structure for this book. Genre recommendations are optional candidates, not a locked schema.",
        jingweiGenreCandidates: "Genre section candidates",
        aiInitLabel: "AI initialization",
        aiInitUnavailable: "AI model is not configured yet. You can still create a local book; configure a model later to generate the initial jingwei, pitch and first-three-chapter direction.",
        aiInitModel: "Current model",
        aiInitHint: "Optional. If this step fails, the local book scaffold is kept and AI initialization can be retried later.",
        aiInitJingwei: "Generate initial story jingwei",
        aiInitPitch: "Generate synopsis / selling points",
        aiInitFirstChapters: "Generate first-three-chapter direction",
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
        workspaceHint: "尚未配置 AI 模型也不影响本地写作，仍可先创建本地书籍；配置模型后再启用 AI 续写、评点和经纬生成。",
        summaryEdit: "返回修改初始化",
        jingweiTemplateLabel: "故事经纬结构",
        jingweiTemplateHint: "选择本书的本地长期记忆结构。题材推荐只是候选栏目，不会锁死成默认 schema。",
        jingweiGenreCandidates: "题材候选栏目",
        aiInitLabel: "AI 初始化",
        aiInitUnavailable: "尚未配置 AI 模型，仍可先创建本地书籍；配置模型后可启用初始经纬、简介卖点和前三章方向生成。",
        aiInitModel: "当前模型",
        aiInitHint: "可选开启。若 AI 初始化失败，本地书籍骨架会保留，之后可再重试。",
        aiInitJingwei: "生成初始故事经纬",
        aiInitPitch: "生成简介 / 卖点",
        aiInitFirstChapters: "生成前三章方向",
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
        submit: "创建本地书籍",
        creating: managedProjectCreate ? "创建中..." : "初始化中...",
      };

  const createStageMessage = createStage === "submitting"
    ? projectLang === "en"
      ? "Submitting the create request…"
      : "正在提交建书请求…"
    : createStage === "waiting"
      ? projectLang === "en"
        ? "Waiting for the book scaffold to become readable…"
        : "正在等待书籍骨架就绪…"
      : createStage === "creating-session"
        ? projectLang === "en"
          ? "Creating the default writer session…"
          : "正在创建默认写作会话…"
        : createStage === "opening-workspace"
          ? projectLang === "en"
            ? "Opening the workspace…"
            : "正在准备进入工作区…"
          : null;
  const aiInitialization = hasUsableModel
    ? {
        generateJingwei,
        generatePitch,
        generateFirstChapterDirections,
      }
    : undefined;
  const providerSummary = providerStatus?.defaultProvider && providerStatus.defaultModel
    ? `${providerStatus.defaultProvider} / ${providerStatus.defaultModel}`
    : undefined;
  const jingweiTemplateOptions = projectLang === "en" ? JINGWEI_TEMPLATE_OPTIONS_EN : JINGWEI_TEMPLATE_OPTIONS_ZH;
  const genreJingweiCandidates = GENRE_JINGWEI_CANDIDATES_ZH[genre] ?? GENRE_JINGWEI_CANDIDATES_ZH.xuanhuan;
  const selectedGenreJingweiKeySet = new Set(selectedGenreJingweiSectionKeys);
  const selectedPresetBundle = recommendedPresetBundles.find((bundle) => bundle.id === selectedPresetBundleId);
  const enabledPresetIdSet = new Set(enabledPresetIds);
  const selectedTonePreset = enabledPresetIds
    .map((id) => presetById.get(id))
    .find((preset) => preset?.category === "tone");
  const selectedSettingPreset = enabledPresetIds
    .map((id) => presetById.get(id))
    .find((preset) => preset?.category === "setting-base");
  const selectedLogicPresets = enabledPresetIds
    .map((id) => presetById.get(id))
    .filter((preset): preset is PresetOption => Boolean(preset && preset.category === "logic-risk"));
  const presetGenreScope = selectedPresetBundle?.genreIds.length ? selectedPresetBundle.genreIds : genre ? [genre] : [];
  const isPresetInScope = (preset: PresetOption) => (
    !presetGenreScope.length
    || !preset.compatibleGenres?.length
    || preset.compatibleGenres.some((genreId) => presetGenreScope.includes(genreId))
  );
  const alternativeTonePresets = allPresets.filter((preset) => preset.category === "tone" && preset.id !== selectedTonePreset?.id && isPresetInScope(preset));
  const alternativeSettingPresets = allPresets.filter((preset) => preset.category === "setting-base" && preset.id !== selectedSettingPreset?.id && isPresetInScope(preset));
  const alternativeLogicPresets = allPresets.filter((preset) => preset.category === "logic-risk" && !selectedLogicPresets.some((selected) => selected.id === preset.id) && isPresetInScope(preset));
  const jingweiTemplate = useMemo<JingweiTemplateSelection>(() => {
    if (jingweiTemplateId === "genre-recommended") {
      return {
        templateId: "genre-recommended",
        genre,
        selectedSectionKeys: [...selectedGenreJingweiSectionKeys],
      };
    }

    return { templateId: jingweiTemplateId };
  }, [genre, jingweiTemplateId, selectedGenreJingweiSectionKeys]);
  const toggleGenreJingweiCandidate = (key: string) => {
    setSelectedGenreJingweiSectionKeys((current) => (
      current.includes(key)
        ? current.filter((currentKey) => currentKey !== key)
        : [...current, key]
    ));
  };
  const selectPresetBundle = (bundle: PresetBundle) => {
    setSelectedPresetBundleId(bundle.id);
    setEnabledPresetIds(presetIdsForBundle(bundle));
  };
  const toggleEnabledPresetId = (presetId: string) => {
    const preset = presetById.get(presetId);
    setEnabledPresetIds((current) => {
      if (current.includes(presetId)) {
        return current.filter((id) => id !== presetId);
      }
      if (preset?.conflictGroup) {
        return [
          ...current.filter((id) => presetById.get(id)?.conflictGroup !== preset.conflictGroup),
          presetId,
        ];
      }
      return [...current, presetId];
    });
  };
  const replacePreset = (nextPresetId: string, category: "tone" | "setting-base") => {
    setEnabledPresetIds((current) => {
      const filtered = current.filter((id) => presetById.get(id)?.category !== category);
      return [...filtered, nextPresetId];
    });
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
    setCreateStage("submitting");
    setError(null);
    setWorkspaceBootstrapFailure(null);
    await Promise.resolve();
    try {
      const result = await postApi<StudioCreateBookResponse>("/books/create", buildStudioCreateBookRequest({
        title,
        genre,
        language: projectLang,
        platform,
        chapterWords,
        targetChapters,
        enabledPresetIds,
        projectInit,
        initializationPlan: currentProjectCreateDraft.initializationPlan,
        jingweiTemplate,
        aiInitialization,
      }));
      setCreateStage("waiting");
      await Promise.resolve();
      await waitForBookReady(result.bookId);

      const shouldUseNativePrompt = typeof window !== "undefined" && !window.navigator.userAgent.toLowerCase().includes("jsdom");
      const premiseLogline = shouldUseNativePrompt
        ? window.prompt("可选：填写这本书的一句话 Premise（取消则跳过，稍后可在故事经纬 / Premise 补填）。", "")
        : null;
      if (premiseLogline?.trim()) {
        await fetchJson(`/books/${result.bookId}/bible/premise`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logline: premiseLogline.trim() }),
        });
      }
      if (shouldUseNativePrompt && window.confirm("是否现在填写 Tier 1 建书问卷？选择取消可稍后在故事经纬 / 问卷中心继续。")) {
        window.sessionStorage.setItem(`novelfork:open-questionnaire:${result.bookId}`, "tier1");
      }

      try {
        setCreateStage("creating-session");
        const session = result.defaultSession;
        if (!session?.id || !result.defaultSessionSnapshot) {
          throw new Error("默认写作会话尚未就绪，请稍后重试。");
        }
        setCreateStage("opening-workspace");
        addWindow({
          title: session.title,
          agentId: session.agentId,
          sessionId: session.id,
          sessionMode: session.sessionMode,
        });
        // 5.5.1: user-visible success feedback. Landing on SessionCenter makes
        // the default narrator session immediately usable.
        notify.success(`《${title}》已创建`, {
          description: "默认工作流已就绪，可直接开始写作",
        });
        if (nav.toSessions) {
          nav.toSessions();
        } else {
          nav.toBook(result.bookId);
        }
      } catch (sessionError) {
        setWorkspaceBootstrapFailure({
          bookId: result.bookId,
          message: formatBookCreateError(sessionError, projectLang),
        });
        setError(null);
        setCreateStage("idle");
      }
    } catch (e) {
      setError(formatBookCreateError(e, projectLang));
      setWorkspaceBootstrapFailure(null);
      setCreateStage("idle");
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

      {createStageMessage && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          {createStageMessage}
        </div>
      )}

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {workspaceBootstrapFailure && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 space-y-3">
          <div className="font-medium">书籍骨架已经创建成功，但默认写作会话创建失败。</div>
          <div>{workspaceBootstrapFailure.message || "请先进入书籍详情或稍后再到会话中心继续。"}</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => nav.toBook(workspaceBootstrapFailure.bookId)}
              className={`px-3 py-2 ${c.btnSecondary} rounded-md font-medium text-sm`}
            >
              先看书籍详情
            </button>
            {nav.toSessions && (
              <button
                type="button"
                onClick={() => nav.toSessions?.()}
                className={`px-3 py-2 ${c.btnSecondary} rounded-md font-medium text-sm`}
              >
                改去会话中心
              </button>
            )}
          </div>
        </div>
      )}

      {managedProjectCreate ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">{copy.summaryLabel}</div>
            <p className="text-xs leading-5 text-muted-foreground">{copy.summaryHint}</p>
            <p className="text-xs leading-5 text-muted-foreground">{copy.workspaceHint}</p>
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
              disabled={creating}
              className={`px-4 py-3 ${c.btnSecondary} rounded-md font-medium text-base disabled:opacity-50`}
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

          <div role="group" aria-labelledby="bookcreate-repo-source-label" className="space-y-2">
            <div id="bookcreate-repo-source-label" className="block text-sm text-muted-foreground">{copy.repoLabel}</div>
            <ChoiceGrid options={repoOptions} value={repositorySource} onChange={setRepositorySource} />
          </div>

          {repositorySource === "clone" ? (
            <div>
              <label htmlFor="bookcreate-clone-url" className="block text-sm text-muted-foreground mb-2">{copy.cloneLabel}</label>
              <input
                id="bookcreate-clone-url"
                name="cloneUrl"
                type="url"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
                placeholder="https://github.com/org/repo.git"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="bookcreate-repo-path" className="block text-sm text-muted-foreground mb-2">{copy.repoPathLabel}</label>
              <input
                id="bookcreate-repo-path"
                name="repositoryPath"
                type="text"
                value={repositoryPath}
                onChange={(e) => setRepositoryPath(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
                placeholder="D:/DESKTOP/novelfork-workspace"
              />
            </div>
          )}

          <div role="group" aria-labelledby="bookcreate-workflow-mode-label" className="space-y-2">
            <div id="bookcreate-workflow-mode-label" className="block text-sm text-muted-foreground">{copy.workflowLabel}</div>
            <ChoiceGrid options={workflowOptions} value={workflowMode} onChange={setWorkflowMode} />
          </div>

          <div role="group" aria-labelledby="bookcreate-template-preset-label" className="space-y-2">
            <div id="bookcreate-template-preset-label" className="block text-sm text-muted-foreground">{copy.templateLabel}</div>
            <ChoiceGrid options={templateOptions} value={templatePreset} onChange={setTemplatePreset} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="bookcreate-git-branch" className="block text-sm text-muted-foreground mb-2">{copy.gitBranchLabel}</label>
              <input
                id="bookcreate-git-branch"
                name="gitBranch"
                type="text"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
                placeholder="main"
              />
            </div>
            <div>
              <label htmlFor="bookcreate-worktree-name" className="block text-sm text-muted-foreground mb-2">{copy.worktreeLabel}</label>
              <input
                id="bookcreate-worktree-name"
                name="worktreeName"
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
          <label htmlFor="bookcreate-title" className="block text-sm text-muted-foreground mb-2">{t("create.bookTitle")}</label>
          <input
            id="bookcreate-title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
            placeholder={t("create.placeholder")}
          />
        </div>

        <div role="group" aria-labelledby="bookcreate-genre-label">
          <div id="bookcreate-genre-label" className="block text-sm text-muted-foreground mb-2">{t("create.genre")}</div>
          <div className="grid grid-cols-3 gap-2">
            {genres.map((g) => (
              <button
                type="button"
                key={g.id}
                aria-pressed={genre === g.id}
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

        <div role="group" aria-labelledby="bookcreate-platform-label">
          <div id="bookcreate-platform-label" className="block text-sm text-muted-foreground mb-2">{t("create.platform")}</div>
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <button
                type="button"
                key={p.value}
                aria-pressed={platform === p.value}
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
            <label htmlFor="bookcreate-chapter-words" className="block text-sm text-muted-foreground mb-2">{t("create.wordsPerChapter")}</label>
            <input
              id="bookcreate-chapter-words"
              name="chapterWords"
              type="number"
              min={100}
              value={chapterWords}
              onChange={(e) => {
                setChapterWordsTouched(true);
                setChapterWords(e.target.value);
              }}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
            />
          </div>
          <div>
            <label htmlFor="bookcreate-target-chapters" className="block text-sm text-muted-foreground mb-2">{t("create.targetChapters")}</label>
            <input
              id="bookcreate-target-chapters"
              name="targetChapters"
              type="number"
              min={1}
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

      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{projectLang === "en" ? "Writing presets" : "写作预设"}</div>
          <p className="text-xs leading-5 text-muted-foreground">
            {projectLang === "en"
              ? "Optional. Pick a bundle to prefill tone, setting base and logic checks, then remove any item you do not want."
              : "可选。选择推荐组合后会预填文风、时代/社会基底和逻辑自检，也可以逐项取消。"}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{projectLang === "en" ? "Recommended bundles" : "推荐创作组合"}</div>
          {recommendedPresetBundles.length > 0 ? (
            <div className="grid gap-3">
              {recommendedPresetBundles.map((bundle) => (
                <div key={bundle.id} className={`rounded-xl border px-3 py-3 transition-all ${
                  selectedPresetBundleId === bundle.id
                    ? "border-primary/40 bg-primary/10"
                    : "border-border/60 bg-secondary/30"
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{bundle.name}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{bundle.description}</div>
                    </div>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">{bundle.difficulty}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => selectPresetBundle(bundle)}
                      disabled={creating}
                      className={`rounded-md px-3 py-2 text-xs font-medium transition-all disabled:opacity-50 ${
                        selectedPresetBundleId === bundle.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground border border-border/60 hover:border-primary/30"
                      }`}
                    >
                      {projectLang === "en" ? `Apply “${bundle.name}”` : `应用「${bundle.name}」`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {projectLang === "en" ? "No recommended bundle for this genre yet." : "当前题材暂无推荐组合，可跳过。"}
            </p>
          )}
        </div>

        {selectedPresetBundle && (
          <div className="space-y-4 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {projectLang === "en" ? `Selected bundle: ${selectedPresetBundle.name}` : `已选择组合：${selectedPresetBundle.name}`}
              </div>
              {selectedPresetBundle.suitableFor.length > 0 && (
                <div className="text-xs leading-5 text-muted-foreground">
                  {projectLang === "en" ? "Suitable for" : "适合"}：{selectedPresetBundle.suitableFor.join("、")}
                </div>
              )}
              {selectedPresetBundle.notSuitableFor.length > 0 && (
                <div className="text-xs leading-5 text-muted-foreground">
                  {projectLang === "en" ? "Not suitable for" : "不适合"}：{selectedPresetBundle.notSuitableFor.join("、")}
                </div>
              )}
            </div>

            {selectedTonePreset && (
              <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">{projectLang === "en" ? "Tone preset" : "文风预设"}</div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{selectedTonePreset.name}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{selectedTonePreset.description}</div>
                  </div>
                  <Switch
                    checked={enabledPresetIdSet.has(selectedTonePreset.id)}
                    onCheckedChange={() => toggleEnabledPresetId(selectedTonePreset.id)}
                    aria-label={`${projectLang === "en" ? "Enable preset" : "启用预设"} ${selectedTonePreset.name}`}
                    disabled={creating}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {alternativeTonePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => replacePreset(preset.id, "tone")}
                      disabled={creating}
                      className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition-all hover:border-primary/30 disabled:opacity-50"
                    >
                      {projectLang === "en" ? `Use ${preset.name}` : `改用 ${preset.name}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedSettingPreset && (
              <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">{projectLang === "en" ? "Setting base" : "时代/社会基底"}</div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{selectedSettingPreset.name}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{selectedSettingPreset.description}</div>
                  </div>
                  <Switch
                    checked={enabledPresetIdSet.has(selectedSettingPreset.id)}
                    onCheckedChange={() => toggleEnabledPresetId(selectedSettingPreset.id)}
                    aria-label={`${projectLang === "en" ? "Enable preset" : "启用预设"} ${selectedSettingPreset.name}`}
                    disabled={creating}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {alternativeSettingPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => replacePreset(preset.id, "setting-base")}
                      disabled={creating}
                      className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition-all hover:border-primary/30 disabled:opacity-50"
                    >
                      {projectLang === "en" ? `Use ${preset.name}` : `改用 ${preset.name}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
              <div className="text-xs font-medium text-muted-foreground">{projectLang === "en" ? "Logic checks" : "逻辑自检"}</div>
              <div className="space-y-2">
                {selectedLogicPresets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{preset.name}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{preset.description}</div>
                    </div>
                    <Switch
                      checked={enabledPresetIdSet.has(preset.id)}
                      onCheckedChange={() => toggleEnabledPresetId(preset.id)}
                      aria-label={`${projectLang === "en" ? "Enable preset" : "启用预设"} ${preset.name}`}
                      disabled={creating}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {alternativeLogicPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => toggleEnabledPresetId(preset.id)}
                    disabled={creating}
                    className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition-all hover:border-primary/30 disabled:opacity-50"
                  >
                    {projectLang === "en" ? `Add ${preset.name}` : `新增 ${preset.name}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{copy.jingweiTemplateLabel}</div>
          <p className="text-xs leading-5 text-muted-foreground">{copy.jingweiTemplateHint}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {jingweiTemplateOptions.map((option) => (
            <button
              key={option.templateId}
              type="button"
              aria-pressed={jingweiTemplateId === option.templateId}
              onClick={() => setJingweiTemplateId(option.templateId)}
              disabled={creating}
              className={`rounded-xl border px-3 py-3 text-left transition-all disabled:opacity-50 ${
                jingweiTemplateId === option.templateId
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 bg-secondary/30 text-foreground hover:border-primary/30"
              }`}
            >
              <div className="text-sm font-medium">{option.title}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
            </button>
          ))}
        </div>
        {jingweiTemplateId === "genre-recommended" && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="text-xs font-medium text-muted-foreground">{copy.jingweiGenreCandidates}</div>
            <div className="flex flex-wrap gap-2">
              {genreJingweiCandidates.map((candidate) => (
                <button
                  key={candidate.key}
                  type="button"
                  aria-pressed={selectedGenreJingweiKeySet.has(candidate.key)}
                  onClick={() => toggleGenreJingweiCandidate(candidate.key)}
                  disabled={creating}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-all disabled:opacity-50 ${
                    selectedGenreJingweiKeySet.has(candidate.key)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/50 p-5">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{copy.aiInitLabel}</div>
          {hasUsableModel ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {providerSummary ? `${copy.aiInitModel}：${providerSummary}。` : ""}{copy.aiInitHint}
            </p>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">{copy.aiInitUnavailable}</p>
          )}
        </div>

        {hasUsableModel && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/30 px-3 py-3">
              <span className="text-sm text-foreground">{copy.aiInitJingwei}</span>
              <Switch aria-label={copy.aiInitJingwei} checked={generateJingwei} onCheckedChange={setGenerateJingwei} disabled={creating} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/30 px-3 py-3">
              <span className="text-sm text-foreground">{copy.aiInitPitch}</span>
              <Switch aria-label={copy.aiInitPitch} checked={generatePitch} onCheckedChange={setGeneratePitch} disabled={creating} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/30 px-3 py-3">
              <span className="text-sm text-foreground">{copy.aiInitFirstChapters}</span>
              <Switch aria-label={copy.aiInitFirstChapters} checked={generateFirstChapterDirections} onCheckedChange={setGenerateFirstChapterDirections} disabled={creating} />
            </div>
          </div>
        )}
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
