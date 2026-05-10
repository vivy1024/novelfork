import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Store, Check, Plus, Pencil, Trash2, CloudOff } from "lucide-react";
import { useApi, postApi, putApi, fetchJson } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetBundle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly difficulty: "easy" | "medium" | "hard";
  readonly genreIds: readonly string[];
  readonly toneId: string;
  readonly settingBaseId: string;
  readonly logicRiskIds: readonly string[];
  readonly suitableFor: readonly string[];
  readonly tags?: readonly string[];
}

interface BundlesResponse {
  readonly bundles: readonly PresetBundle[];
}

interface UserTemplate {
  readonly id: string;
  readonly name: string;
  readonly genre: string;
  readonly description: string;
  readonly bundleJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface UserTemplatesResponse {
  readonly templates: readonly UserTemplate[];
}

interface RemoteTemplate {
  readonly id: string;
  readonly name: string;
  readonly genre: string;
  readonly description: string;
  readonly author?: string;
  readonly tags?: readonly string[];
}

interface RemoteTemplatesResponse {
  readonly templates: readonly RemoteTemplate[];
}

export interface TemplateMarketPanelProps {
  readonly bookId: string;
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENRE_OPTIONS = [
  { value: "xuanhuan", label: "玄幻" },
  { value: "xianxia", label: "仙侠" },
  { value: "urban", label: "都市" },
  { value: "scifi", label: "科幻" },
  { value: "wuxia", label: "武侠" },
  { value: "game", label: "游戏" },
  { value: "apocalypse", label: "末日" },
  { value: "transmigration", label: "穿越" },
  { value: "rebirth", label: "重生" },
  { value: "system-flow", label: "系统流" },
  { value: "infinite-flow", label: "无限流" },
  { value: "occult", label: "诡秘" },
  { value: "son-in-law", label: "赘婿" },
  { value: "farming", label: "种田" },
  { value: "politics", label: "官场" },
  { value: "military", label: "军事" },
  { value: "sports", label: "体育" },
  { value: "fanfiction", label: "同人" },
  { value: "light-novel", label: "轻小说" },
  { value: "cthulhu", label: "克苏鲁" },
  { value: "cyberpunk", label: "赛博朋克" },
  { value: "cultivation", label: "修真" },
  { value: "supernatural", label: "灵异" },
  { value: "history", label: "历史" },
  { value: "mystery", label: "悬疑" },
  { value: "romance", label: "言情" },
];

const GENRE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  GENRE_OPTIONS.map((o) => [o.value, o.label])
);

const SOURCE_BADGE = {
  builtin: { label: "内置", className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-0" },
  user: { label: "自建", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0" },
  remote: { label: "远程", className: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400 border-0" },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function deleteApi(path: string): Promise<void> {
  await fetchJson<undefined>(path, { method: "DELETE" });
}

function genreLabel(genreIds: readonly string[]): string {
  if (genreIds.length === 0) return "通用";
  return genreIds.map((id) => GENRE_LABEL_MAP[id] ?? id).join("/");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BundleCard({
  name,
  description,
  genreIds,
  source,
  actionLabel,
  actionVariant = "outline",
  onAction,
  isActing,
  isActed,
  actedLabel,
  secondaryActions,
}: {
  name: string;
  description: string;
  genreIds: readonly string[];
  source: "builtin" | "user" | "remote";
  actionLabel: string;
  actionVariant?: "outline" | "default";
  onAction: () => void;
  isActing: boolean;
  isActed: boolean;
  actedLabel: string;
  secondaryActions?: React.ReactNode;
}) {
  const badge = SOURCE_BADGE[source];
  return (
    <div className="rounded-md border border-border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate">{name}</span>
          <Badge className={`text-[8px] h-3.5 ${badge.className}`}>{badge.label}</Badge>
          {genreIds.length > 0 && (
            <Badge variant="secondary" className="text-[8px] h-3.5">{genreLabel(genreIds)}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {secondaryActions}
          <Button
            size="sm"
            variant={isActed ? "ghost" : actionVariant}
            className="h-6 text-[10px] px-2"
            disabled={isActing || isActed}
            onClick={onAction}
          >
            {isActing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : isActed ? (
              <>
                <Check className="size-3 mr-0.5 text-green-600" />
                {actedLabel}
              </>
            ) : (
              actionLabel
            )}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground line-clamp-2">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Template Form
// ---------------------------------------------------------------------------

interface TemplateFormData {
  name: string;
  genre: string;
  description: string;
  prompt: string;
}

function UserTemplateForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: TemplateFormData;
  onSave: (data: TemplateFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [genre, setGenre] = useState(initial?.genre ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), genre, description: description.trim(), prompt: prompt.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-border p-2.5 space-y-2">
      <Input
        placeholder="模板名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-7 text-xs"
      />
      <SimpleSelect
        value={genre}
        onValueChange={setGenre}
        options={GENRE_OPTIONS}
        placeholder="选择流派"
        className="h-7 text-xs w-full"
        aria-label="流派选择"
      />
      <Textarea
        placeholder="模板描述（1-2 行）"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="text-xs resize-none"
      />
      <Textarea
        placeholder="写作指导 prompt（风格、节奏、注意事项等）"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        className="text-xs resize-none"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" className="h-6 text-[10px] px-3" disabled={saving || !name.trim()}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : "保存"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-3" onClick={onCancel} disabled={saving}>
          取消
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tab: Built-in Bundles
// ---------------------------------------------------------------------------

function BuiltinTab({ bookId }: { bookId: string }) {
  const { data, loading, error } = useApi<BundlesResponse>("/presets/bundles");
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleApply = useCallback(async (bundle: PresetBundle) => {
    setApplying(bundle.id);
    try {
      const presetIds: string[] = [...bundle.genreIds];
      if (bundle.toneId) presetIds.push(bundle.toneId);
      if (bundle.settingBaseId) presetIds.push(bundle.settingBaseId);
      presetIds.push(...bundle.logicRiskIds);
      await putApi(`/books/${bookId}/presets`, { enabledPresetIds: presetIds });
      setApplied((prev) => new Set([...prev, bundle.id]));
      setSuccessMsg(`已应用「${bundle.name}」`);
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch {
      // error handled by putApi throwing
    } finally {
      setApplying(null);
    }
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载模板…</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-2">{error}</p>;
  }

  const bundles = data?.bundles ?? [];

  return (
    <div className="space-y-2">
      {successMsg && <p className="text-[10px] text-green-600">{successMsg}</p>}
      {bundles.map((bundle) => (
        <BundleCard
          key={bundle.id}
          name={bundle.name}
          description={bundle.description}
          genreIds={bundle.genreIds}
          source="builtin"
          actionLabel="应用"
          onAction={() => void handleApply(bundle)}
          isActing={applying === bundle.id}
          isActed={applied.has(bundle.id)}
          actedLabel="已应用"
        />
      ))}
      {bundles.length === 0 && (
        <p className="text-[10px] text-muted-foreground text-center py-3">暂无内置模板</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: User Templates
// ---------------------------------------------------------------------------

function UserTab({ bookId }: { bookId: string }) {
  const { data, loading, error, refetch } = useApi<UserTemplatesResponse>("/presets/user-templates");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreate = useCallback(async (formData: TemplateFormData) => {
    setSaving(true);
    try {
      await postApi("/presets/user-templates", {
        name: formData.name,
        genre: formData.genre,
        description: formData.description,
        bundleJson: JSON.stringify({ prompt: formData.prompt }),
      });
      setShowForm(false);
      setSuccessMsg("模板已创建");
      setTimeout(() => setSuccessMsg(null), 2000);
      await refetch();
    } catch {
      // error from postApi
    } finally {
      setSaving(false);
    }
  }, [refetch]);

  const handleUpdate = useCallback(async (id: string, formData: TemplateFormData) => {
    setSaving(true);
    try {
      await putApi(`/presets/user-templates/${id}`, {
        name: formData.name,
        genre: formData.genre,
        description: formData.description,
        bundleJson: JSON.stringify({ prompt: formData.prompt }),
      });
      setEditingId(null);
      setSuccessMsg("模板已更新");
      setTimeout(() => setSuccessMsg(null), 2000);
      await refetch();
    } catch {
      // error from putApi
    } finally {
      setSaving(false);
    }
  }, [refetch]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deleteApi(`/presets/user-templates/${id}`);
      setSuccessMsg("模板已删除");
      setTimeout(() => setSuccessMsg(null), 2000);
      await refetch();
    } catch {
      // error from deleteApi
    } finally {
      setDeleting(null);
    }
  }, [refetch]);

  const handleApply = useCallback(async (template: UserTemplate) => {
    setApplying(template.id);
    try {
      await postApi(`/books/${bookId}/jingwei/templates/apply`, { templateId: template.id });
      setApplied((prev) => new Set([...prev, template.id]));
      setSuccessMsg(`已应用「${template.name}」`);
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch {
      // error
    } finally {
      setApplying(null);
    }
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载模板…</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-2">{error}</p>;
  }

  const templates = data?.templates ?? [];

  function getEditFormData(t: UserTemplate): TemplateFormData {
    let prompt = "";
    try {
      const parsed = JSON.parse(t.bundleJson) as { prompt?: string };
      prompt = parsed.prompt ?? "";
    } catch {
      // ignore
    }
    return { name: t.name, genre: t.genre, description: t.description, prompt };
  }

  return (
    <div className="space-y-2">
      {successMsg && <p className="text-[10px] text-green-600">{successMsg}</p>}

      {!showForm && !editingId && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => setShowForm(true)}
        >
          <Plus className="size-3" />
          新建模板
        </Button>
      )}

      {showForm && (
        <UserTemplateForm
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={saving}
        />
      )}

      {templates.map((template) =>
        editingId === template.id ? (
          <UserTemplateForm
            key={template.id}
            initial={getEditFormData(template)}
            onSave={(data) => void handleUpdate(template.id, data)}
            onCancel={() => setEditingId(null)}
            saving={saving}
          />
        ) : (
          <BundleCard
            key={template.id}
            name={template.name}
            description={template.description}
            genreIds={template.genre ? [template.genre] : []}
            source="user"
            actionLabel="应用"
            onAction={() => void handleApply(template)}
            isActing={applying === template.id}
            isActed={applied.has(template.id)}
            actedLabel="已应用"
            secondaryActions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => setEditingId(template.id)}
                  title="编辑"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(template.id)}
                  disabled={deleting === template.id}
                  title="删除"
                >
                  {deleting === template.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </Button>
              </>
            }
          />
        )
      )}

      {templates.length === 0 && !showForm && (
        <p className="text-[10px] text-muted-foreground text-center py-3">暂无自建模板，点击上方按钮创建</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Remote Market
// ---------------------------------------------------------------------------

function RemoteTab({ onDownloaded }: { onDownloaded: () => void }) {
  const { data, loading, error } = useApi<RemoteTemplatesResponse>("/market/templates");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleDownload = useCallback(async (template: RemoteTemplate) => {
    setDownloading(template.id);
    try {
      await postApi(`/market/templates/${template.id}/download`, {});
      setDownloaded((prev) => new Set([...prev, template.id]));
      setSuccessMsg(`已下载「${template.name}」`);
      setTimeout(() => setSuccessMsg(null), 2000);
      onDownloaded();
    } catch {
      // error
    } finally {
      setDownloading(null);
    }
  }, [onDownloaded]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载远程市场…</span>
      </div>
    );
  }

  if (error || !data?.templates?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <CloudOff className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">远程市场暂不可用</p>
      </div>
    );
  }

  const templates = data.templates;

  return (
    <div className="space-y-2">
      {successMsg && <p className="text-[10px] text-green-600">{successMsg}</p>}
      {templates.map((template) => (
        <BundleCard
          key={template.id}
          name={template.name}
          description={template.description}
          genreIds={template.genre ? [template.genre] : []}
          source="remote"
          actionLabel="下载"
          actionVariant="default"
          onAction={() => void handleDownload(template)}
          isActing={downloading === template.id}
          isActed={downloaded.has(template.id)}
          actedLabel="已下载"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TemplateMarketPanel({ bookId, onClose }: TemplateMarketPanelProps) {
  const [activeTab, setActiveTab] = useState("builtin");
  const { data: bundlesData } = useApi<BundlesResponse>("/presets/bundles");
  const bundleCount = bundlesData?.bundles?.length ?? 0;

  // Used to trigger user-templates refetch after remote download
  const handleRemoteDownloaded = useCallback(() => {
    // Switch to user tab to show the downloaded template
    setActiveTab("user");
  }, []);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="template-market-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Store className="size-3.5 text-primary" />
          <span className="text-xs font-medium">模板市场</span>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-7 w-full">
          <TabsTrigger value="builtin" className="text-[10px] h-5 px-2">
            内置{bundleCount > 0 ? `(${bundleCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="user" className="text-[10px] h-5 px-2">
            我的模板
          </TabsTrigger>
          <TabsTrigger value="remote" className="text-[10px] h-5 px-2">
            远程市场
          </TabsTrigger>
        </TabsList>

        <div className="max-h-[340px] overflow-y-auto mt-2">
          <TabsContent value="builtin">
            <BuiltinTab bookId={bookId} />
          </TabsContent>
          <TabsContent value="user">
            <UserTab bookId={bookId} />
          </TabsContent>
          <TabsContent value="remote">
            <RemoteTab onDownloaded={handleRemoteDownloaded} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
