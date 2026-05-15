import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, ArrowLeft } from "lucide-react";
import { postApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InlineMode = "continuation" | "expansion" | "bridge";

type ExpansionDirection = "sensory" | "action" | "psychology" | "environment" | "dialogue";
type BridgePurpose = "scene-transition" | "time-skip" | "emotional-transition" | "suspense-setup";

interface InlineWriteResponse {
  readonly mode: string;
  readonly writingMode: string;
  readonly content: string;
  readonly promptPreview?: string;
  readonly model?: string;
}

interface ApplyResponse {
  readonly target: string;
  readonly resourceId: string;
  readonly status: string;
}

export interface InlineWritePanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly selectedText?: string;
  readonly onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_OPTIONS: readonly { readonly value: InlineMode; readonly label: string; readonly description: string }[] = [
  { value: "continuation", label: "续写", description: "从选中文本继续向后写" },
  { value: "expansion", label: "扩写", description: "将选中文本扩展为更丰富的内容" },
  { value: "bridge", label: "补写", description: "在两段之间补充过渡内容" },
];

const EXPANSION_DIRECTIONS: readonly { readonly value: ExpansionDirection; readonly label: string }[] = [
  { value: "sensory", label: "感官细节" },
  { value: "action", label: "动作描写" },
  { value: "psychology", label: "心理活动" },
  { value: "environment", label: "环境渲染" },
  { value: "dialogue", label: "对话化" },
];

const BRIDGE_PURPOSES: readonly { readonly value: BridgePurpose; readonly label: string }[] = [
  { value: "scene-transition", label: "场景过渡" },
  { value: "time-skip", label: "时间跳跃" },
  { value: "emotional-transition", label: "情绪转换" },
  { value: "suspense-setup", label: "悬念铺垫" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InlineWritePanel({ bookId, currentChapter, selectedText, onClose }: InlineWritePanelProps) {
  const [mode, setMode] = useState<InlineMode>("continuation");
  const [inputText, setInputText] = useState(selectedText ?? "");
  const [direction, setDirection] = useState("");
  const [expansionDirection, setExpansionDirection] = useState<ExpansionDirection>("sensory");
  const [bridgePurpose, setBridgePurpose] = useState<BridgePurpose>("scene-transition");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  async function handleExecute() {
    if (!inputText.trim()) {
      setError("请输入或选中文本");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setApplied(false);

    try {
      const body: Record<string, unknown> = {
        mode,
        selectedText: inputText.trim(),
        chapterNumber: currentChapter ?? 1,
        beforeText: inputText.trim(),
      };

      if (direction.trim()) {
        body.direction = direction.trim();
      }

      if (mode === "expansion") {
        body.expansionDirection = expansionDirection;
      } else if (mode === "bridge") {
        body.purpose = bridgePurpose;
      }

      const res = await postApi<InlineWriteResponse>(`/books/${bookId}/inline-write`, body);
      setResult(res.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "执行失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    setError(null);

    try {
      await postApi<ApplyResponse>(`/books/${bookId}/writing-modes/apply`, {
        content: result,
        target: "candidate",
        sourceMode: mode,
        chapterNumber: currentChapter ?? 1,
      });
      setApplied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "应用失败");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="inline-write-panel">
      {/* Header */}
      <div className="flex items-center gap-2">
        {onClose && (
          <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
            <ArrowLeft className="size-3.5" />
          </Button>
        )}
        <span className="text-xs font-medium">选段写作</span>
      </div>

      {/* Mode selector */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">写作模式</label>
        <div className="flex gap-1.5 mt-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${
                mode === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              title={opt.description}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input text */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">输入文本</label>
        <Textarea
          className="mt-1 text-xs min-h-[80px] resize-y"
          placeholder="粘贴或输入要处理的文本段落…"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
      </div>

      {/* Mode-specific options */}
      {mode === "expansion" && (
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">扩写方向</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {EXPANSION_DIRECTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setExpansionDirection(d.value)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  expansionDirection === d.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "bridge" && (
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">补写目的</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {BRIDGE_PURPOSES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setBridgePurpose(p.value)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  bridgePurpose === p.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Direction hint (all modes) */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">方向提示（可选）</label>
        <input
          type="text"
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="例如：增加紧张感、转向战斗场景…"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        />
      </div>

      {/* Execute button */}
      <Button
        size="sm"
        className="w-full"
        onClick={() => void handleExecute()}
        disabled={loading || !inputText.trim()}
      >
        {loading ? (
          <>
            <Loader2 className="size-3 animate-spin mr-1.5" />
            生成中…
          </>
        ) : (
          "执行"
        )}
      </Button>

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Result */}
      {result && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-[10px]">
              {MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => void handleApply()}
              disabled={applying || applied}
            >
              {applied ? (
                <>
                  <Check className="size-3 mr-1" />
                  已应用
                </>
              ) : applying ? (
                <>
                  <Loader2 className="size-3 animate-spin mr-1" />
                  应用中…
                </>
              ) : (
                "应用为候选"
              )}
            </Button>
          </div>
          <pre className="text-[11px] text-foreground/90 overflow-x-auto max-h-60 whitespace-pre-wrap leading-relaxed">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
