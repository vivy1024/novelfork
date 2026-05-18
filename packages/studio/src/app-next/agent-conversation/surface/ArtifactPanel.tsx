/**
 * ArtifactPanel — 生成式浮现面板
 *
 * Agent 调用 Write/Edit 工具时，右侧自动浮现并排面板，
 * 实时流式展示正在生成的文件内容。类似 Claude Artifacts 体验。
 */

import { useMemo, useState, useEffect, useRef } from "react";
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

const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "jingwei.upsert_entry", "jingwei_upsert_entry", "candidate.create_chapter", "candidate_create_chapter"]);

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
      const category = parsed.category ?? "unknown";
      return { filePath: `jingwei/${category}/${parsed.title}.md`, content: parsed.contentMd };
    }
    // candidate.create_chapter 格式
    if (typeof parsed.content === "string" && (parsed.title || parsed.chapterNumber || toolName.includes("candidate"))) {
      const title = parsed.title ?? (parsed.chapterNumber ? `第${parsed.chapterNumber}章候选稿` : "章节候选稿");
      return { filePath: `candidates/${title}.md`, content: parsed.content };
    }
  } catch {
    // 部分 JSON — 用正则提取
  }

  // candidate.create_chapter 的部分 JSON 解析
  if (toolName.includes("candidate")) {
    const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
    const chapterMatch = partialJson.match(/"chapterNumber"\s*:\s*(\d+)/);
    const contentMatch = partialJson.match(/"content"\s*:\s*"([\s\S]*)$/);
    const title = titleMatch?.[1] ?? (chapterMatch?.[1] ? `第${chapterMatch[1]}章候选稿` : "章节候选稿");
    if (contentMatch) {
      let raw = contentMatch[1].replace(/["\s}]*$/, "");
      try {
        return { filePath: `candidates/${title}.md`, content: JSON.parse(`"${raw}"`) };
      } catch {
        return { filePath: `candidates/${title}.md`, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
      }
    }
    return { filePath: `candidates/${title}.md`, content: "" };
  }

  // jingwei.upsert_entry 的部分 JSON 解析
  if (toolName.includes("jingwei") || toolName.includes("upsert")) {
    const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
    const categoryMatch = partialJson.match(/"category"\s*:\s*"([^"]+)"/);
    const contentMdMatch = partialJson.match(/"contentMd"\s*:\s*"([\s\S]*)$/);
    const title = titleMatch?.[1] ?? "";
    const category = categoryMatch?.[1] ?? "unknown";
    const filePath = title ? `jingwei/${category}/${title}.md` : "";

    if (contentMdMatch) {
      let raw = contentMdMatch[1].replace(/["\s}]*$/, "");
      try {
        return { filePath, content: JSON.parse(`"${raw}"`) };
      } catch {
        return { filePath, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
      }
    }
    if (filePath) {
      return { filePath, content: "" };
    }
  }

  // 正则提取 file_path
  const pathMatch = partialJson.match(/"file_path"\s*:\s*"([^"]+)"/);
  const filePath = pathMatch?.[1] ?? "";

  // 正则提取 content（贪婪匹配到最后）
  const contentMatch = partialJson.match(/"content"\s*:\s*"([\s\S]*)$/);
  if (contentMatch) {
    // 尝试 unescape JSON 字符串（部分的）
    let raw = contentMatch[1];
    // 移除末尾未闭合的引号/括号
    raw = raw.replace(/["\s}]*$/, "");
    try {
      return { filePath, content: JSON.parse(`"${raw}"`) };
    } catch {
      // 简单 unescape
      return { filePath, content: raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"') };
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
        if (!tc.id || seen.has(tc.id)) continue;
        seen.add(tc.id);

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
          const derivedPath = filePath
            || (tc.toolName.includes("candidate") && (input.title || input.chapterNumber)
              ? `candidates/${input.title ?? `第${input.chapterNumber}章候选稿`}.md`
              : "")
            || (input.title ? `jingwei/${input.category ?? "unknown"}/${input.title}.md` : "");
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

export function ArtifactPanel({ messages, onClose }: ArtifactPanelProps) {
  const files = useArtifactFiles(messages);
  const [activeTab, setActiveTab] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  // 新文件出现时自动切换到最新 tab
  useEffect(() => {
    if (files.length > 0) {
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
            <MarkdownRenderer content={currentFile.content} />
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
              onClick={() => setActiveTab(index)}
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

      {/* 光标闪烁动画 CSS */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .animate-blink {
          animation: blink 1s step-end infinite;
        }
      `}</style>
    </div>
  );
}
