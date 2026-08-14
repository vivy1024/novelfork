/**
 * Writing Skills 面板。
 *
 * 按分类筛选、开关启用、查看或编辑技能。内置技能编辑前会 fork 为作者副本，
 * 保存后写进 `~/.novelfork/skills/`，同名覆盖内置。
 *
 * 项目生效态以当前作品目录 `.novelfork/skills/` 的实际文件为准；面板只对指定
 * catalog Skill 执行文件增删/刷新，不把选择状态写入 book.json。
 */

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, Eye, RotateCcw } from "lucide-react";
import { useApi, fetchJson, putApi, postApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WritingSkillItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly kind: string;
  readonly source: "builtin" | "user" | "remote" | "project";
  readonly mode?: string;
  readonly tags?: readonly string[];
  readonly version?: string | null;
  readonly editable: boolean;
  readonly content?: string | null;
  readonly body?: string;
  /** 来自内置市场的外部作品，必须展示归属。 */
  readonly provenance?: {
    readonly repo: string;
    readonly license: string;
  } | null;
}

interface WritingSkillsResponse {
  readonly skills: readonly WritingSkillItem[];
}

interface BookWritingSkillsResponse {
  readonly projectSkillSlugs?: readonly string[];
  readonly projectSkillsDirectory?: string;
  readonly skills?: readonly (WritingSkillItem & { readonly body?: string })[];
  readonly migration?: {
    readonly migratedSlugs?: readonly string[];
  };
}

export interface WritingSkillsPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Kind labels
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  opening: "开篇",
  pacing: "节奏",
  character: "人物",
  plot: "情节",
  prose: "文笔",
  revision: "修订",
  platform: "平台",
  packaging: "包装",
  research: "调研",
  workflow: "流程",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** 把仓库地址收成 `owner/repo`，避免长 URL 撑破卡片。 */
export function repoLabel(repo: string): string {
  return repo.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") || repo;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** NovelFork 原生技能的出处标识。 */
export const OWN_SOURCE_KEY = "novelfork";

/** 技能的出处归属；项目范围由 WritingSkillScope 单独表达。 */
export function sourceKeyOf(skill: WritingSkillItem): string {
  return skill.provenance ? repoLabel(skill.provenance.repo) : OWN_SOURCE_KEY;
}

/** 出处标题：原生内容与上游仓库明确区分。 */
export function sourceLabel(key: string): string {
  return key === OWN_SOURCE_KEY ? "NovelFork 原生" : `上游 · ${key}`;
}

/**
 * 一个出处分区。
 *
 * 出处和作用范围是**两个平行维度**：
 *
 * - 「按出处浏览」：只统计全局 catalog 的原生/上游归属
 * - 「按作用范围浏览」：区分全局技能库与当前作品额外技能
 * - 「按分类/题材/搜索」：在当前作用范围内继续缩小结果
 */
export interface SourceSection {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly license: string | null;
  readonly repoUrl: string | null;
  readonly skills: readonly WritingSkillItem[];
}

/** 把 skills 分格到各来源分区。自研分区固定排在最前，其余按数量倒序。 */
export function groupBySource(
  skills: readonly WritingSkillItem[],
): ReadonlyArray<SourceSection> {
  const buckets = new Map<string, WritingSkillItem[]>();
  for (const skill of skills) {
    const key = sourceKeyOf(skill);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(skill);
    else buckets.set(key, [skill]);
  }

  return [...buckets.entries()]
    .map(([key, items]) => {
      const sample = items.find((s) => s.provenance);
      return {
        key,
        label: sourceLabel(key),
        count: items.length,
        license: sample?.provenance?.license ?? null,
        repoUrl: sample?.provenance?.repo ?? null,
        skills: items,
      };
    })
    .sort((a, b) => {
      // 自带的排最前 —— 那是产品保证可用的部分
      if (a.key === OWN_SOURCE_KEY) return -1;
      if (b.key === OWN_SOURCE_KEY) return 1;
      return b.count - a.count || a.key.localeCompare(b.key);
    });
}

/** 题材 tag 白名单。只有这些算题材，其余 tag 是普通标签。 */
const GENRE_TAGS: ReadonlySet<string> = new Set([
  "AI科幻",
  "太空科幻",
  "女频爱情",
  "异能志怪",
  "悬疑推理",
  "赛博庞克",
  "都市悬疑",
  "都市职场",
]);

export function genreOf(skill: WritingSkillItem): string | null {
  for (const tag of skill.tags ?? []) if (GENRE_TAGS.has(tag)) return tag;
  return null;
}

export type WritingSkillScope = "all" | "global" | "project";

export interface WritingSkillFilters {
  readonly kind?: string | null;
  readonly genre?: string | null;
  readonly query?: string;
}

/**
 * 分区**内部**的筛选。
 *
 * 不含来源维度 —— 来源由分区隔开，这里只在已选定的分区里缩小范围。
 */
export function applyWritingSkillFilters(
  skills: readonly WritingSkillItem[],
  filters: WritingSkillFilters,
): readonly WritingSkillItem[] {
  const needle = (filters.query ?? "").trim().toLowerCase();
  return skills.filter((skill) => {
    if (filters.kind && skill.kind !== filters.kind) return false;
    if (filters.genre && genreOf(skill) !== filters.genre) return false;
    if (needle) {
      const haystack = `${skill.name} ${skill.description} ${(skill.tags ?? []).join(" ")}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
}

/**
 * 纯展示外壳。抽出来是为了能在不起网络的情况下验证：
 * 来源/分类/题材三层筛选、启用态、归属标记、空态文案。
 */
export function WritingSkillsPanelShell({
  skills,
  enabledSlugs,
  filterKind = null,
  filterGenre = null,
  activeSource = null,
  query = "",
}: {
  readonly skills: readonly WritingSkillItem[];
  readonly enabledSlugs: readonly string[];
  readonly filterKind?: string | null;
  readonly filterGenre?: string | null;
  /** 已进入的来源分区；null 表示在全部 skill 里浏览。 */
  readonly activeSource?: string | null;
  readonly query?: string;
}) {
  const sections = groupBySource(skills);
  // 分区与筛选是平行维度：进了分区就在该分区内容里筛，没进就在全部里筛。
  const scope = activeSource
    ? (sections.find((s) => s.key === activeSource)?.skills ?? [])
    : skills;
  const kinds = [...new Set(scope.map((s) => s.kind))];
  const visible = applyWritingSkillFilters(scope, {
    kind: filterKind,
    genre: filterGenre,
    query,
  });

  if (skills.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4" data-testid="writing-skills-empty">
        还没有写作技能。内置写作技能随产品提供，你也可以在 ~/.novelfork/skills/ 下自建。
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="writing-skills-panel">
      {/* 来源分区：按仓库陈列，与下方筛选各自独立生效 */}
      {sections.length > 1 && (
        <div className="flex flex-wrap gap-1" data-testid="writing-skills-source-sections">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            全部 {skills.length}
          </span>
          {sections.map((section) => (
            <span
              key={section.key}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground"
              title={section.repoUrl ?? section.key}
            >
              {section.label} {section.count}
            </span>
          ))}
        </div>
      )}

      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            全部
          </span>
          {kinds.map((kind) => (
            <span
              key={kind}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground"
            >
              {kindLabel(kind)}
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-[11px] text-muted-foreground py-2" data-testid="writing-skills-no-match">
          没有匹配的写作技能。清掉搜索词或换个分类再看。
        </p>
      )}
      <div className="grid grid-cols-1 gap-2">
        {visible.map((skill) => (
          <div
            key={skill.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium">{skill.name}</span>
                <Badge variant="secondary" className="text-[9px] h-4">
                  {kindLabel(skill.kind)}
                </Badge>
                {skill.source === "user" && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    已自定义
                  </Badge>
                )}
                {enabledSlugs.includes(skill.slug) && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    已启用
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                {skill.description}
              </p>
              {skill.provenance && (
                <p className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">
                  来源 {repoLabel(skill.provenance.repo)} · {skill.provenance.license}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 技能面板：本地自研体系，content/builtins 全量预置，启用后物化到作品目录。
 * 在线技能市场（浏览外部来源、按需下载、用户间分享）为后续规划，当前不做下载/同步。
 */
export function WritingSkillsPanel({ bookId }: WritingSkillsPanelProps) {
  const { data, loading, error, refetch } = useApi<WritingSkillsResponse>("/writing-skills");
  const [projectSlugs, setProjectSlugs] = useState<string[]>([]);
  const [filterKind, setFilterKind] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [filterScope, setFilterScope] = useState<WritingSkillScope>("all");
  const [filterGenre, setFilterGenre] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<WritingSkillItem | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 列表分页：全局 catalog 与当前作品额外技能合计可能超过 400 个，默认先出 40 个。 */
  const PAGE_SIZE = 40;
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // 生效态由可信书籍根目录 `.novelfork/skills` 扫描结果提供。
  const {
    data: bookWritingSkills,
    refetch: refetchBook,
  } = useApi<BookWritingSkillsResponse>(`/books/${bookId}/writing-skills`);

  // 本地态只缓存项目目录中的 slug，用于开关的乐观更新。
  useEffect(() => {
    if (!bookWritingSkills?.projectSkillSlugs) return;
    setProjectSlugs([...bookWritingSkills.projectSkillSlugs]);
  }, [bookWritingSkills]);

  async function handleToggle(skillSlug: string, enabled: boolean) {
    const skill = skills.find((candidate) => candidate.slug === skillSlug);
    if (skill?.mode === "always") return;
    const previous = projectSlugs;
    const nextSlugs = enabled
      ? [...new Set([...projectSlugs, skillSlug])]
      : projectSlugs.filter((slug) => slug !== skillSlug);
    setProjectSlugs(nextSlugs);
    setNotice(null);
    try {
      if (!skill) throw new Error("找不到要操作的 Writing Skill。");
      if (skill.source === "project") {
        if (enabled) throw new Error("项目独有技能只能由当前作品目录提供。");
        await fetchJson(`/books/${bookId}/writing-skills/${encodeURIComponent(skill.slug)}`, {
          method: "DELETE",
        });
      } else {
        await putApi(`/books/${bookId}/writing-skills`, enabled
          ? { addSkillIds: [skill.id] }
          : { removeSkillIds: [skill.id] });
      }
      refetchBook?.();
    } catch (toggleError) {
      setProjectSlugs(previous);
      setNotice(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  }

  async function openSkill(skill: WritingSkillItem, forEditing: boolean) {
    setViewing(skill);
    setEditing(false);
    setNotice(null);
    setBusy(true);
    const slugPath = `/writing-skills/${encodeURIComponent(skill.slug)}`;
    try {
      // 作品目录中的项目文件可能不在全局 catalog；书籍 API 已返回原始 SKILL.md，
      // 直接使用它，避免把项目级技能误当成全局技能请求。
      if (skill.source === "project" && skill.content) {
        setDraft(forEditing ? skill.content : (skill.body ?? skill.content));
        setEditing(forEditing);
        return;
      }
      if (forEditing && !skill.editable) {
        // 内置/远程技能只读：先 fork 到作者副本，再编辑。
        await postApi(`${slugPath}/fork`, {});
      }
      const loadDetail = () =>
        fetchJson<{ skill: { body?: string; content?: string | null } }>(slugPath);

      let detail: { skill: { body?: string; content?: string | null } };
      try {
        detail = await loadDetail();
      } catch (firstError) {
        // 冷启动：列表刚返回时全量解析可能尚未进缓存，详情第一次会短暂失败。
        // 自动重试一次，避免「第一次打开报不存在、再点又好了」。
        await new Promise((resolve) => setTimeout(resolve, 120));
        try {
          detail = await loadDetail();
        } catch {
          throw firstError;
        }
      }

      // 编辑必须用完整 SKILL.md（content）；预览用 body 即可。
      // 以前只塞 body，保存时缺 frontmatter → 解析失败，看起来像「写作技能不存在」。
      const nextDraft = forEditing
        ? (detail.skill.content ?? detail.skill.body ?? "")
        : (detail.skill.body ?? detail.skill.content ?? "");
      if (!nextDraft.trim()) {
        setNotice("写作技能正文为空，无法打开。请换一份或检查来源文件。");
        return;
      }
      setDraft(nextDraft);
      setEditing(forEditing);
    } catch (openError) {
      setNotice(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!viewing) return;
    setBusy(true);
    setNotice(null);
    try {
      if (viewing.source === "project") {
        await putApi(`/books/${bookId}/writing-skills/${encodeURIComponent(viewing.slug)}`, {
          content: draft,
        });
        setNotice("已保存到当前作品的 .novelfork/skills/，不会影响其它作品。");
        refetchBook?.();
      } else {
        await putApi(`/writing-skills/${encodeURIComponent(viewing.slug)}`, {
          content: draft,
        });
        // 作者副本保存后，已存在的当前项目文件立即刷新；未进入项目的 Skill 不提前物化。
        if (projectSlugs.includes(viewing.slug)) {
          await putApi(`/books/${bookId}/writing-skills`, {
            refreshSkillIds: [viewing.id],
          });
        }
        setNotice("已保存到我的写作技能；当前项目文件已同步。");
        refetch?.();
        refetchBook?.();
      }
      setEditing(false);
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(skill: WritingSkillItem) {
    setBusy(true);
    setNotice(null);
    try {
      await fetchJson(`/writing-skills/${encodeURIComponent(skill.slug)}`, {
        method: "DELETE",
      });
      // 恢复作者覆盖后，已存在的项目文件需要重新复制 catalog 版本；未进入项目的 Skill 不物化。
      if (projectSlugs.includes(skill.slug)) {
        await putApi(`/books/${bookId}/writing-skills`, {
          refreshSkillIds: [skill.id],
        });
      }
      setNotice("已恢复内置版本；当前项目文件已同步。");
      setViewing(null);
      refetch?.();
      refetchBook?.();
    } catch (resetError) {
      setNotice(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setBusy(false);
    }
  }

  const catalogSkills = data?.skills ?? [];
  const projectOnlySkills = (bookWritingSkills?.skills ?? []).filter(
    (skill) => skill.source === "project"
      && !catalogSkills.some((catalogSkill) => catalogSkill.slug === skill.slug),
  );
  const skills = [...catalogSkills, ...projectOnlySkills];
  // 出处统计只基于全局 catalog，项目-only 技能通过作用范围单独浏览。
  const sourceSections = groupBySource(catalogSkills);
  const scopedSkills = filterScope === "global"
    ? catalogSkills
    : filterScope === "project"
      ? projectOnlySkills
      : skills;
  // 选择出处时自动进入全局范围，避免项目副本再次污染出处统计。
  const scope = filterSource
    ? catalogSkills.filter((skill) => sourceKeyOf(skill) === filterSource)
    : scopedSkills;
  const kinds = [...new Set(scope.map((s) => s.kind))];
  const genres = [...new Set(scope.map((s) => genreOf(s)).filter((g): g is string => g !== null))];
  const visible = applyWritingSkillFilters(scope, {
    kind: filterKind,
    genre: filterGenre,
    query,
  });
  const displayed = visible.slice(0, displayCount);
  const hasMore = visible.length > displayCount;
  const scopeOptions: ReadonlyArray<{ key: WritingSkillScope; label: string; count: number }> = [
    { key: "all", label: "全部", count: skills.length },
    { key: "global", label: "全局技能库", count: catalogSkills.length },
    { key: "project", label: "当前作品额外", count: projectOnlySkills.length },
  ];

  function handleScopeChange(nextScope: WritingSkillScope) {
    setFilterScope(nextScope);
    if (nextScope !== "global") setFilterSource(null);
  }

  function handleSourceChange(nextSource: string) {
    setFilterScope("global");
    setFilterSource((current) => current === nextSource ? null : nextSource);
  }

  // 筛选条件变化时重置分页，避免旧 displayCount 把新结果截掉
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [filterKind, filterGenre, filterScope, filterSource, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载写作技能…</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-4">{error}</p>;
  }

  if (skills.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4" data-testid="writing-skills-empty">
        还没有写作技能。内置写作技能随产品提供，你也可以在 ~/.novelfork/skills/ 下自建。
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="writing-skills-panel">
      {/*
        作用域提示：这个面板也被「写作配置」复用，不只出现在书籍设置页。
        技能 catalog/作者覆盖是全局来源，但启用态直接物化到当前项目目录，
        必须就地说明取消勾选会删除项目副本，避免作者误以为是数据库开关。
      */}
      <p className="text-[10px] text-muted-foreground" data-testid="writing-skills-scope-hint">
        技能库与作者覆盖全局共享；<span className="text-foreground">项目文件只对当前作品生效</span>
        （当前目录已发现 {projectSlugs.length} 个）。勾选会写入 <code>.novelfork/skills/</code>        ，取消会删除对应项目副本；项目额外技能原地编辑，技能库条目则 fork 到 ~/.novelfork/skills/。

      </p>

      {/* 搜索：几百个 skill 平铺翻不动，先给关键词 */}
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`搜索 ${skills.length} 个写作技能…`}
          className="h-7 flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
          aria-label="搜索写作技能"
          data-testid="writing-skills-search"
        />
        <span className="text-[10px] text-muted-foreground shrink-0">{visible.length}</span>
      </div>

      {/* 作用范围：全局 catalog 与当前作品额外文件分开统计 */}
      <div className="flex flex-wrap items-center gap-1" data-testid="writing-skills-scope-filter">
        <span className="text-[10px] text-muted-foreground mr-1">范围</span>
        {scopeOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => handleScopeChange(option.key)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              filterScope === option.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {option.label} {option.count}
          </button>
        ))}
      </div>

      {/* 出处：只按全局 catalog 统计，项目-only 技能通过上面的范围筛选浏览 */}
      {sourceSections.length > 1 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="writing-skills-source-filter">
          <span className="text-[10px] text-muted-foreground mr-1">出处</span>
          <button
            type="button"
            onClick={() => setFilterSource(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              filterSource === null
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            全部
          </button>
          {sourceSections.map((section) => (
            <button
              key={section.key}
              type="button"
              title={section.repoUrl ?? section.key}
              onClick={() => handleSourceChange(section.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filterSource === section.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {section.label} {section.count}
            </button>
          ))}
        </div>
      )}

      {/* 第三层：题材（仅当前来源有题材标注时出现） */}
      {genres.length > 1 && (
        <div className="flex flex-wrap gap-1" data-testid="writing-skills-genre-filter">
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => setFilterGenre(genre === filterGenre ? null : genre)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filterGenre === genre
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {genre}
            </button>
          ))}
        </div>
      )}

      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilterKind(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              filterKind === null
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            全部
          </button>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setFilterKind(kind === filterKind ? null : kind)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filterKind === kind
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {kindLabel(kind)}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-[11px] text-muted-foreground py-2" data-testid="writing-skills-no-match">
          没有匹配的写作技能。换个来源或清掉搜索词再看。
        </p>
      )}

      <div className="grid grid-cols-1 gap-2">
        {displayed.map((skill) => (
          <div
            key={skill.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5 hover:bg-muted/50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium">{skill.name}</span>
                <Badge variant="secondary" className="text-[9px] h-4">
                  {kindLabel(skill.kind)}
                </Badge>
                {skill.source === "user" && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    已自定义
                  </Badge>
                )}
                {skill.source === "project" && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    当前作品
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                {skill.description}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={skill.mode === "always" || projectSlugs.includes(skill.slug)}
                disabled={skill.mode === "always" || busy}
                onCheckedChange={(checked) => void handleToggle(skill.slug, checked)}
                aria-label={`启用写作技能 ${skill.name}`}
                className="scale-75"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`查看写作技能 ${skill.name}`}
                onClick={() => void openSkill(skill, false)}
              >
                <Eye className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`编辑写作技能 ${skill.name}`}
                onClick={() => void openSkill(skill, true)}
              >
                <Pencil className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] h-6"
            onClick={() => setDisplayCount((count) => count + PAGE_SIZE)}
            data-testid="writing-skills-load-more"
          >
            加载更多（{displayed.length} / {visible.length}）
          </Button>
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{viewing?.name}</DialogTitle>
            <DialogDescription className="text-xs">{viewing?.description}</DialogDescription>
          </DialogHeader>

          {busy ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : editing ? (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="font-mono text-xs min-h-[320px]"
              aria-label="写作技能正文"
            />
          ) : (
            <pre className="max-h-[380px] overflow-auto rounded-md bg-muted p-3 text-[11px] whitespace-pre-wrap">
              {draft}
            </pre>
          )}

          {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}

          <DialogFooter className="gap-2">
            {viewing?.source === "user" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => viewing && void handleReset(viewing)}
              >
                <RotateCcw className="size-3 mr-1" />
                恢复内置
              </Button>
            )}
            {editing ? (
              <Button size="sm" disabled={busy} onClick={() => void handleSave()}>
                保存
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => viewing && void openSkill(viewing, true)}
              >
                编辑
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
