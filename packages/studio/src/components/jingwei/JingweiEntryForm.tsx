import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, postApi } from "@/hooks/use-api";
import { notify } from "@/lib/notify";

import { CustomFieldEditor } from "./CustomFieldEditor";
import { VisibilityRuleEditor } from "./VisibilityRuleEditor";
import type { JingweiEntryView, JingweiSectionView, JingweiVisibilityRuleView } from "./types";

interface JingweiEntryFormProps {
  bookId: string;
  section: JingweiSectionView;
  entries: JingweiEntryView[];
  editingEntry?: JingweiEntryView | null;
  createSignal?: number;
  onEditingEntryChange?: (entry: JingweiEntryView | null) => void;
  onSaved: () => Promise<unknown> | unknown;
}

type EntryDraft = {
  id?: string;
  title: string;
  contentMd: string;
  tagsText: string;
  aliasesText: string;
  relatedChaptersText: string;
  relatedEntryIds: string[];
  customFields: Record<string, unknown>;
  visibilityRule: JingweiVisibilityRuleView;
  participatesInAi: boolean;
  tokenBudgetText: string;
};

function createDraft(section: JingweiSectionView, entry?: JingweiEntryView | null): EntryDraft {
  if (entry) {
    return {
      id: entry.id,
      title: entry.title,
      contentMd: entry.contentMd,
      tagsText: entry.tags.join(","),
      aliasesText: entry.aliases.join("\n"),
      relatedChaptersText: entry.relatedChapterNumbers.join(","),
      relatedEntryIds: [...entry.relatedEntryIds],
      customFields: { ...entry.customFields },
      visibilityRule: { ...entry.visibilityRule, keywords: [...(entry.visibilityRule.keywords ?? [])], parentEntryIds: [...(entry.visibilityRule.parentEntryIds ?? [])] },
      participatesInAi: entry.participatesInAi,
      tokenBudgetText: entry.tokenBudget == null ? "" : String(entry.tokenBudget),
    };
  }
  return {
    title: "",
    contentMd: "",
    tagsText: "",
    aliasesText: "",
    relatedChaptersText: "",
    relatedEntryIds: [],
    customFields: {},
    visibilityRule: { type: section.defaultVisibility },
    participatesInAi: true,
    tokenBudgetText: "",
  };
}

export function JingweiEntryForm({ bookId, section, entries, editingEntry, createSignal = 0, onEditingEntryChange, onSaved }: JingweiEntryFormProps) {
  const [draft, setDraft] = useState<EntryDraft | null>(editingEntry ? createDraft(section, editingEntry) : null);
  const [saving, setSaving] = useState(false);

  const beginCreate = () => {
    onEditingEntryChange?.(null);
    setDraft(createDraft(section));
  };

  const beginEdit = (entry: JingweiEntryView) => {
    onEditingEntryChange?.(entry);
    setDraft(createDraft(section, entry));
  };

  useEffect(() => {
    if (editingEntry) setDraft(createDraft(section, editingEntry));
  }, [editingEntry, section]);

  useEffect(() => {
    if (createSignal > 0) {
      onEditingEntryChange?.(null);
      setDraft(createDraft(section));
    }
  }, [createSignal, onEditingEntryChange, section]);

  const cancel = () => {
    setDraft(null);
    onEditingEntryChange?.(null);
  };

  const save = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) {
      notify.error("条目标题不能为空");
      return;
    }
    const payload = {
      sectionId: section.id,
      title,
      contentMd: draft.contentMd,
      tags: splitList(draft.tagsText),
      aliases: splitList(draft.aliasesText),
      customFields: draft.customFields,
      relatedChapterNumbers: splitNumbers(draft.relatedChaptersText),
      relatedEntryIds: uniqueStrings([...draft.relatedEntryIds, ...(draft.visibilityRule.parentEntryIds ?? [])]),
      visibilityRule: normalizeVisibilityRule(draft.visibilityRule),
      participatesInAi: draft.participatesInAi,
      tokenBudget: draft.tokenBudgetText.trim() ? Number(draft.tokenBudgetText) : null,
    };

    setSaving(true);
    try {
      if (draft.id) {
        await fetchJson(`/books/${bookId}/jingwei/entries/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        notify.success("经纬条目已更新");
      } else {
        await postApi(`/books/${bookId}/jingwei/entries`, payload);
        notify.success("经纬条目已保存");
      }
      await onSaved();
      cancel();
    } catch (error) {
      notify.error("条目保存失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/40 bg-card/70 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl font-semibold">{section.name}条目</h3>
          <p className="text-sm text-muted-foreground">统一支持标题、正文、标签、可见性、关联和栏目自定义字段。</p>
        </div>
        <Button type="button" onClick={beginCreate}><Plus size={15} />新增经纬条目</Button>
      </div>

      {draft ? (
        <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">条目标题<Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="space-y-1 text-sm font-medium">token 预算<Input type="number" value={draft.tokenBudgetText} onChange={(event) => setDraft({ ...draft, tokenBudgetText: event.target.value })} /></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">正文 Markdown<Textarea value={draft.contentMd} onChange={(event) => setDraft({ ...draft, contentMd: event.target.value })} /></label>
            <label className="space-y-1 text-sm font-medium">标签<Input value={draft.tagsText} onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })} placeholder="逗号或换行分隔" /></label>
            <label className="space-y-1 text-sm font-medium">别名 / 关键词<Input value={draft.aliasesText} onChange={(event) => setDraft({ ...draft, aliasesText: event.target.value })} placeholder="逗号或换行分隔" /></label>
            <label className="space-y-1 text-sm font-medium">关联章节<Input value={draft.relatedChaptersText} onChange={(event) => setDraft({ ...draft, relatedChaptersText: event.target.value })} placeholder="1,2,3" /></label>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/70 px-3 py-2">
              <span className="text-sm font-medium">参与 AI 上下文</span>
              <Switch checked={draft.participatesInAi} onCheckedChange={(participatesInAi) => setDraft({ ...draft, participatesInAi })} aria-label="条目参与 AI 上下文" />
            </div>
          </div>

          <CustomFieldEditor fields={section.fieldsJson} values={draft.customFields} onChange={(customFields) => setDraft({ ...draft, customFields })} />
          <VisibilityRuleEditor value={draft.visibilityRule} entries={entries.filter((entry) => entry.id !== draft.id)} onChange={(visibilityRule) => setDraft({ ...draft, visibilityRule })} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>取消</Button>
            <Button type="button" disabled={saving} onClick={save}>{saving ? "保存中..." : "保存条目"}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function splitList(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function splitNumbers(value: string): number[] {
  return splitList(value).map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function normalizeVisibilityRule(rule: JingweiVisibilityRuleView): JingweiVisibilityRuleView {
  return {
    type: rule.type,
    ...(rule.visibleAfterChapter ? { visibleAfterChapter: rule.visibleAfterChapter } : {}),
    ...(rule.visibleUntilChapter ? { visibleUntilChapter: rule.visibleUntilChapter } : {}),
    ...((rule.keywords ?? []).length > 0 ? { keywords: rule.keywords } : {}),
    ...(rule.type === "nested" && (rule.parentEntryIds ?? []).length > 0 ? { parentEntryIds: rule.parentEntryIds } : {}),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
