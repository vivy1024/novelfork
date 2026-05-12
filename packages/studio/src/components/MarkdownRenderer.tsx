import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useState, useEffect, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { createHighlighter, type Highlighter } from "shiki";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// Shiki highlighter singleton — 避免每个 CodeBlock 重复初始化 WASM
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: ["text", "javascript", "typescript", "python", "json", "bash", "html", "css"],
    });
  }
  return highlighterPromise;
}

async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const normalizedLang = lang || "text";

  // 动态加载未预加载的语言
  if (!loadedLangs.has(normalizedLang)) {
    try {
      await highlighter.loadLanguage(normalizedLang as Parameters<Highlighter["loadLanguage"]>[0]);
      loadedLangs.add(normalizedLang);
    } catch {
      // 语言不支持，回退到 text
      return highlighter.codeToHtml(code, { lang: "text", theme: "github-dark" });
    }
  }

  return highlighter.codeToHtml(code, { lang: normalizedLang, theme: "github-dark" });
}

// KaTeX stylesheet is loaded lazily on first render so it does not bloat the
// initial bundle for users who never receive a math expression.
let katexCssPromise: Promise<unknown> | null = null;
function ensureKatexCss() {
  if (!katexCssPromise && typeof document !== "undefined") {
    // Side-effect import; ignore TS asset module resolution since Vite handles it.
    katexCssPromise = (import(/* @vite-ignore */ "katex/dist/katex.min.css" as string) as Promise<unknown>).catch(() => undefined);
  }
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");

  useEffect(() => {
    if (inline) return;
    let cancelled = false;
    highlightCode(code, lang)
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml(null);
      });
    return () => { cancelled = true; };
  }, [code, lang, inline]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">{children}</code>;
  }

  return (
    <div className="code-block group/code relative my-2 rounded overflow-hidden">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-800/80 hover:bg-gray-700/80 rounded"
      >
        {copied ? "已复制" : "复制"}
      </button>
      {highlightedHtml ? (
        <div
          className="shiki-code-block [&_pre]:!m-0 [&_pre]:!rounded [&_pre]:!text-[11px] [&_pre]:!leading-relaxed [&_pre]:!p-2.5"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="m-0 rounded bg-[#1f1f1f] p-2.5 text-[11px] leading-relaxed text-gray-200 overflow-x-auto whitespace-pre-wrap">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  useEffect(() => {
    ensureKatexCss();
  }, []);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code: CodeBlock,
          p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1">{children}</ol>,
          h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-bold mb-2 mt-3">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/30 pl-4 italic my-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          // GFM extensions
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-secondary/40">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5 align-top">{children}</td>
          ),
          del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
          input: ({ type, checked, disabled, ...rest }) => {
            if (type === "checkbox") {
              // GFM task list checkbox — render read-only visual checkbox.
              return (
                <input
                  type="checkbox"
                  checked={!!checked}
                  disabled={disabled ?? true}
                  readOnly
                  className="mr-2 align-middle accent-primary"
                  {...rest}
                />
              );
            }
            return <input type={type} {...rest} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
