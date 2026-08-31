import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/hooks/use-api";
import { NarrativeMemorySettingsSection } from "../../writing-config/WritingConfigSection";

interface BookConfig {
  title: string;
  genre: string;
  platform: "tomato" | "feilu" | "qidian" | "other";
  language: "zh" | "en";
  targetChapters: number | null;
  chapterWordCount: number;
  arcTrackingMode: "off" | "rule" | "llm";
  customSensitiveWords: string;
  authorProfileEnabled: boolean;
}

interface BookWritingLayers {
  authorIntent: string;
  currentFocus: string;
  volumeOutline: string;
  bookRulesRaw: string;
}

/** 可被外部直接定位的分区（写作视图一键修用）。 */
export type BookSettingsSection = "basic" | "writing-skills" | "narrative-memory" | "writing-layers";

/** 本面板实际存在的、可被滚动定位的分区。 */
const KNOWN_SECTIONS: readonly BookSettingsSection[] = ["basic", "writing-layers", "narrative-memory"];

export interface BookSettingsPanelProps {
  bookId: string;
  onBack: () => void;
  /** 打开时滚动定位到指定分区；缺省停在顶部。 */
  initialSection?: BookSettingsSection;
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

export function BookSettingsPanel({ bookId, onBack, initialSection }: BookSettingsPanelProps) {
  const [config, setConfig] = useState<BookConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [layers, setLayers] = useState<BookWritingLayers>({
    authorIntent: "",
    currentFocus: "",
    volumeOutline: "",
    bookRulesRaw: "",
  });
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
        setConfig({
          title: typeof book.title === "string" ? book.title : "",
          genre: typeof book.genre === "string" ? book.genre : "",
          platform: book.platform === "tomato" || book.platform === "feilu" || book.platform === "qidian" || book.platform === "other" ? book.platform : "other",
          language: book.language === "en" ? "en" : "zh",
          targetChapters: typeof book.targetChapters === "number" ? book.targetChapters : null,
          chapterWordCount: typeof book.chapterWordCount === "number" ? book.chapterWordCount : 2000,
          arcTrackingMode: book.arcTrackingMode === "rule" || book.arcTrackingMode === "llm" ? book.arcTrackingMode : "off",
          customSensitiveWords: typeof book.customSensitiveWords === "string" ? book.customSensitiveWords : "",
          authorProfileEnabled: book.authorProfileEnabled === true,
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
        if (cancelled) return;
        const design = data.bookDesign && typeof data.bookDesign === "object" ? data.bookDesign as Record<string, unknown> : {};
        setLayers({
          authorIntent: typeof design.authorIntent === "string" ? design.authorIntent : "",
          currentFocus: typeof design.currentFocus === "string" ? design.currentFocus : "",
          volumeOutline: typeof design.volumeOutline === "string" ? design.volumeOutline : "",
          bookRulesRaw: typeof data.bookRulesRaw === "string"
            ? data.bookRulesRaw
            : typeof data.bookRulesText === "string" ? data.bookRulesText : "",
        });
      })
      .catch(() => {
        // 存量书可能还没有独立层文件，保持空表单。
      });
    return () => { cancelled = true; };
  }, [bookId]);

  const saveConfig = useCallback(async (partial: Partial<BookConfig>) => {
    setSaveStatus("saving");
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }, [bookId]);
  const debouncedSave = useDebounce(saveConfig, 1000);
  const updateConfig = useCallback((key: keyof BookConfig, value: string | number | boolean | null) => {
    setConfig((current) => current ? { ...current, [key]: value } : current);
    void debouncedSave({ [key]: value });
  }, [debouncedSave]);

  const saveLayers = useDebounce(async (next: BookWritingLayers) => {
    setSaveStatus("saving");
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/writing-layers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookDesign: {
            authorIntent: next.authorIntent,
            currentFocus: next.currentFocus,
            volumeOutline: next.volumeOutline,
          },
          bookRulesRaw: next.bookRulesRaw,
        }),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }, 1000);
  const updateLayers = useCallback((key: keyof BookWritingLayers, value: string) => {
    setLayers((current) => {
      const next = { ...current, [key]: value };
      void saveLayers(next);
      return next;
    });
  }, [saveLayers]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0"><ArrowLeft className="size-4" /></Button>
        <h1 className="text-sm font-semibold text-foreground">书籍设置</h1>
        {saveStatus === "saving" && <span className="ml-auto text-[11px] text-muted-foreground">保存中...</span>}
        {saveStatus === "saved" && <span className="ml-auto text-[11px] text-green-500">已保存</span>}
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
            <div data-testid="author-profile-toggle" className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">注入作者跨书习惯</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">默认关闭；开启后才会把个人资料中的跨书习惯/口吻注入本书，避免跨书泄漏。</p>
              </div>
              <Switch checked={config.authorProfileEnabled} onCheckedChange={(checked) => updateConfig("authorProfileEnabled", checked)} aria-label="注入作者跨书习惯" className="shrink-0" />
            </div>
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
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>分卷大纲摘要</span>
              <Textarea
                aria-label="分卷大纲摘要"
                value={layers.volumeOutline}
                onChange={(event) => updateLayers("volumeOutline", event.target.value)}
                className="min-h-20"
                placeholder="按卷记录的核心目标与阶段性收束。"
              />
            </label>
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
