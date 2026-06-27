/**
 * ArtifactPanel — 生成式浮现面板
 *
 * Agent 调用 Write/Edit 工具时，右侧自动浮现并排面板，
 * 实时流式展示正在生成的文件内容。类似 Claude Artifacts 体验。
 */

import { useMemo, useState, useEffect, useRef, useDeferredValue } from "react";
import { X, FileText, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { ConversationSurfaceMessage } from "./MessageStream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArtifactFile {
  /** 工具调用 ID */
  toolCallId: string;
  /** 文件路径 */
  filePath: string;
  /** 文件内容（流式或最终） */
  content: string;
  /** 是否正在流式写入 */
  streaming: boolean;
  /** 工具名 */
  toolName: string;
}

export interface ArtifactPanelProps {
  messages: readonly ConversationSurfaceMessage[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "jingwei.write", "jingwei_write", "jingwei.upsert_entry", "jingwei_upsert_entry", "pipeline.write"]);

// Bug 6 fix: jingwei category 校验
const VALID_JINGWEI_CATEGORIES = new Set([
  "premise", "world-model", "characters", "relationships", "factions",
  "locations", "props", "outline", "conflicts", "foreshadowing",
  "timeline", "chapter-summaries", "power-system", "rules", "reference",
  "unclassified",
]);

function normalizeCategory(raw: unknown): string {
  if (typeof raw === "string" && VALID_JINGWEI_CATEGORIES.has(raw)) return raw;
  return "unclassified";
}

/** 从部分 JSON 字符串中尽力解析 file_path 和 content */
function parsePartialWriteInput(partialJson: string, toolName: string): { filePath: string; content: string } | null {
  // 尝试完整 JSON 解析
  try {
    const parsed = JSON.parse(partialJson);
    if (parsed.file_path && typeof parsed.content === "string") {
      return { filePath: parsed.file_path, content: parsed.content };
    }
    // Edit 工具格式
    if (parsed.file_path && typeof parsed.new_string === "string") {
      return { filePath: parsed.file_path, content: parsed.new_string };
    }
    // jingwei.upsert_entry 格式
    if (parsed.title && typeof parsed.contentMd === "string") {
      const category = normalizeCategory(parsed.category);
      return { filePath: `jingwei/${category}/${parsed.title}.md`, content: parsed.contentMd };
    }
    // pipeline.write 章节结果格式
    if (typeof parsed.content === "string" && (parsed.title || parsed.chapterNumber || toolName === "pipeline.write")) {
      const chapterNumber = Number.isFinite(Number(parsed.chapterNumber)) ? Number(parsed.chapterNumber) : 0;
      const title = parsed.title ?? (chapterNumber > 0 ? `第${chapterNumber}章` : "章节结果");
      const prefix = chapterNumber > 0 ? String(chapterNumber).padStart(4, "0") : "chapter";
      return { filePath: `chapters/${prefix}_${title}.md`, content: parsed.content };
    }
  } catch {
    // 部分 JSON — 用正则提取
  }

  // pipeline.write 的部分 JSON 解析
  if (toolName === "pipeline.write") {
    const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
    const chapterMatch = partialJson.match(/"chapterNumber"\s*:\s*(\d+)/);
    const contentMatch = partialJson.match(/"content"\s*:\s*"([\s\S]*)$/);
    const chapterNumber = chapterMatch?.[1] ? Number(chapterMatch[1]) : 0;
    const title = titleMatch?.[1] ?? (chapterNumber > 0 ? `第${chapterNumber}章` : "章节结果");
    const prefix = chapterNumber > 0 ? String(chapterNumber).padStart(4, "0") : "chapter";
    if (contentMatch) {
      let raw = contentMatch[1].replace(/["\s}]*$/, "");
      try {
        return { filePath: `chapters/${prefix}_${title}.md`, content: JSON.parse(`"${raw}"`) };
      } catch {
        return { filePath: `chapters/${prefix}_${title}.md`, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
      }
    }
    return { filePath: `chapters/${prefix}_${title}.md`, content: "" };
  }

  // jingwei.upsert_entry 的部分 JSON 解析
  if (toolName.includes("jingwei") || toolName.includes("upsert")) {
    const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]*?)"/);
    const categoryMatch = partialJson.match(/"category"\s*:\s*"([^"]*?)"/);
    // Use a non-greedy approach: match contentMd value, stop at the closing of the JSON object
    const contentMdStart = partialJson.indexOf('"contentMd"');
    const title = titleMatch?.[1] ?? "";
    const category = normalizeCategory(categoryMatch?.[1]);
    const filePath = title ? `jingwei/${category}/${title}.md` : "";

    if (contentMdStart >= 0) {
      const afterKey = partialJson.slice(contentMdStart);
      const colonIdx = afterKey.indexOf(':');
      if (colonIdx >= 0) {
        const afterColon = afterKey.slice(colonIdx + 1).trimStart();
        if (afterColon.startsWith('"')) {
          let raw = afterColon.slice(1);
          // Try to find the real end: closing quote followed by next field
          const nextFieldMatch = raw.match(/",\s*"(?:title|category|layer|action|bookId|entryId|content|mode|priorityTier)/);
          if (nextFieldMatch && nextFieldMatch.index !== undefined) {
            raw = raw.slice(0, nextFieldMatch.index);
          } else {
            // No next field found — take everything (streaming case)
            raw = raw.replace(/["\s}]*$/, "");
          }
          try {
            return { filePath, content: JSON.parse(`"${raw}"`) };
          } catch {
            return { filePath, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
          }
        }
      }
    }
    if (filePath) {
      return { filePath, content: "" };
    }
  }

  // 正则提取 file_path
  const pathMatch = partialJson.match(/"file_path"\s*:\s*"([^"]+)"/);
  const filePath = pathMatch?.[1] ?? "";

  // 正则提取 content（处理转义序列，避免 \" 误断）
  const contentMatch = partialJson.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]/);
  if (contentMatch) {
    try {
      return { filePath, content: JSON.parse(`"${contentMatch[1]}"`) };
    } catch {
      return { filePath, content: contentMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
    }
  }

  // Edit 工具的 new_string
  const newStringMatch = partialJson.match(/"new_string"\s*:\s*"([\s\S]*)$/);
  if (newStringMatch) {
    let raw = newStringMatch[1].replace(/["\s}]*$/, "");
    try {
      return { filePath, content: JSON.parse(`"${raw}"`) };
    } catch {
      return { filePath, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
    }
  }

  if (filePath) {
    return { filePath, content: "" };
  }

  return null;
}

/** 从文件路径中提取短文件名 */
function shortFileName(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? fullPath;
}

// ---------------------------------------------------------------------------
// Hook: 从 messages 中提取 artifact 文件列表
// ---------------------------------------------------------------------------

export function useArtifactFiles(messages: readonly ConversationSurfaceMessage[]): ArtifactFile[] {
  return useMemo(() => {
    const files: ArtifactFile[] = [];
    const seen = new Set<string>();

    // 从最近的消息中提取 Write/Edit 工具调用
    const recentMessages = messages.slice(-10);
    for (const msg of recentMessages) {
      const toolCalls = (msg as unknown as { toolCalls?: Array<{
        id?: string;
        toolName: string;
        status?: string;
        input?: Record<string, unknown>;
        _streamingInput?: string;
      }> }).toolCalls;
      if (!toolCalls?.length) continue;

      for (const tc of toolCalls) {
        if (!WRITE_TOOL_NAMES.has(tc.toolName)) continue;

        // Bug 2 fix: For jingwei writes, dedup by title+category (not toolCallId)
        // so that updating the same entry replaces the previous artifact
        let dedupKey = tc.id ?? "";
        if (tc.toolName.includes("jingwei") && tc.input) {
          const inp = tc.input as Record<string, unknown>;
          if (inp.title) {
            dedupKey = `jingwei/${normalizeCategory(inp.category)}/${inp.title}`;
          }
        }

        if (!tc.id || seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const isStreaming = tc.status === "running";

        // 优先从 _streamingInput 解析（流式阶段）
        if (isStreaming && tc._streamingInput) {
          const parsed = parsePartialWriteInput(tc._streamingInput, tc.toolName);
          if (parsed && parsed.filePath) {
            files.push({
              toolCallId: tc.id,
              filePath: parsed.filePath,
              content: parsed.content,
              streaming: true,
              toolName: tc.toolName,
            });
            continue;
          }
        }

        // 从 input 解析（完成后）
        if (tc.input && typeof tc.input === "object") {
          const input = tc.input as Record<string, unknown>;
          const filePath = (input.file_path as string) ?? "";
          const content = (input.content as string) ?? (input.new_string as string) ?? (input.contentMd as string) ?? "";
          const chapterNumber = Number.isFinite(Number(input.chapterNumber)) ? Number(input.chapterNumber) : 0;
          const derivedPath = filePath
            || (tc.toolName === "pipeline.write" && (input.title || chapterNumber > 0)
              ? `chapters/${chapterNumber > 0 ? String(chapterNumber).padStart(4, "0") : "chapter"}_${input.title ?? `第${chapterNumber}章`}.md`
              : "")
            || (input.title ? `jingwei/${normalizeCategory(input.category)}/${input.title}.md` : "");
          if (derivedPath) {
            files.push({
              toolCallId: tc.id,
              filePath: derivedPath,
              content,
              streaming: isStreaming,
              toolName: tc.toolName,
            });
          }
        }
      }
    }

    return files;
  }, [messages]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// #10: 内联 style 提取为组件外常量，避免每次渲染重注入
const BLINK_STYLE = `
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
  .animate-blink {
    animation: blink 1s step-end infinite;
  }
`;

export function ArtifactPanel({ messages, onClose }: ArtifactPanelProps) {
  const files = useArtifactFiles(messages);
  const [activeTab, setActiveTab] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const userSelectedTabRef = useRef(false);

  // #12: files 变化时 clamp activeTab 防止越界，并在 files 清空后重置用户选择标记
  useEffect(() => {
    setActiveTab((prev) => {
      if (files.length === 0) {
        userSelectedTabRef.current = false;
        return 0;
      }
      return Math.min(prev, files.length - 1);
    });
  }, [files.length]);

  // #5: 新文件出现时自动切换到最新 tab（仅用户未手动选择时）
  useEffect(() => {
    if (files.length > 0 && !userSelectedTabRef.current) {
      setActiveTab(files.length - 1);
    }
  }, [files.length]);

  // 流式内容时自动滚动到底部
  const activeFile = files[activeTab];
  useEffect(() => {
    if (activeFile?.streaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [activeFile?.content, activeFile?.streaming]);

  if (files.length === 0) return null;

  const currentFile = files[activeTab] ?? files[files.length - 1];
  if (!currentFile) return null;

  // #11: 流式场景下延迟更新 Markdown 渲染，避免输入卡顿
  const deferredContent = useDeferredValue(currentFile.content);

  return (
    <div className="flex w-[400px] shrink-0 flex-col border-l border-border bg-background overflow-hidden animate-in slide-in-from-right-4 duration-300">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {currentFile.streaming ? (
            <Sparkles className="size-3.5 text-blue-500 animate-pulse shrink-0" />
          ) : (
            <FileText className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs font-medium truncate" title={currentFile.filePath}>
            {shortFileName(currentFile.filePath)}
          </span>
          {currentFile.streaming && (
            <span className="text-[10px] text-blue-500 font-medium animate-pulse">生成中</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 hover:bg-muted transition-colors"
          title="关闭面板"
        >
          <X className="size-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* 内容区 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 min-h-0">
        {currentFile.content ? (
          <div className="text-sm">
            <MarkdownRenderer content={deferredContent} />
            {currentFile.streaming && (
              <span className="inline-block w-[2px] h-[1em] bg-blue-500 ml-0.5 align-middle animate-blink" />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <Sparkles className="size-4 mr-2 animate-pulse text-blue-500" />
            等待内容生成...
          </div>
        )}
      </div>

      {/* 多文件 Tab 栏 */}
      {files.length > 1 && (
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 overflow-x-auto bg-muted/20">
          {files.map((file, index) => (
            <button
              key={file.toolCallId}
              onClick={() => { userSelectedTabRef.current = true; setActiveTab(index); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                index === activeTab
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {file.streaming && <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />}
              {shortFileName(file.filePath)}
            </button>
          ))}
        </div>
      )}

      {/* 光标闪烁动画 CSS — 常量提取到组件外避免重注入 */}
      <style>{BLINK_STYLE}</style>
    </div>
  );
}
