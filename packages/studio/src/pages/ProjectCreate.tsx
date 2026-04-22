import { useEffect, useMemo, useState } from "react";

import {
  normalizeStudioProjectCreateDraft,
  type StudioProjectCreateDraft,
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
import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBookCreate: (draft?: Partial<StudioProjectCreateDraft>) => void;
}

interface ProjectCreateProps {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly initialDraft?: Partial<StudioProjectCreateDraft>;
  readonly flowRevision?: number;
}

export function ProjectCreate({ nav, theme, t, initialDraft, flowRevision = 0 }: ProjectCreateProps) {
  const c = useColors(theme);
  const { data: project } = useApi<{ language: string }>("/project");
  const projectLang = (project?.language ?? "zh") as "zh" | "en";

  const [title, setTitle] = useState("");
  const [repositorySource, setRepositorySource] = useState<StudioRepositorySource>("new");
  const [workflowMode, setWorkflowMode] = useState<StudioWorkflowMode>("outline-first");
  const [templatePreset, setTemplatePreset] = useState<StudioTemplatePreset>("genre-default");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [worktreeName, setWorktreeName] = useState("draft-main");
  const [worktreeTouched, setWorktreeTouched] = useState(false);

  const repoOptions = useMemo(() => repositorySourceOptions(projectLang), [projectLang]);
  const workflowOptions = useMemo(() => workflowModeOptions(projectLang), [projectLang]);
  const templateOptions = useMemo(() => templatePresetOptions(projectLang), [projectLang]);

  useEffect(() => {
    const draft = normalizeStudioProjectCreateDraft(initialDraft);
    setTitle(draft.title ?? "");
    setRepositorySource(draft.projectInit.repositorySource);
    setWorkflowMode(draft.projectInit.workflowMode);
    setTemplatePreset(draft.projectInit.templatePreset);
    setRepositoryPath(draft.projectInit.repositoryPath ?? "");
    setCloneUrl(draft.projectInit.cloneUrl ?? "");
    setGitBranch(draft.projectInit.gitBranch ?? "main");
    setWorktreeName(draft.projectInit.worktreeName ?? suggestStudioWorktreeName(draft.title));
    setWorktreeTouched(false);
  }, [flowRevision, initialDraft]);

  useEffect(() => {
    if (!worktreeTouched) {
      setWorktreeName(suggestStudioWorktreeName(title));
    }
  }, [title, worktreeTouched]);

  const projectCreateDraft = normalizeStudioProjectCreateDraft({
    title,
    projectInit: {
      repositorySource,
      workflowMode,
      templatePreset,
      repositoryPath,
      cloneUrl,
      gitBranch,
      worktreeName,
    },
  });
  const initializationPlan = projectCreateDraft.initializationPlan;

  const copy = projectLang === "en"
    ? {
        breadcrumb: "New project",
        title: "Create a formal project object",
        subtitle: "This step keeps the current first-round projectInit payload, but moves it into a dedicated ProjectCreate route before book scaffolding.",
        projectNameLabel: "Project name / provisional book title",
        projectNameHint: "Used for the initial worktree suggestion. You can still refine the book title in the next step.",
        initSection: "Project initialization",
        initHint: "No clone / worktree execution yet. This page only restores the object flow and keeps Git fields reserved.",
        repoLabel: "Repository source",
        workflowLabel: "Workflow mode",
        templateLabel: "Template bias",
        repoPathLabel: repositorySource === "existing" ? "Existing repo path (reserved)" : "Project root path (reserved)",
        cloneLabel: "Clone URL (reserved)",
        gitBranchLabel: "Git branch (reserved)",
        worktreeLabel: "Worktree name (reserved)",
        planLabel: "Current ProjectCreate object",
        planHint: "Entering the book scaffold will also prepare the default writer workspace so you can continue immediately after creation.",
        next: "Next: book scaffold and workspace",
        back: "Back to library",
      }
    : {
        breadcrumb: "新建项目",
        title: "先把正式项目对象立起来",
        subtitle: "这一页不推翻现有 BookCreate 的 projectInit，只是先把初始化收束成正式的 ProjectCreate 对象，再进入书籍骨架。",
        projectNameLabel: "项目名称 / 暂用书名",
        projectNameHint: "这里的名称会先参与 worktree 预设，下一步仍可继续改书名。",
        initSection: "项目初始化",
        initHint: "这一轮不执行 clone / worktree，只把仓库来源、工作流模式、模板偏向与 Git 预留字段收束回正式状态流。",
        repoLabel: "仓库来源",
        workflowLabel: "工作流模式",
        templateLabel: "模板偏向",
        repoPathLabel: repositorySource === "existing" ? "已有仓库路径（预留）" : "项目根目录（预留）",
        cloneLabel: "克隆地址（预留）",
        gitBranchLabel: "Git 分支（预留）",
        worktreeLabel: "worktree 名称（预留）",
        planLabel: "当前 ProjectCreate 对象",
        planHint: "进入书籍骨架后会自动创建默认写作会话，让你在创建完成后直接进入工作状态。",
        next: "下一步：书籍骨架并准备进入工作区",
        back: "返回书库",
      };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{copy.breadcrumb}</span>
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-3xl">{copy.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/60 bg-background/50 p-5">
        <div>
          <label className="mb-2 block text-sm text-muted-foreground">{copy.projectNameLabel}</label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`w-full ${c.input} rounded-md px-4 py-3 text-base focus:outline-none`}
            placeholder={projectLang === "en" ? "Project Phoenix" : "例如：仙路长明"}
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.projectNameHint}</p>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{copy.initSection}</div>
          <p className="text-xs leading-5 text-muted-foreground">{copy.initHint}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {projectLang === "en"
              ? `Initialization plan: ${initializationPlan.readyToContinue ? "ready for the next step" : `waiting for ${initializationPlan.blockingField}`}`
              : `初始化计划：${initializationPlan.readyToContinue ? "可进入下一步" : initializationPlan.blockingField === "cloneUrl" ? "等待填写克隆地址" : "等待填写仓库路径"}`}
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-muted-foreground">{copy.repoLabel}</label>
          <ChoiceGrid options={repoOptions} value={repositorySource} onChange={setRepositorySource} />
        </div>

        {repositorySource === "clone" ? (
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">{copy.cloneLabel}</label>
            <input
              type="text"
              value={cloneUrl}
              onChange={(event) => setCloneUrl(event.target.value)}
              className={`w-full ${c.input} rounded-md px-4 py-3 text-base focus:outline-none`}
              placeholder="https://github.com/org/repo.git"
            />
          </div>
        ) : (
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">{copy.repoPathLabel}</label>
            <input
              type="text"
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              className={`w-full ${c.input} rounded-md px-4 py-3 text-base focus:outline-none`}
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
            <label className="mb-2 block text-sm text-muted-foreground">{copy.gitBranchLabel}</label>
            <input
              type="text"
              value={gitBranch}
              onChange={(event) => setGitBranch(event.target.value)}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
              placeholder="main"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">{copy.worktreeLabel}</label>
            <input
              type="text"
              value={worktreeName}
              onChange={(event) => {
                setWorktreeTouched(true);
                setWorktreeName(event.target.value);
              }}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
              placeholder="draft-main"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-secondary/30 p-5">
        <div className="text-sm font-medium text-foreground">{copy.planLabel}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.planHint}</p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>{projectLang === "en" ? "Title hint" : "标题预设"}：{projectCreateDraft.title ?? (projectLang === "en" ? "Untitled" : "未填写")}</li>
          <li>{projectLang === "en" ? "Repo source" : "仓库来源"}：{repoOptions.find((option) => option.value === repositorySource)?.title ?? repositorySource}</li>
          <li>{projectLang === "en" ? "Workflow mode" : "工作流模式"}：{workflowOptions.find((option) => option.value === workflowMode)?.title ?? workflowMode}</li>
          <li>{projectLang === "en" ? "Template bias" : "模板偏向"}：{templateOptions.find((option) => option.value === templatePreset)?.title ?? templatePreset}</li>
          <li>{projectLang === "en" ? "Reserved Git" : "Git 预留"}：{projectCreateDraft.projectInit.gitBranch} / {projectCreateDraft.projectInit.worktreeName}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={nav.toDashboard}
          className={`px-4 py-3 ${c.btnSecondary} rounded-md font-medium text-base`}
        >
          {copy.back}
        </button>
        <button
          type="button"
          onClick={() => {
            if (initializationPlan.readyToContinue) {
              nav.toBookCreate(projectCreateDraft);
            }
          }}
          disabled={!initializationPlan.readyToContinue}
          className={`px-4 py-3 ${initializationPlan.readyToContinue ? c.btnPrimary : "bg-muted text-muted-foreground cursor-not-allowed"} rounded-md font-medium text-base`}
        >
          {copy.next}
        </button>
      </div>
    </div>
  );
}
