/**
 * 写作技能面板（写作台 › 技能文风 › 写作技能）。
 *
 * 只做一件与 Runtime 不重复的事：**按书启用**。
 *
 * - NovelFork 自带的 21 个写作技能只存在于插件包里（`builtin-skills/`），不在磁盘上；
 *   Runtime 的全局/项目技能页扫的是 `~/.novelfork/skills` 与 `<书>/.novelfork/skills`，
 *   看不到它们。所以「把哪个技能物化进本书」只能由这里决定。
 * - 技能的创建、改正文、删除交给 Runtime 的技能管理（写到同一批目录）。
 *   这里只提供只读查看，避免两套编辑入口写同一份 SKILL.md。
 *
 * 生效态以当前作品目录 `.novelfork/skills/` 的实际文件为准；本面板只对指定
 * catalog Skill 执行文件增删，不把选择状态写入 book.json。
 */

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Loader2, Eye } from "lucide-react";
import { useApi, putApi, fetchJson } from "@/hooks/use-api";
import { WRITING_SKILL_ENTRIES } from "../../engine/writing-skills/types";

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
  /** 作者入口名；缺省表示由模型按任务调用，不作为入口陈列。 */
  readonly entry?: string | null;
  /** 书内副本来自曾经内置、现已移出内置的第三方技能。 */
  readonly retiredFromBuiltin?: boolean;
  /** 第三方作品必须展示归属。 */
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

const ENTRY_ORDER: ReadonlyMap<string, number> = new Map(
  WRITING_SKILL_ENTRIES.map((entry, index) => [entry, index] as const),
);

/** 入口技能按产品固定顺序排在最前；未知入口名不算入口。 */
export function splitEntrySkills(skills: readonly WritingSkillItem[]): {
  readonly entries: readonly WritingSkillItem[];
  readonly others: readonly WritingSkillItem[];
} {
  const entries: WritingSkillItem[] = [];
  const others: WritingSkillItem[] = [];
  for (const skill of skills) {
    if (skill.entry && ENTRY_ORDER.has(skill.entry)) entries.push(skill);
    else others.push(skill);
  }
  entries.sort((left, right) => (ENTRY_ORDER.get(left.entry!) ?? 0) - (ENTRY_ORDER.get(right.entry!) ?? 0));
  return { entries, others };
}

export const RETIRED_BUILTIN_EXPLANATION =
  "这个技能来自第三方仓库，曾随产品内置，现已移出内置。本书里的副本照常生效；关闭会删除本书副本，之后要再用需自行安装到作者技能目录。";

/** 作者技能目录的说明文字；与 loader 的 authorWritingSkillsDir 保持一致。 */
const AUTHOR_SKILLS_DIR_HINT = "作者技能目录（默认 ~/.novelfork/skills/；设置了 NOVELFORK_HOME 时为 <NOVELFORK_HOME>/skills/）";

/**
 * 目录路径与技术细节。主界面只说「当前作品」，真实路径留给需要手动放文件的人，
 * 折叠不摆出来。
 */
export function WritingSkillPathDetails() {
  return (
    <details className="text-2xs text-muted-foreground" data-testid="writing-skills-path-details">
      <summary className="cursor-pointer select-none">目录路径与技术细节</summary>
      <div className="mt-1 space-y-1">
        <p>本书启用后的副本在作品目录的 <code>.novelfork/skills/</code>；作者副本与自装技能在{AUTHOR_SKILLS_DIR_HINT}。</p>
        <p>技能的创建、改正文与删除在 Runtime 的「套路 › 项目技能」里做，两处写的是同一批文件。</p>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** 一本书的技能清单卡片。`enabled` 为真时开关打开并可关闭，否则可启用。 */
function SkillRow({
  skill,
  enabled,
  busy,
  onToggle,
  onView,
  suffix,
}: {
  readonly skill: WritingSkillItem;
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly onView: () => void;
  readonly suffix?: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5 hover:bg-muted/50 transition-colors"
      data-testid={`writing-skill-card-${skill.slug}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium">{skill.name}</span>
          {skill.entry && (
            <Badge variant="default" className="text-2xs h-4">
              入口 · {skill.entry}
            </Badge>
          )}
          {enabled ? (
            <Badge variant="outline" className="text-2xs h-4">
              已启用
            </Badge>
          ) : skill.entry ? (
            // 纪律：入口技能是推荐≠默认启用，作者确认才点亮；没启用就明说「推荐启用」，不撒谎。
            <Badge variant="secondary" className="text-2xs h-4">
              推荐启用
            </Badge>
          ) : null}
          <Badge variant="secondary" className="text-2xs h-4">
            {kindLabel(skill.kind)}
          </Badge>
          {suffix && (
            <Badge variant="outline" className="text-2xs h-4">
              {suffix}
            </Badge>
          )}
          {skill.retiredFromBuiltin && (
            <Badge
              variant="outline"
              className="text-2xs h-4"
              title={RETIRED_BUILTIN_EXPLANATION}
              data-testid="writing-skill-retired-badge"
            >
              来源已移出内置
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {skill.description}
        </p>
        {skill.retiredFromBuiltin && (
          <p className="text-xs text-muted-foreground mt-0.5">{RETIRED_BUILTIN_EXPLANATION}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Switch
          checked={enabled}
          disabled={skill.mode === "always" || busy}
          onCheckedChange={onToggle}
          aria-label={`${enabled ? "停用" : "启用"}写作技能 ${skill.name}`}
          className="scale-75"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`查看写作技能 ${skill.name}`}
          onClick={onView}
        >
          <Eye className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * 写作技能面板：本书已启用的技能清单 + 可选技能，勾选即物化进当前作品目录。
 * 不提供改正文与删除（那在 Runtime 的技能管理里）。
 */
export function WritingSkillsPanel({ bookId }: WritingSkillsPanelProps) {
  const { data, loading, error, refetch } = useApi<WritingSkillsResponse>("/writing-skills");
  const [projectSlugs, setProjectSlugs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<WritingSkillItem | null>(null);
  const [readingBody, setReadingBody] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

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

  async function handleToggle(skill: WritingSkillItem, enabled: boolean) {
    if (skill.mode === "always") return;
    const previous = projectSlugs;
    const nextSlugs = enabled
      ? [...new Set([...projectSlugs, skill.slug])]
      : projectSlugs.filter((slug) => slug !== skill.slug);
    setProjectSlugs(nextSlugs);
    setNotice(null);
    setBusy(true);
    try {
      if (skill.source === "project") {
        // 当前作品独有的技能：文件就在书里，关闭即删除该文件。
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
    } finally {
      setBusy(false);
    }
  }

  /** 只读查看：作品目录的副本用书籍接口带来的原始正文，catalog 条目按 slug 取正文。 */
  async function openSkill(skill: WritingSkillItem) {
    setViewing(skill);
    setReadingBody(skill.body ?? skill.content ?? "");
    setNotice(null);
    if (skill.body ?? skill.content) return;
    setBusy(true);
    try {
      const detail = await fetchJson<{ skill: { body?: string; content?: string | null } }>(
        `/writing-skills/${encodeURIComponent(skill.slug)}`,
      );
      setReadingBody(detail.skill.body ?? detail.skill.content ?? "");
    } catch (openError) {
      setNotice(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusy(false);
    }
  }

  const isEnabled = (skill: WritingSkillItem) => skill.mode === "always" || projectSlugs.includes(skill.slug);

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

  const catalogSkills = data?.skills ?? [];
  const projectOnlySkills = (bookWritingSkills?.skills ?? []).filter(
    (skill) => skill.source === "project"
      && !catalogSkills.some((catalogSkill) => catalogSkill.slug === skill.slug),
  );
  const allSkills = [...catalogSkills, ...projectOnlySkills];

  // 本书已生效：书内副本（含 always 技能）为权威清单。
  const enabledSkills = (bookWritingSkills?.skills ?? []).filter((skill) => isEnabled(skill));
  // 可启用：catalog 里还没进本书的技能；项目独有技能已经在书里，不在此列。
  const availableSkills = catalogSkills
    .filter((skill) => !isEnabled(skill))
    .filter((skill) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return `${skill.name} ${skill.description} ${(skill.tags ?? []).join(" ")}`.toLowerCase().includes(needle);
    });
  const { entries: entrySkills, others: otherSkills } = splitEntrySkills(availableSkills);
  const othersExpanded = showOthers || query.trim().length > 0;
  const enabledNames = new Set(enabledSkills.map((skill) => skill.slug));

  if (allSkills.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 space-y-1" data-testid="writing-skills-empty">
        <p>没有可用的写作技能。内置写作技能随产品提供；你也可以在自己的作者技能目录里自建或安装（每个技能是一个带 SKILL.md 的文件夹）。</p>
        <WritingSkillPathDetails />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="writing-skills-panel">
      {/*
        作用域提示：技能库是全局的，启用态只物化到当前作品目录，
        必须就地说明取消勾选会删除作品副本，避免作者误以为是数据库开关。
      */}
      <div className="text-2xs text-muted-foreground space-y-1" data-testid="writing-skills-scope-hint">
        <p>
          技能库与作者副本全局共享；<span className="text-foreground">启用态只对当前作品生效（当前已发现 {projectSlugs.length} 个）</span>
          ——勾选会把技能复制到当前作品，取消勾选删除对应副本。技能的正文编辑与新建在 Runtime 的「套路 › 项目技能」里做。
        </p>
        <WritingSkillPathDetails />
      </div>

      {notice && <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">{notice}</p>}

      <section className="space-y-1.5" data-testid="writing-skills-enabled">
        <p className="text-xs font-medium text-foreground">本书已启用 {enabledSkills.length}</p>
        {enabledSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1" data-testid="writing-skills-enabled-empty">
            还没有启用任何写作技能。启用后，相关要求会在写章前注入并作为成品校验依据。
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {enabledSkills.map((skill) => (
              <SkillRow
                key={skill.slug}
                skill={skill}
                enabled
                busy={busy}
                suffix={skill.source === "project" ? "当前作品" : undefined}
                onToggle={(checked) => void handleToggle(skill, checked)}
                onView={() => void openSkill(skill)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5" data-testid="writing-skills-available">
        <p className="text-xs font-medium text-foreground">可启用 {availableSkills.length}</p>
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`搜索 ${catalogSkills.length} 个写作技能…`}
            className="h-7 flex-1 rounded border border-border bg-background px-2 text-2xs outline-none focus:border-primary"
            aria-label="搜索写作技能"
            data-testid="writing-skills-search"
          />
          <span className="text-2xs text-muted-foreground shrink-0">{availableSkills.length}</span>
        </div>

        {availableSkills.length === 0 && (
          <p className="text-xs text-muted-foreground py-2" data-testid="writing-skills-no-match">
            {query.trim() ? "没有匹配的写作技能，换个词再看看。" : "技能库里的技能都已在本作品启用。"}
          </p>
        )}

        {entrySkills.length > 0 && (
          <div className="space-y-1.5" data-testid="writing-skills-entries">
            <p className="text-xs text-muted-foreground">作者入口 {entrySkills.length}</p>
            <div className="grid grid-cols-1 gap-2">
              {entrySkills.map((skill) => (
                <SkillRow
                  key={skill.slug}
                  skill={skill}
                  enabled={enabledNames.has(skill.slug)}
                  busy={busy}
                  onToggle={(checked) => void handleToggle(skill, checked)}
                  onView={() => void openSkill(skill)}
                />
              ))}
            </div>
          </div>
        )}

        {otherSkills.length > 0 && (
          <div className="space-y-1.5" data-testid="writing-skills-others">
            {entrySkills.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOthers((value) => !value)}
                aria-expanded={othersExpanded}
                className="text-xs text-muted-foreground hover:text-foreground"
                data-testid="writing-skills-others-toggle"
              >
                {othersExpanded ? "收起" : "展开"}其余技能（{otherSkills.length}）· 叙述者会按任务自行调用
              </button>
            )}
            {othersExpanded && (
              <div className="grid grid-cols-1 gap-2">
                {otherSkills.map((skill) => (
                  <SkillRow
                    key={skill.slug}
                    skill={skill}
                    enabled={enabledNames.has(skill.slug)}
                    busy={busy}
                    onToggle={(checked) => void handleToggle(skill, checked)}
                    onView={() => void openSkill(skill)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

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
          ) : (
            <pre
              className="max-h-[380px] overflow-auto rounded-md bg-muted p-3 text-2xs whitespace-pre-wrap"
              aria-label="写作技能正文"
            >
              {readingBody}
            </pre>
          )}
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
