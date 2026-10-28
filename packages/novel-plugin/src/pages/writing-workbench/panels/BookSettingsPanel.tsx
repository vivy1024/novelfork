import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { fetchJson } from "@/hooks/use-api";
import { NarrativeMemorySettingsSection } from "./NarrativeMemorySettingsPanel";
import type { ForeshadowDebtThresholds } from "../../../engine/narrative-taxonomy/foreshadow-debts";
import { dispatchWritingProgress } from "../writing-progress-event";
import { ForeshadowThresholdField } from "./ForeshadowThresholdField";

interface BookConfig {
  title: string;
  genre: string;
  platform: "tomato" | "feilu" | "qidian" | "other";
  language: "zh" | "en";
  targetChapters: number | null;
  chapterWordCount: number;
  arcTrackingMode: "off" | "rule" | "llm";
  customSensitiveWords: string;
}

interface BookWritingLayers {
  authorIntent: string;
  currentFocus: string;
  volumeOutline: string;
  bookRulesRaw: string;
}

/** 可编辑的层字段。卷纲只读：权威在经纬「卷纲/大纲」条目，volume_outline.md 只是导出物。 */
type EditableLayerField = "authorIntent" | "currentFocus" | "bookRulesRaw";

function readRevisions(value: unknown): Partial<Record<EditableLayerField, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<EditableLayerField, string>> = {};
  for (const field of ["authorIntent", "currentFocus", "bookRulesRaw"] as const) {
    if (typeof record[field] === "string") result[field] = record[field] as string;
  }
  return result;
}

/** 可被外部直接定位的分区（写作视图一键修用）。 */
export type BookSettingsSection = "basic" | "writing-skills" | "narrative-memory" | "writing-layers" | "runtime-project";

/** 本面板实际存在的、可被滚动定位的分区。 */
const KNOWN_SECTIONS: readonly BookSettingsSection[] = ["basic", "writing-layers", "narrative-memory", "runtime-project"];

export interface BookSettingsPanelProps {
  bookId: string;
  onBack: () => void;
  /** 打开时滚动定位到指定分区；缺省停在顶部。 */
  initialSection?: BookSettingsSection;
  /**
   * 宿主（Studio）注入的 Runtime 项目设置界面（技能、可选工具）。
   *
   * 插件不能反向依赖宿主，所以 Runtime 的界面只能从这里进来；缺省（独立运行或本书
   * 尚未绑定 Runtime 项目）时该分区整块不渲染。Runtime 仍是这些设置的唯一实现方，
   * 插件只负责给它一个位置。
   */
  projectSettingsSlot?: ReactNode;
}

const PLATFORM_OPTIONS = [
  { value: "tomato", label: "番茄小说" },
  { value: "feilu", label: "飞卢小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "other", label: "其他" },
] as const;
const LANGUAGE_OPTIONS = [{ value: "zh", label: "中文" }, { value: "en", label: "English" }] as const;
const ARC_TRACKING_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "rule", label: "规则引擎" },
  { value: "llm", label: "LLM 精炼" },
] as const;

function useDebounce<T extends (...args: never[]) => unknown>(fn: T, delay: number): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return useCallback((...args: Parameters<T>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as unknown as T;
}

export function BookSettingsPanel({ bookId, onBack, initialSection, projectSettingsSlot }: BookSettingsPanelProps) {
  const [config, setConfig] = useState<BookConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  // error 态带着失败信息一直留到下次保存动作，不再静默落回 idle。
  const [saveStatus, setSaveStatus] = useState<{ state: "idle" | "saving" | "saved" } | { state: "error"; message: string }>({ state: "idle" });
  // book.json 里伏笔阈值的原始值，交给阈值字段自行校验与回退。
  const [foreshadowThresholdsRaw, setForeshadowThresholdsRaw] = useState<unknown>(undefined);
  const [layers, setLayers] = useState<BookWritingLayers>({
    authorIntent: "",
    currentFocus: "",
    volumeOutline: "",
    bookRulesRaw: "",
  });
  // 防抖保存读这几个 ref：保存时只取「改过的字段」的最新值和读取时拿到的 revision。
  const layersRef = useRef<BookWritingLayers>(layers);
  const layerRevisionsRef = useRef<Partial<Record<EditableLayerField, string>>>({});
  const dirtyLayerFieldsRef = useRef<Set<EditableLayerField>>(new Set());
  const [layerConflict, setLayerConflict] = useState(false);
  const [layersReloadToken, setLayersReloadToken] = useState(0);
  const sectionRefs = useRef<Partial<Record<BookSettingsSection, HTMLElement | null>>>({});

  // 从写作视图「一键修」跳进来时，直接滚到目标分区；
  // 未知/未注册的分区（如历史上的 "writing-skills"）只定位失败，不报错。
  useEffect(() => {
    if (!initialSection || !KNOWN_SECTIONS.includes(initialSection)) return;
    const target = sectionRefs.current[initialSection];
    if (target) target.scrollIntoView({ block: "start" });
  }, [initialSection]);

  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    fetchJson<Record<string, unknown>>(`/api/books/${encodeURIComponent(bookId)}`)
      .then((data) => {
        if (cancelled) return;
        const book = data && typeof data === "object" && "book" in data && data.book && typeof data.book === "object"
          ? data.book as Record<string, unknown> : data as Record<string, unknown>;
        setForeshadowThresholdsRaw(book.foreshadowDebtThresholds);
        setConfig({
          title: typeof book.title === "string" ? book.title : "",
          genre: typeof book.genre === "string" ? book.genre : "",
          platform: book.platform === "tomato" || book.platform === "feilu" || book.platform === "qidian" || book.platform === "other" ? book.platform : "other",
          language: book.language === "en" ? "en" : "zh",
          targetChapters: typeof book.targetChapters === "number" ? book.targetChapters : null,
          chapterWordCount: typeof book.chapterWordCount === "number" ? book.chapterWordCount : 2000,
          arcTrackingMode: book.arcTrackingMode === "rule" || book.arcTrackingMode === "llm" ? book.arcTrackingMode : "off",
          customSensitiveWords: typeof book.customSensitiveWords === "string" ? book.customSensitiveWords : "",
        });
        setConfigLoading(false);
      })
      .catch((cause) => {
        if (!cancelled) { setConfigError(cause instanceof Error ? cause.message : "加载失败"); setConfigLoading(false); }
      });
    return () => { cancelled = true; };
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Record<string, unknown>>(`/api/books/${encodeURIComponent(bookId)}/writing-layers`)
      .then((data) => {
        if (cancelled || !data) return;
        const design = data.bookDesign && typeof data.bookDesign === "object" ? data.bookDesign as Record<string, unknown> : {};
        const next: BookWritingLayers = {
          authorIntent: typeof design.authorIntent === "string" ? design.authorIntent : "",
          currentFocus: typeof design.currentFocus === "string" ? design.currentFocus : "",
          volumeOutline: typeof design.volumeOutline === "string" ? design.volumeOutline : "",
          bookRulesRaw: typeof data.bookRulesRaw === "string"
            ? data.bookRulesRaw
            : typeof data.bookRulesText === "string" ? data.bookRulesText : "",
        };
        layersRef.current = next;
        layerRevisionsRef.current = readRevisions(data.revisions);
        dirtyLayerFieldsRef.current = new Set();
        setLayers(next);
      })
      .catch(() => {
        // 存量书可能还没有独立层文件，保持空表单。
      });
    return () => { cancelled = true; };
  }, [bookId, layersReloadToken]);

  const saveConfig = useCallback(async (partial: Partial<BookConfig>) => {
    setSaveStatus({ state: "saving" });
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      setSaveStatus({ state: "saved" });
      setTimeout(() => setSaveStatus({ state: "idle" }), 1500);
    } catch (cause) {
      setSaveStatus({ state: "error", message: cause instanceof Error ? cause.message : "未知错误" });
    }
  }, [bookId]);
  const debouncedSave = useDebounce(saveConfig, 1000);
  const saveForeshadowThresholds = useCallback(async (value: ForeshadowDebtThresholds | null) => {
    setSaveStatus({ state: "saving" });
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foreshadowDebtThresholds: value }),
      });
      setSaveStatus({ state: "saved" });
      setTimeout(() => setSaveStatus({ state: "idle" }), 1500);
      // 已打开的伏笔看板、推进看板、侧栏据此重读阈值，不必刷新页面。
      dispatchWritingProgress({ reason: "foreshadow-thresholds", bookId });
      return true;
    } catch (cause) {
      setSaveStatus({ state: "error", message: cause instanceof Error ? cause.message : "未知错误" });
      return false;
    }
  }, [bookId]);
  const updateConfig = useCallback((key: keyof BookConfig, value: string | number | boolean | null) => {
    setConfig((current) => current ? { ...current, [key]: value } : current);
    void debouncedSave({ [key]: value });
  }, [debouncedSave]);

  // 只提交真正改过的字段，并带上读取时的 revision；服务端发现别处改过就拒绝，不覆盖。
  const flushLayers = useCallback(async () => {
    const fields = [...dirtyLayerFieldsRef.current];
    if (fields.length === 0) return;
    dirtyLayerFieldsRef.current = new Set();
    const values = layersRef.current;
    const design: Partial<Record<"authorIntent" | "currentFocus", string>> = {};
    if (fields.includes("authorIntent")) design.authorIntent = values.authorIntent;
    if (fields.includes("currentFocus")) design.currentFocus = values.currentFocus;
    const revisions = Object.fromEntries(fields
      .filter((field) => layerRevisionsRef.current[field] !== undefined)
      .map((field) => [field, layerRevisionsRef.current[field]]));
    setSaveStatus({ state: "saving" });
    try {
      const response = await fetchJson<Record<string, unknown> | undefined>(`/api/books/${encodeURIComponent(bookId)}/writing-layers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(Object.keys(design).length > 0 ? { bookDesign: design } : {}),
          ...(fields.includes("bookRulesRaw") ? { bookRulesRaw: values.bookRulesRaw } : {}),
          revisions,
        }),
      });
      layerRevisionsRef.current = { ...layerRevisionsRef.current, ...readRevisions(response?.revisions) };
      setSaveStatus({ state: "saved" });
      setTimeout(() => setSaveStatus({ state: "idle" }), 1500);
    } catch (cause) {
      // 失败的字段仍算未保存，下次改动时一并重试；冲突时保留作者手上的内容，等作者决定重新载入。
      for (const field of fields) dirtyLayerFieldsRef.current.add(field);
      if ((cause as { code?: unknown } | null)?.code === "WRITING_LAYER_REVISION_CONFLICT") setLayerConflict(true);
      setSaveStatus({ state: "error", message: cause instanceof Error ? cause.message : "未知错误" });
    }
  }, [bookId]);
  const saveLayers = useDebounce(flushLayers, 1000);
  const updateLayers = useCallback((key: EditableLayerField, value: string) => {
    dirtyLayerFieldsRef.current.add(key);
    layersRef.current = { ...layersRef.current, [key]: value };
    setLayers(layersRef.current);
    void saveLayers();
  }, [saveLayers]);
  const reloadLayers = useCallback(() => {
    setLayerConflict(false);
    setSaveStatus({ state: "idle" });
    setLayersReloadToken((token) => token + 1);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0"><ArrowLeft className="size-4" /></Button>
        <h1 className="text-sm font-semibold text-foreground">书籍设置</h1>
        {saveStatus.state === "saving" && <span className="ml-auto text-2xs text-muted-foreground">保存中...</span>}
        {saveStatus.state === "saved" && <span className="ml-auto text-2xs text-success">已保存</span>}
        {saveStatus.state === "error" && (
          <span role="alert" data-testid="book-settings-save-error" className="ml-auto text-xs text-destructive" title={saveStatus.message}>
            保存失败：{saveStatus.message}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 px-4 py-4">
        <section
          className="space-y-3"
          data-settings-section="basic"
          ref={(node) => { sectionRefs.current.basic = node; }}
        >
          <h2 className="text-sm font-semibold text-foreground">基本信息</h2>
          {configLoading ? <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div> : configError ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-4"><AlertCircle className="size-4 text-destructive" /><span className="text-sm text-muted-foreground">{configError}</span></div>
          ) : config ? <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="block space-y-1 text-xs text-muted-foreground">书名<Input value={config.title} onChange={(event) => updateConfig("title", event.target.value)} placeholder="输入书名" /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">流派<Input value={config.genre} onChange={(event) => updateConfig("genre", event.target.value)} placeholder="如：都市、玄幻、科幻" /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">平台<Select value={config.platform} onValueChange={(value) => updateConfig("platform", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PLATFORM_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>
            <label className="block space-y-1 text-xs text-muted-foreground">语言<Select value={config.language} onValueChange={(value) => updateConfig("language", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LANGUAGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>
          </div> : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">写作参数</h2>
          {config && <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="block space-y-1 text-xs text-muted-foreground">目标总章数<Input type="number" min={1} value={config.targetChapters ?? ""} onChange={(event) => updateConfig("targetChapters", event.target.value ? Number(event.target.value) : null)} /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">每章字数<Input type="number" min={500} value={config.chapterWordCount} onChange={(event) => updateConfig("chapterWordCount", Number(event.target.value))} /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">角色弧线追踪<Select value={config.arcTrackingMode} onValueChange={(value) => updateConfig("arcTrackingMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ARC_TRACKING_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>
            <label className="block space-y-1 text-xs text-muted-foreground">敏感词（每行一个）<Textarea value={config.customSensitiveWords} onChange={(event) => updateConfig("customSensitiveWords", event.target.value)} className="min-h-20" /></label>
            <ForeshadowThresholdField key={bookId} initial={foreshadowThresholdsRaw} onSave={saveForeshadowThresholds} />
          </div>}
        </section>

        <section
          className="space-y-3"
          data-settings-section="writing-layers"
          ref={(node) => { sectionRefs.current["writing-layers"] = node; }}
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">书籍层与规则层</h2>
            <p className="text-xs text-muted-foreground">书籍设计属于本书立项与推进；书籍规则属于强制约束与禁忌。</p>
          </div>
          {layerConflict && (
            <div role="alert" data-testid="writing-layers-conflict" className="flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-xs">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="space-y-2">
                <p className="text-foreground">这部分内容在你打开设置后被别处改过，刚才的改动没有保存，磁盘上的内容也没有被覆盖。</p>
                <p className="text-muted-foreground">先复制你的改动，再重新载入查看最新内容后合并进去。</p>
                <Button type="button" size="sm" variant="outline" onClick={reloadLayers}>重新载入最新内容</Button>
              </div>
            </div>
          )}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>作者意图（长期创作方向）</span>
              <Textarea
                aria-label="作者意图"
                value={layers.authorIntent}
                onChange={(event) => updateLayers("authorIntent", event.target.value)}
                className="min-h-20"
                placeholder="本书全书主线、终局追求和不可动摇的核心承诺。"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>当前聚焦（近 1-3 章焦点）</span>
              <Textarea
                aria-label="当前聚焦"
                value={layers.currentFocus}
                onChange={(event) => updateLayers("currentFocus", event.target.value)}
                className="min-h-20"
                placeholder="接下来几章必须优先解决的冲突、揭示或推进目标。"
              />
            </label>
            <div className="space-y-1 text-xs text-muted-foreground" data-testid="volume-outline-readonly">
              <span>分卷大纲摘要（只读）</span>
              <Textarea
                aria-describedby="volume-outline-hint"
                aria-label="分卷大纲摘要"
                value={layers.volumeOutline}
                readOnly
                className="min-h-20 bg-muted/40"
                placeholder="还没有卷纲。"
              />
              <p id="volume-outline-hint">
                这里显示的是经纬「卷纲/大纲」条目的导出内容，在此处修改会在下次导出时被覆盖。要调整卷纲，请到经纬的「卷纲/大纲」分类里编辑，或让叙述者生成卷纲。
              </p>
            </div>
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>书籍硬规则与禁忌（book_rules.md）</span>
              <Textarea
                aria-label="书籍硬规则"
                value={layers.bookRulesRaw}
                onChange={(event) => updateLayers("bookRulesRaw", event.target.value)}
                className="min-h-24"
                placeholder="主角性格锁定、行为禁区、战力上限等强制性写作约束。"
              />
            </label>
          </div>
        </section>

        {projectSettingsSlot ? (
          <section
            className="space-y-3"
            data-settings-section="runtime-project"
            ref={(node) => { sectionRefs.current["runtime-project"] = node; }}
          >
            <div>
              <h2 className="text-sm font-semibold text-foreground">Runtime 项目设置</h2>
              <p className="text-xs text-muted-foreground">
                这本书对应一个 Runtime 项目，技能与可选工具在 Runtime 自己的界面里按项目设置；这里嵌的就是它。
                MCP 权限、钩子与规则文件 Runtime 目前只有全局界面，本书级暂不可改。
              </p>
            </div>
            {projectSettingsSlot}
          </section>
        ) : null}

        <section
          className="space-y-3 pb-6"
          data-settings-section="narrative-memory"
          ref={(node) => { sectionRefs.current["narrative-memory"] = node; }}
        >
          <div><h2 className="text-sm font-semibold text-foreground">叙事记忆</h2><p className="text-xs text-muted-foreground">管理章节结算、当前故事状态与写作前动态召回。</p></div>
          <NarrativeMemorySettingsSection bookId={bookId} />
        </section>
      </div>
    </div>
  );
}
