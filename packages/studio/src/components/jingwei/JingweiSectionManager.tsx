import { useMemo, useState } from "react";
import { Archive, Plus, Settings2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, postApi } from "@/hooks/use-api";
import { notify } from "@/lib/notify";

import { parseMarkdownDirectoryImport, type MarkdownDirectoryCandidate } from "./markdown-directory-import";
import type { JingweiFieldDefinitionView, JingweiFieldType, JingweiSectionView, JingweiVisibilityRuleType } from "./types";

interface JingweiSectionManagerProps {
  bookId: string;
  sections: JingweiSectionView[];
  onRefresh: () => Promise<unknown> | unknown;
}

type SectionDraft = {
  id?: string;
  key: string;
  name: string;
  description: string;
  order: number;
  enabled: boolean;
  showInSidebar: boolean;
  participatesInAi: boolean;
  defaultVisibility: JingweiVisibilityRuleType;
  fieldsJson: JingweiFieldDefinitionView[];
};

const FIELD_TYPES: Array<{ value: JingweiFieldType; label: string }> = [
  { value: "text", label: "文本" },
  { value: "textarea", label: "长文本" },
  { value: "number", label: "数字" },
  { value: "select", label: "单选" },
  { value: "multi-select", label: "多选" },
  { value: "chapter", label: "章节" },
  { value: "tags", label: "标签" },
  { value: "relation", label: "关联条目" },
  { value: "boolean", label: "开关" },
];

function uid(prefix: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${randomId}`;
}

function emptyDraft(nextOrder: number): SectionDraft {
  return {
    key: "",
    name: "",
    description: "",
    order: nextOrder,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
  };
}

function draftFromSection(section: JingweiSectionView): SectionDraft {
  return {
    id: section.id,
    key: section.key,
    name: section.name,
    description: section.description,
    order: section.order,
    enabled: section.enabled,
    showInSidebar: section.showInSidebar,
    participatesInAi: section.participatesInAi,
    defaultVisibility: section.defaultVisibility,
    fieldsJson: section.fieldsJson.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function JingweiSectionManager({ bookId, sections, onRefresh }: JingweiSectionManagerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SectionDraft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<JingweiSectionView | null>(null);
  const [saving, setSaving] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importMarkdown, setImportMarkdown] = useState("");
  const [importCandidates, setImportCandidates] = useState<MarkdownDirectoryCandidate[]>([]);
  const [selectedImportKeys, setSelectedImportKeys] = useState<ReadonlySet<string>>(new Set());

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [sections],
  );

  const startCreate = () => {
    setImportMode(false);
    setArchiveTarget(null);
    setDraft(emptyDraft(sortedSections.length));
  };

  const startEdit = (section: JingweiSectionView) => {
    setImportMode(false);
    setArchiveTarget(null);
    setDraft(draftFromSection(section));
  };

  const openImportPanel = () => {
    setImportMode(true);
    setArchiveTarget(null);
    setDraft(null);
    setImportCandidates([]);
    setSelectedImportKeys(new Set());
  };

  const previewImport = () => {
    const result = parseMarkdownDirectoryImport(importMarkdown);
    const existingKeys = new Set(sortedSections.map((section) => section.key));
    const candidates = result.candidates.filter((candidate) => !existingKeys.has(candidate.key));
    setImportCandidates(candidates);
    setSelectedImportKeys(new Set(candidates.map((candidate) => candidate.key)));
  };

  const toggleImportCandidate = (key: string) => {
    setSelectedImportKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const importSelectedSections = async () => {
    const selectedCandidates = importCandidates.filter((candidate) => selectedImportKeys.has(candidate.key));
    if (selectedCandidates.length === 0) {
      notify.error("请至少选择一个栏目");
      return;
    }

    setSaving(true);
    try {
      for (const [index, candidate] of selectedCandidates.entries()) {
        await postApi(`/books/${bookId}/jingwei/sections`, {
          key: candidate.key,
          name: candidate.name,
          description: "由 Markdown 目录导入创建。高级范本仅供参考，可继续调整。",
          order: sortedSections.length + index,
          enabled: true,
          showInSidebar: true,
          participatesInAi: true,
          defaultVisibility: "tracked",
          fieldsJson: [],
        });
      }
      await onRefresh();
      notify.success(`已导入 ${selectedCandidates.length} 个栏目`);
      setImportMode(false);
      setImportMarkdown("");
      setImportCandidates([]);
      setSelectedImportKeys(new Set());
    } catch (error) {
      notify.error("Markdown 目录导入失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const key = normalizeKey(draft.key);
    const name = draft.name.trim();
    if (!key || !name) {
      notify.error("栏目名和 key 不能为空");
      return;
    }
    const payload = {
      key,
      name,
      description: draft.description,
      order: Number.isFinite(draft.order) ? draft.order : 0,
      enabled: draft.enabled,
      showInSidebar: draft.showInSidebar,
      participatesInAi: draft.participatesInAi,
      defaultVisibility: draft.defaultVisibility,
      fieldsJson: draft.fieldsJson
        .filter((field) => field.key.trim() && field.label.trim())
        .map((field) => ({
          ...field,
          key: normalizeKey(field.key),
          label: field.label.trim(),
          helpText: field.helpText?.trim() || undefined,
        })),
    };

    setSaving(true);
    try {
      if (draft.id) {
        await fetchJson(`/books/${bookId}/jingwei/sections/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        notify.success("经纬栏目已更新");
      } else {
        await postApi(`/books/${bookId}/jingwei/sections`, payload);
        notify.success("经纬栏目已创建");
      }
      await onRefresh();
      setDraft(null);
    } catch (error) {
      notify.error("栏目保存失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const archiveSection = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/jingwei/sections/${archiveTarget.id}`, { method: "DELETE" });
      notify.success("经纬栏目已归档");
      await onRefresh();
      setArchiveTarget(null);
    } catch (error) {
      notify.error("栏目归档失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (patch: Partial<SectionDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);

  const updateField = (index: number, patch: Partial<JingweiFieldDefinitionView>) => {
    setDraft((current) => {
      if (!current) return current;
      const fieldsJson = current.fieldsJson.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field);
      return { ...current, fieldsJson };
    });
  };

  const addField = () => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        fieldsJson: [...current.fieldsJson, {
          id: uid("field"),
          key: "",
          label: "",
          type: "text",
          required: false,
          participatesInSummary: true,
        }],
      };
    });
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Settings2 size={15} />管理栏目
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>经纬栏目管理</DialogTitle>
            <DialogDescription>新增、改名、排序、启用或归档栏目；禁用栏目会默认隐藏，并从 AI 上下文装配中排除。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">当前栏目</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={openImportPanel}><Upload size={14} />导入 Markdown 目录</Button>
                  <Button type="button" size="sm" onClick={startCreate}><Plus size={14} />新增栏目</Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>栏目</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>排序</TableHead>
                    <TableHead>字段</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSections.map((section) => (
                    <TableRow key={section.id}>
                      <TableCell>
                        <div className="font-medium">{section.name}</div>
                        <div className="text-xs text-muted-foreground">{section.key}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={section.enabled ? "default" : "secondary"}>{section.enabled ? "启用" : "禁用"}</Badge>
                          {section.participatesInAi ? <Badge variant="outline">参与 AI</Badge> : <Badge variant="secondary">本地</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{section.order}</TableCell>
                      <TableCell>{section.fieldsJson.length}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="xs" variant="outline" onClick={() => startEdit(section)}>编辑 {section.name}</Button>
                          <Button type="button" size="xs" variant="destructive" onClick={() => { setDraft(null); setArchiveTarget(section); }}><Archive size={12} />归档 {section.name}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section className="rounded-xl border border-border/60 bg-background/60 p-4">
              {archiveTarget ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold">确认归档「{archiveTarget.name}」？</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">归档后会保留栏目数据，但默认不再显示，也不会参与 AI 上下文。你可以通过后续恢复功能重新启用。</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setArchiveTarget(null)}>取消</Button>
                    <Button type="button" variant="destructive" disabled={saving} onClick={archiveSection}>确认归档</Button>
                  </div>
                </div>
              ) : draft ? (
                <SectionForm draft={draft} saving={saving} onChange={updateDraft} onAddField={addField} onFieldChange={updateField} onCancel={() => setDraft(null)} onSave={saveDraft} />
              ) : importMode ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold">导入 Markdown 目录</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">可粘贴《没钱修什么仙》式高级范本目录或你自己的 Markdown 栏目目录。范本只是参考，不代表所有小说都需要这些栏目。</p>
                  </div>
                  <label className="space-y-1 text-sm font-medium">Markdown 目录<Textarea value={importMarkdown} onChange={(event) => setImportMarkdown(event.target.value)} /></label>
                  <div className="flex justify-between gap-2">
                    <Button type="button" variant="outline" onClick={() => setImportMode(false)}>取消</Button>
                    <Button type="button" onClick={previewImport}>识别栏目</Button>
                  </div>
                  {importCandidates.length > 0 ? (
                    <div className="space-y-3 rounded-xl border border-border/60 p-3">
                      <div className="text-sm font-semibold">候选栏目</div>
                      <div className="space-y-2">
                        {importCandidates.map((candidate) => (
                          <label key={candidate.key} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={selectedImportKeys.has(candidate.key)} onChange={() => toggleImportCandidate(candidate.key)} />
                            <span>{candidate.name}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" disabled={saving} onClick={importSelectedSections}>创建 {importCandidates.filter((candidate) => selectedImportKeys.has(candidate.key)).length} 个栏目</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-6 text-center">
                  <Settings2 className="mb-3 text-muted-foreground" size={28} />
                  <div className="font-semibold">选择一个栏目编辑，或新增自定义栏目</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">每本书都可以有自己的经纬结构；范本只是起点，不会锁死栏目。</p>
                </div>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SectionForm({ draft, saving, onChange, onAddField, onFieldChange, onCancel, onSave }: {
  draft: SectionDraft;
  saving: boolean;
  onChange: (patch: Partial<SectionDraft>) => void;
  onAddField: () => void;
  onFieldChange: (index: number, patch: Partial<JingweiFieldDefinitionView>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{draft.id ? "编辑栏目" : "新增栏目"}</h3>
        <p className="text-sm text-muted-foreground">配置栏目说明、可见性、AI 参与方式和自定义字段。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">栏目名<Input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
        <label className="space-y-1 text-sm font-medium">栏目 key<Input value={draft.key} onChange={(event) => onChange({ key: event.target.value })} disabled={Boolean(draft.id)} /></label>
        <label className="space-y-1 text-sm font-medium">排序<Input type="number" value={draft.order} onChange={(event) => onChange({ order: Number(event.target.value) })} /></label>
        <label className="space-y-1 text-sm font-medium">默认可见性
          <select value={draft.defaultVisibility} onChange={(event) => onChange({ defaultVisibility: event.target.value as JingweiVisibilityRuleType })} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="tracked">tracked：文本命中后可见</option>
            <option value="global">global：全局可见</option>
            <option value="nested">nested：父条目引入</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium sm:col-span-2">栏目说明<Textarea value={draft.description} onChange={(event) => onChange({ description: event.target.value })} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ToggleRow label="启用栏目" checked={draft.enabled} onChange={(enabled) => onChange({ enabled })} />
        <ToggleRow label="显示在侧栏" checked={draft.showInSidebar} onChange={(showInSidebar) => onChange({ showInSidebar })} />
        <ToggleRow label="参与 AI 上下文" checked={draft.participatesInAi} onChange={(participatesInAi) => onChange({ participatesInAi })} />
      </div>
      <div className="space-y-3 rounded-xl border border-border/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">字段定义</div>
          <Button type="button" size="sm" variant="outline" onClick={onAddField}>新增字段</Button>
        </div>
        {draft.fieldsJson.map((field, index) => (
          <div key={field.id} className="grid gap-2 rounded-lg bg-muted/30 p-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">字段标签<Input value={field.label} onChange={(event) => onFieldChange(index, { label: event.target.value })} /></label>
            <label className="space-y-1 text-sm font-medium">字段 key<Input value={field.key} onChange={(event) => onFieldChange(index, { key: event.target.value })} /></label>
            <label className="space-y-1 text-sm font-medium">字段类型
              <select aria-label="字段类型" value={field.type} onChange={(event) => onFieldChange(index, { type: event.target.value as JingweiFieldType })} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <ToggleRow label="字段必填" checked={field.required} onChange={(required) => onFieldChange(index, { required })} />
          </div>
        ))}
        {draft.fieldsJson.length === 0 ? <p className="text-sm text-muted-foreground">暂无自定义字段；通用条目仍会包含标题、正文、标签、章节和可见性规则。</p> : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="button" disabled={saving} onClick={onSave}>{saving ? "保存中..." : "保存栏目"}</Button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/70 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
