import { useMemo, useState } from "react";

import { VisibilityRuleEditor } from "./VisibilityRuleEditor";
import type { BibleEntry, BibleTab, VisibilityRuleDraft } from "./types";

interface EntryDraft {
  id: string;
  name: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  roleType: string;
  eventType: string;
  chapterNumber: string;
  wordCount: string;
  aliases: string;
  relatedCharacterIds: string;
  nestedRefs: string;
  keyEvents: string;
  appearingCharacterIds: string;
  pov: string;
  visibilityRule: VisibilityRuleDraft;
}

const defaultDraft: EntryDraft = {
  id: "",
  name: "",
  title: "",
  summary: "",
  content: "",
  category: "other",
  roleType: "minor",
  eventType: "background",
  chapterNumber: "",
  wordCount: "0",
  aliases: "",
  relatedCharacterIds: "",
  nestedRefs: "",
  keyEvents: "",
  appearingCharacterIds: "",
  pov: "",
  visibilityRule: { type: "global" },
};

function splitCsv(raw: string): string[] {
  return raw.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function parseNumber(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildBibleEntryPayload(tab: BibleTab, draft: EntryDraft): Record<string, unknown> {
  const id = draft.id.trim();
  const base = {
    ...(id ? { id } : {}),
    visibilityRule: draft.visibilityRule,
  };

  if (tab === "characters") {
    return {
      ...base,
      name: draft.name.trim(),
      aliases: splitCsv(draft.aliases),
      roleType: draft.roleType.trim() || "minor",
      summary: draft.summary.trim(),
      traits: {},
      firstChapter: parseNumber(draft.chapterNumber),
    };
  }

  if (tab === "events") {
    return {
      ...base,
      name: draft.name.trim(),
      eventType: draft.eventType.trim() || "background",
      chapterStart: parseNumber(draft.chapterNumber),
      summary: draft.summary.trim(),
      relatedCharacterIds: splitCsv(draft.relatedCharacterIds),
      foreshadowState: "active",
    };
  }

  if (tab === "settings") {
    return {
      ...base,
      name: draft.name.trim(),
      category: draft.category.trim() || "other",
      content: draft.content.trim(),
      nestedRefs: splitCsv(draft.nestedRefs),
    };
  }

  if (tab === "conflicts") {
    return {
      ...base,
      name: draft.name.trim(),
      type: draft.eventType.trim() || "external-character",
      scope: draft.category.trim() || "arc",
      priority: parseNumber(draft.wordCount) ?? 3,
      stakes: draft.summary.trim(),
      evolutionPath: parseNumber(draft.chapterNumber) ? [{ chapter: parseNumber(draft.chapterNumber), state: "brewing", summary: draft.summary.trim(), movedBy: "author" }] : [],
      resolutionState: draft.roleType.trim() || "brewing",
      relatedConflictIds: splitCsv(draft.relatedCharacterIds),
    };
  }

  if (tab === "world-model") {
    return {
      id: id || undefined,
      economy: draft.content.trim() ? { note: draft.content.trim() } : {},
      society: draft.summary.trim() ? { note: draft.summary.trim() } : {},
      geography: draft.aliases.trim() ? { note: draft.aliases.trim() } : {},
      powerSystem: draft.nestedRefs.trim() ? { note: draft.nestedRefs.trim() } : {},
      culture: draft.keyEvents.trim() ? { note: draft.keyEvents.trim() } : {},
      timeline: draft.appearingCharacterIds.trim() ? { note: draft.appearingCharacterIds.trim() } : {},
    };
  }

  if (tab === "premise") {
    return {
      id: id || undefined,
      logline: draft.name.trim(),
      theme: splitCsv(draft.keyEvents),
      tone: draft.roleType.trim(),
      targetReaders: draft.category.trim(),
      uniqueHook: draft.summary.trim(),
      genreTags: splitCsv(draft.nestedRefs),
    };
  }

  if (tab === "character-arcs") {
    return {
      ...base,
      characterId: draft.relatedCharacterIds.trim(),
      arcType: draft.roleType.trim() || "成长",
      startingState: draft.content.trim(),
      endingState: draft.summary.trim(),
      keyTurningPoints: parseNumber(draft.chapterNumber) ? [{ chapter: parseNumber(draft.chapterNumber), summary: draft.title.trim() }] : [],
      currentPosition: draft.pov.trim() || draft.summary.trim(),
    };
  }

  return {
    id: id || undefined,
    chapterNumber: parseNumber(draft.chapterNumber) ?? 1,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    wordCount: parseNumber(draft.wordCount) ?? 0,
    keyEvents: splitCsv(draft.keyEvents),
    appearingCharacterIds: splitCsv(draft.appearingCharacterIds),
    pov: draft.pov.trim(),
  };
}

export function EntryForm({
  tab,
  entries,
  onSubmit,
}: {
  tab: BibleTab;
  entries: ReadonlyArray<BibleEntry>;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EntryDraft>(defaultDraft);
  const [saving, setSaving] = useState(false);
  const nestedOptions = useMemo(
    () => entries.map((entry) => ({ id: entry.id, label: entry.name ?? entry.title ?? entry.id })),
    [entries],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(buildBibleEntryPayload(tab, draft));
      setDraft(defaultDraft);
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof EntryDraft, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border/40 bg-card/70 p-5 shadow-sm">
      <div>
        <h3 className="font-serif text-xl font-semibold">结构化表单</h3>
        <p className="text-xs text-muted-foreground">保存后会写入 Novel Bible SQLite 表，并可立即参与上下文预览。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          ID（可选）
          <input value={draft.id} onChange={(event) => set("id", event.target.value)} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground" placeholder="留空自动生成" />
        </label>
        {tab === "chapter-summaries" ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            标题
            <input value={draft.title} onChange={(event) => set("title", event.target.value)} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground" required />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            名称
            <input value={draft.name} onChange={(event) => set("name", event.target.value)} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground" required />
          </label>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {tab === "characters" && (
          <>
            <Field label="别名（逗号/换行）" value={draft.aliases} onChange={(value) => set("aliases", value)} />
            <Field label="角色类型" value={draft.roleType} onChange={(value) => set("roleType", value)} />
            <Field label="首次章节" type="number" value={draft.chapterNumber} onChange={(value) => set("chapterNumber", value)} />
          </>
        )}
        {tab === "events" && (
          <>
            <Field label="事件类型" value={draft.eventType} onChange={(value) => set("eventType", value)} />
            <Field label="起始章节" type="number" value={draft.chapterNumber} onChange={(value) => set("chapterNumber", value)} />
            <Field label="相关角色 IDs" value={draft.relatedCharacterIds} onChange={(value) => set("relatedCharacterIds", value)} />
          </>
        )}
        {tab === "settings" && (
          <>
            <Field label="分类" value={draft.category} onChange={(value) => set("category", value)} />
            <Field label="Nested refs" value={draft.nestedRefs} onChange={(value) => set("nestedRefs", value)} />
          </>
        )}
        {tab === "chapter-summaries" && (
          <>
            <Field label="章节号" type="number" value={draft.chapterNumber} onChange={(value) => set("chapterNumber", value)} />
            <Field label="字数" type="number" value={draft.wordCount} onChange={(value) => set("wordCount", value)} />
            <Field label="POV" value={draft.pov} onChange={(value) => set("pov", value)} />
            <Field label="关键事件 IDs" value={draft.keyEvents} onChange={(value) => set("keyEvents", value)} />
            <Field label="出场角色 IDs" value={draft.appearingCharacterIds} onChange={(value) => set("appearingCharacterIds", value)} />
          </>
        )}
        {tab === "conflicts" && (
          <>
            <Field label="矛盾类型" value={draft.eventType} onChange={(value) => set("eventType", value)} />
            <Field label="范围 main/arc/chapter/scene" value={draft.category} onChange={(value) => set("category", value)} />
            <Field label="优先级 1-5" type="number" value={draft.wordCount} onChange={(value) => set("wordCount", value)} />
            <Field label="状态" value={draft.roleType} onChange={(value) => set("roleType", value)} />
            <Field label="首次推进章节" type="number" value={draft.chapterNumber} onChange={(value) => set("chapterNumber", value)} />
          </>
        )}
        {tab === "world-model" && (
          <>
            <Field label="经济维度" value={draft.content} onChange={(value) => set("content", value)} />
            <Field label="社会维度" value={draft.summary} onChange={(value) => set("summary", value)} />
            <Field label="地理维度" value={draft.aliases} onChange={(value) => set("aliases", value)} />
            <Field label="力量体系维度" value={draft.nestedRefs} onChange={(value) => set("nestedRefs", value)} />
            <Field label="文化维度" value={draft.keyEvents} onChange={(value) => set("keyEvents", value)} />
            <Field label="纪年维度" value={draft.appearingCharacterIds} onChange={(value) => set("appearingCharacterIds", value)} />
          </>
        )}
        {tab === "premise" && (
          <>
            <Field label="基调" value={draft.roleType} onChange={(value) => set("roleType", value)} />
            <Field label="目标读者" value={draft.category} onChange={(value) => set("category", value)} />
            <Field label="主题关键词" value={draft.keyEvents} onChange={(value) => set("keyEvents", value)} />
            <Field label="流派标签" value={draft.nestedRefs} onChange={(value) => set("nestedRefs", value)} />
          </>
        )}
        {tab === "character-arcs" && (
          <>
            <Field label="角色 ID" value={draft.relatedCharacterIds} onChange={(value) => set("relatedCharacterIds", value)} />
            <Field label="弧线类型" value={draft.roleType} onChange={(value) => set("roleType", value)} />
            <Field label="转折章节" type="number" value={draft.chapterNumber} onChange={(value) => set("chapterNumber", value)} />
            <Field label="当前阶段" value={draft.pov} onChange={(value) => set("pov", value)} />
          </>
        )}
      </div>

      {tab !== "chapter-summaries" && tab !== "world-model" && tab !== "premise" && (
        <VisibilityRuleEditor
          value={draft.visibilityRule}
          nestedOptions={nestedOptions}
          onChange={(visibilityRule) => setDraft((prev) => ({ ...prev, visibilityRule }))}
        />
      )}

      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
        {tab === "settings" ? "内容" : tab === "premise" ? "差异化钩子" : tab === "character-arcs" ? "终点状态" : "摘要"}
        <textarea
          value={tab === "settings" ? draft.content : tab === "character-arcs" ? draft.summary : draft.summary}
          onChange={(event) => set(tab === "settings" ? "content" : "summary", event.target.value)}
          className="min-h-24 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
          required
        />
      </label>

      <button type="submit" disabled={saving} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
        {saving ? "保存中..." : "保存 Bible 条目"}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground" />
    </label>
  );
}
