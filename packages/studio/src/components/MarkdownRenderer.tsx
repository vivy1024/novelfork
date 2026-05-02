import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

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
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return <code className="px-1.5 py-0.5 rounded bg-secondary text-sm font-mono">{children}</code>;
  }

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="font-mono">{lang || "code"}</span>
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-secondary transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      {!collapsed && (
        <SyntaxHighlighter
          language={lang || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "0.875rem",
            lineHeight: "1.5",
          }}
        >
          {code}
        </SyntaxHighlighter>
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
