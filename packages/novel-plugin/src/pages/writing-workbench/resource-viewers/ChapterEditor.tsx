import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  countChapterLength,
  resolveLengthCountingMode,
  type LengthLanguage,
} from "@vivy1024/novelfork-core/utils/length-metrics";
import { Loader2 } from "lucide-react";
import { fetchJson } from "@/hooks/use-api";
import { SearchExtension, scrollToCurrentMatch } from "../ide/SearchExtension";
import { ENTITY_MENTION_REFRESH, EntityMentionExtension, type MentionEntity } from "../ide/EntityMentionExtension";
import { SearchBar } from "../ide/SearchBar";
import { EditorMinimap } from "./EditorMinimap";
import { LOCATE_IN_EDITOR_EVENT } from "../audit-issue-actions";

// ---------------------------------------------------------------------------
// BubbleMenu AI actions
// ---------------------------------------------------------------------------

type AiAction = "continue" | "polish" | "rewrite" | "expand" | "naturalize" | "compress";

const AI_ACTION_LABELS: Record<AiAction, string> = {
  continue: "续写",
  polish: "润色",
  rewrite: "改写",
  expand: "扩写",
  naturalize: "人味化",
  compress: "精简",
};

/**
 * 「人味化」走本地纯规则引擎，同步出候选，不依赖模型通道。
 * 其余动作需要语义判断，交给叙述者执行 —— 产品 HTTP 适配层没有 Provider，
 * 直接调 inline-write 只会拿到 prompt-preview，点了等于没反应。
 */
const LOCAL_RULE_ACTIONS = new Set<AiAction>(["naturalize"]);

const NARRATOR_TASK_LABELS: Record<Exclude<AiAction, "naturalize">, string> = {
  continue: "在选中位置之后自然续写 500-1500 字，保持人称、时态与文风一致",
  polish: "润色选中段落，只优化表达不改情节，字数保持在 ±20%",
  rewrite: "改写选中段落，含义不变但换全新表述，保持文风一致",
  expand: "扩写选中段落，在感官、动作或环境维度补细节，扩到 1.5x-2x",
  compress: "精简选中段落，删掉冗余修饰与解释性旁白，压到原文 50%-70%，保留全部情节节点与伏笔",
};

function BubbleButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:pointer-events-none transition-colors"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

interface DeslopManualFlag {
  readonly rule: string;
  readonly excerpt: string;
  readonly reason: string;
  readonly instruction: string;
}

interface DeslopResponse {
  readonly result?: {
    readonly text?: string;
    readonly edits?: readonly { readonly rule: string; readonly reason: string }[];
    readonly manualFlags?: readonly DeslopManualFlag[];
  };
}

/** 纯规则去 AI 味：0 LLM，同步返回改写结果与需语义判断的标注。 */
async function callDeslop(selectedText: string): Promise<DeslopResponse["result"]> {
  const data = await fetchJson<DeslopResponse>("/api/filter/deslop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: selectedText }),
  });
  return data.result;
}

/** 把选段任务组装成叙述者指令，由 Runtime 的 Agent Loop 与权限确认执行。 */
export function buildSelectionInstruction(
  action: Exclude<AiAction, "naturalize">,
  selectedText: string,
  chapterNumber: number | undefined,
  manualFlags: readonly DeslopManualFlag[] = [],
  styleProfileSummary?: string,
): string {
  const lines = [
    `请${NARRATOR_TASK_LABELS[action]}。`,
    chapterNumber ? `目标章节：第 ${chapterNumber} 章。` : "",
    "",
    "选中原文：",
    selectedText,
  ];
  if (styleProfileSummary?.trim()) {
    lines.push("", "全书文风基准：", styleProfileSummary.trim());
  }
  if (manualFlags.length > 0) {
    lines.push("", "本地规则已标出以下需要语义判断的问题，请一并处理：");
    for (const flag of manualFlags) {
      lines.push(`- 「${flag.excerpt}」：${flag.reason}。${flag.instruction}`);
    }
  }
  lines.push("", "改完请把结果给我确认，不要直接覆盖正文。");
  return lines.filter((line) => line !== undefined).join("\n");
}

interface PendingInlineEdit {
  readonly action: AiAction;
  readonly from: number;
  readonly to: number;
  readonly sourceText: string;
  readonly text: string;
  /** 纯规则改了几处。 */
  readonly autoEditCount: number;
  /** 规则没动、需要语义判断的项。 */
  readonly manualFlags: readonly DeslopManualFlag[];
}

interface AIBubbleMenuProps {
  editor: Editor;
  bookId: string;
  chapterNumber?: number;
  onSendToNarrator?: (message: string) => Promise<void> | void;
  styleProfileSummary?: string;
}

function AIBubbleMenu({ editor, bookId, chapterNumber, onSendToNarrator, styleProfileSummary }: AIBubbleMenuProps) {
  const [loading, setLoading] = useState<AiAction | null>(null);
  const [pending, setPending] = useState<PendingInlineEdit | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState<AiAction | null>(null);

  const handleAction = useCallback(async (action: AiAction) => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    setPending(null);
    setPendingError(null);
    setHandedOff(null);
    setLoading(action);
    try {
      if (LOCAL_RULE_ACTIONS.has(action)) {
        const result = await callDeslop(selectedText);
        const revised = result?.text ?? "";
        const autoEditCount = result?.edits?.length ?? 0;
        const manualFlags = result?.manualFlags ?? [];
        if (autoEditCount === 0 && manualFlags.length === 0) {
          setPendingError("本地规则没有发现可确定性改写的 AI 味特征。");
          return;
        }
        // 只有确定性改写才产生候选；语义项单独列出，不混进候选正文。
        setPending({ action, from, to, sourceText: selectedText, text: revised, autoEditCount, manualFlags });
        return;
      }

      // 语义类动作交给叙述者：产品 HTTP 层没有 Provider，直接调模型拿不到结果。
      if (!onSendToNarrator) {
        setPendingError("当前视图没有可用的叙述者，无法执行该操作。");
        return;
      }
      await onSendToNarrator(buildSelectionInstruction(action as Exclude<AiAction, "naturalize">, selectedText, chapterNumber, [], styleProfileSummary));
      setHandedOff(action);
    } catch (cause) {
      setPendingError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setLoading(null);
    }
  }, [editor, chapterNumber, onSendToNarrator, styleProfileSummary]);

  const applyPending = useCallback(() => {
    if (!pending) return;
    const currentText = editor.state.doc.textBetween(pending.from, pending.to, " ");
    if (currentText !== pending.sourceText) {
      setPendingError("选中文本已变化，请重新选择后生成候选");
      return;
    }
    if (pending.action === "continue") {
      editor.chain().focus().insertContentAt(pending.to, pending.text).run();
    } else {
      editor.chain().focus().deleteRange({ from: pending.from, to: pending.to }).insertContentAt(pending.from, pending.text).run();
    }
    setPending(null);
    setPendingError(null);
  }, [editor, pending]);

  /** 把规则没动的语义项连同原文一起交给叙述者。 */
  const handOffManualFlags = useCallback(async () => {
    if (!pending || !onSendToNarrator) return;
    await onSendToNarrator(buildSelectionInstruction("polish", pending.sourceText, chapterNumber, pending.manualFlags, styleProfileSummary));
    setHandedOff("naturalize");
    setPending(null);
  }, [pending, onSendToNarrator, chapterNumber, styleProfileSummary]);

  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
      <div className="max-w-sm rounded-lg border bg-card p-1.5 shadow-lg">
        {pending ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-2xs font-medium">
                {AI_ACTION_LABELS[pending.action]}：规则已改 {pending.autoEditCount} 处
              </span>
              <span className="text-2xs text-muted-foreground">不会自动覆盖正文</span>
            </div>
            {pending.autoEditCount > 0 ? (
              <div className="max-h-28 overflow-y-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{pending.text}</div>
            ) : (
              <div className="rounded bg-muted/50 px-2 py-1.5 text-2xs text-muted-foreground">
                没有可确定性改写的部分，以下问题需要语义判断。
              </div>
            )}
            {pending.manualFlags.length > 0 ? (
              <div className="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-1.5">
                <div className="text-2xs font-medium text-amber-700 dark:text-amber-400">
                  {pending.manualFlags.length} 处需语义判断，规则未改
                </div>
                <div className="max-h-20 space-y-0.5 overflow-y-auto">
                  {pending.manualFlags.slice(0, 5).map((flag, index) => (
                    <div key={`${flag.rule}-${index}`} className="text-2xs text-muted-foreground">
                      「{flag.excerpt}」{flag.reason}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {pendingError ? <div className="px-1 text-2xs text-destructive">{pendingError}</div> : null}
            <div className="flex justify-end gap-1">
              <BubbleButton onClick={() => { setPending(null); setPendingError(null); }}>放弃</BubbleButton>
              {pending.manualFlags.length > 0 && onSendToNarrator ? (
                <BubbleButton onClick={() => void handOffManualFlags()}>交叙述者</BubbleButton>
              ) : null}
              {pending.autoEditCount > 0 ? (
                <BubbleButton onClick={applyPending}>应用候选</BubbleButton>
              ) : null}
            </div>
          </div>
        ) : handedOff ? (
          <div className="space-y-1 px-1 py-0.5">
            <div className="text-2xs font-medium">已把{AI_ACTION_LABELS[handedOff]}任务交给叙述者</div>
            <div className="text-2xs text-muted-foreground">在对话面板查看结果，确认后再回写正文。</div>
            <div className="flex justify-end">
              <BubbleButton onClick={() => setHandedOff(null)}>知道了</BubbleButton>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex gap-1">
              {(Object.keys(AI_ACTION_LABELS) as AiAction[]).map((action) => (
                <BubbleButton
                  key={action}
                  onClick={() => void handleAction(action)}
                  disabled={loading !== null}
                >
                  {loading === action ? (
                    <Loader2 className="size-3 animate-spin inline" />
                  ) : (
                    AI_ACTION_LABELS[action]
                  )}
                </BubbleButton>
              ))}
            </div>
            {pendingError ? <div className="px-1 pb-0.5 text-2xs text-destructive">{pendingError}</div> : null}
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanWhitespace(str: string): string {
  return (str || "").replace(/\r\n/g, "\n").trim();
}

function countWords(text: string, language: LengthLanguage): number {
  return countChapterLength(text, resolveLengthCountingMode(language));
}

// ---------------------------------------------------------------------------
// ChapterEditor 组件
// ---------------------------------------------------------------------------

interface ChapterEditorProps {
  content: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
  placeholder?: string;
  /** 编辑器的 accessible name */
  ariaLabel?: string;
  /** Minimap 功能开关（默认开启） */
  showMinimap?: boolean;
  /** 书籍 ID，用于选中浮出工具栏调用本地规则与叙述者。 */
  bookId?: string;
  /** 当前章号，写进交给叙述者的选段指令。 */
  chapterNumber?: number;
  /**
   * 语义类选段动作（续写/润色/改写/扩写/精简）的执行通道。
   * 缺省时这些按钮会明确提示「没有可用叙述者」，而不是静默无反应。
   */
  onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 正文语言，决定长度按中文字符或英文单词统计。 */
  language?: LengthLanguage;
  /** 全书文风基准摘要（由宿主从 style/profile 读取透传），注入划词 AI prompt。 */
  styleProfileSummary?: string;
  /** 正文里要高亮的经纬实体（规范名 + 别名），由宿主从叙事结构快照传入。 */
  mentionEntities?: readonly MentionEntity[];
  /** Ctrl / ⌘ + 点击实体提及时打开资料卡。 */
  onOpenEntity?: (name: string) => void;
}

export function ChapterEditor({
  content,
  readonly,
  onContentChange,
  placeholder,
  ariaLabel = "章节正文",
  showMinimap = true,
  bookId,
  chapterNumber,
  onSendToNarrator,
  language = "zh",
  styleProfileSummary,
  mentionEntities,
  onOpenEntity,
}: ChapterEditorProps) {
  const [wordCount, setWordCount] = useState(0);
  const [searchMode, setSearchMode] = useState<"search" | "replace" | null>(null);
  const isExternalUpdate = useRef(false);
  const languageRef = useRef(language);
  languageRef.current = language;

  // 实体提及：扩展只读 ref，名单或回调变化不需要重建编辑器
  const mentionEntitiesRef = useRef<readonly MentionEntity[]>(mentionEntities ?? []);
  mentionEntitiesRef.current = mentionEntities ?? [];
  const onOpenEntityRef = useRef(onOpenEntity);
  onOpenEntityRef.current = onOpenEntity;

  // Task B: Minimap 需要的 ref
  const editorRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 100 },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "开始写作…",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SearchExtension,
      EntityMentionExtension.configure({
        getEntities: () => mentionEntitiesRef.current,
        onOpen: (name) => onOpenEntityRef.current?.(name),
      }),
    ],
    content: content || "",
    editable: !readonly,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;

      // Update word count and surface content changes immediately so the
      // containing canvas can mark the resource dirty without waiting for an
      // autosave debounce.
      const markdown = ed.storage.markdown.getMarkdown() as string;
      setWordCount(countWords(markdown, languageRef.current));
      onContentChange?.(markdown);
    },
  });

  // 名单变化时重算提及高亮
  const mentionSignature = (mentionEntities ?? []).map((entity) => `${entity.name}:${(entity.aliases ?? []).join("/")}`).join("|");
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(ENTITY_MENTION_REFRESH, true));
  }, [editor, mentionSignature]);

  // Sync editable state
  useEffect(() => {
    if (editor) {
      // 切换编辑权限不是正文输入，不能触发 onUpdate 把 Markdown 规范化结果自动写回。
      editor.setEditable(!readonly, false);
    }
  }, [editor, readonly]);

  // Sync external content changes
  useEffect(() => {
    if (!editor) return;
    const currentMd = editor.storage.markdown.getMarkdown() as string;
    if (cleanWhitespace(content) !== cleanWhitespace(currentMd)) {
      // If user is editing, do not swallow composition/letters unless it's a huge external change (e.g. Git load)
      if (editor.isFocused && Math.abs((content || "").length - currentMd.length) < 50) {
        return;
      }
      isExternalUpdate.current = true;
      editor.commands.setContent(content || "");
      isExternalUpdate.current = false;
      setWordCount(countWords(content, language));
    }
  }, [editor, content, language]);

  // Initial word count and language changes both use the original Markdown source.
  useEffect(() => {
    if (editor) {
      setWordCount(countWords(content, language));
    }
  }, [editor, content, language]);

  // Ctrl+F / Ctrl+H keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      // Skip if event originates from inside the search bar (let SearchBar handle its own keys)
      const target = e.target as HTMLElement;
      if (target.closest(".ide-search-bar")) return;

      if (e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode("search");
      } else if (e.key === "h") {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode("replace");
      }
    },
    [],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchMode(null);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const onLocate = (event: Event) => {
      const quote = (event as CustomEvent<{ quote?: string }>).detail?.quote?.trim();
      if (!quote) return;
      setSearchMode("search");
      editor.chain().setSearchQuery(quote).run();
      const container = editor.view.dom.closest(".chapter-editor");
      if (container) {
        requestAnimationFrame(() => scrollToCurrentMatch(editor, container as HTMLElement));
      }
    };
    window.addEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
    return () => window.removeEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="chapter-editor relative flex flex-col h-full min-h-0" onKeyDown={handleKeyDown}>
      {/* AI BubbleMenu — 选中文本后出现 */}
      {!readonly && bookId && editor && (
        <AIBubbleMenu
          editor={editor}
          bookId={bookId}
          chapterNumber={chapterNumber}
          onSendToNarrator={onSendToNarrator}
          styleProfileSummary={styleProfileSummary}
        />
      )}

      {/* Editor content with minimap */}
      <div className="flex-1 flex min-h-0">
        <div ref={editorRef} className="chapter-editor-wrapper flex-1 min-h-0 overflow-y-auto">
          <EditorContent editor={editor} className="chapter-editor__content" />
        </div>

        {/* Task B: Minimap */}
        {showMinimap && editor && (
          <EditorMinimap editor={editor} scrollContainerRef={editorRef} />
        )}
      </div>

      {/* Floating search bar */}
      {searchMode && (
        <SearchBar editor={editor} mode={searchMode} onClose={handleCloseSearch} />
      )}

      {/* Footer: word count */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-2xs text-muted-foreground">
        <span>{wordCount} {language === "en" ? "words" : "字"}</span>
      </div>
    </div>
  );
}
