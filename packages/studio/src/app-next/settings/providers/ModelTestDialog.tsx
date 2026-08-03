import { useState } from "react";
import { Copy, AlertTriangle, CheckCircle2, RefreshCw, XCircle, ChevronDown, ChevronUp } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface ModelTestErrorDetails {
  message: string;
  name?: string;
  code?: string;
  errno?: string | number;
  status?: number;
  reason?: string;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
  path?: string;
  category?: "tls" | "dns" | "tcp" | "timeout" | "auth" | "http_status" | "rate_limit" | "network_other" | "parse_error" | "aborted" | "unknown";
  cause?: ModelTestErrorDetails;
}

export interface ModelTestRequestAttempt {
  sequence: number;
  method: string;
  url: string;
  verbose?: boolean;
  outcome?: "success" | "http_error" | "network_error" | "timeout" | "aborted";
  status?: number;
  durationMs?: number;
  route?: string;
  requestBodyBytes?: number;
  responseHeaders?: Record<string, string>;
  category?: ModelTestErrorDetails["category"];
  proxyUrl?: string;
  error?: ModelTestErrorDetails;
}

export interface ModelTestDiagnostics {
  id: string;
  timestamp: string;
  model: string;
  requests: ModelTestRequestAttempt[];
  error?: ModelTestErrorDetails;
}

export interface ModelTestDialogProps {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly modelValue: string;
  readonly selectedModelValue?: string;
  readonly sourceError?: string;
  readonly onRunTest: (model: string, prompt: string) => Promise<unknown>;
}

const DEFAULT_PROMPT = "Please introduce yourself in one sentence. / 请用一句话介绍你自己。";

function formatBytes(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(cat?: ModelTestErrorDetails["category"]): string {
  switch (cat) {
    case "tls": return "TLS 证书错误";
    case "dns": return "DNS 域名解析错误";
    case "tcp": return "TCP 连接被拒或网络无法到达";
    case "timeout": return "请求连接超时";
    case "auth": return "认证失败 (API Key / Token 错误)";
    case "http_status": return "HTTP 错误响应";
    case "rate_limit": return "达到速率限制 (Rate Limit)";
    case "parse_error": return "响应 JSON 解析失败";
    default: return cat ? `网络错误 (${cat})` : "未知错误";
  }
}

export function ModelTestDialog({
  opened,
  onClose,
  modelValue,
  selectedModelValue,
  sourceError,
  onRunTest,
}: ModelTestDialogProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [testing, setTesting] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ModelTestDiagnostics | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedDisplayModel = selectedModelValue ?? modelValue;

  const handleExecute = async () => {
    if (testing || !modelValue) return;
    setTesting(true);
    setTestError(null);
    setResultText(null);
    setDiagnostics(null);

    try {
      const res: any = await onRunTest(modelValue, prompt);
      if (typeof res === "string") {
        setResultText(res);
      } else if (res && typeof res === "object") {
        if (res.result) setResultText(String(res.result));
        else if (res.response) setResultText(String(res.response));
        else if (res.message) setResultText(String(res.message));
        else setResultText(JSON.stringify(res, null, 2));

        if (res.diagnostics && typeof res.diagnostics === "object") {
          setDiagnostics(res.diagnostics as ModelTestDiagnostics);
        }
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestError(msg);
      if (err.data?.diagnostics) {
        setDiagnostics(err.data.diagnostics as ModelTestDiagnostics);
      }
    } finally {
      setTesting(false);
    }
  };

  const handleCopyDiagnostics = () => {
    const reportData = {
      model: modelValue,
      selectedModel: selectedDisplayModel,
      sourceError,
      error: testError,
      result: resultText,
      diagnostics,
    };
    void navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={opened} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            测试模型连接：<span className="font-mono text-sm font-semibold">{selectedDisplayModel}</span>
          </DialogTitle>
          <DialogDescription>
            直接发起底层模型探针测试，检查 DNS/TLS、网关代理、HTTP 状态码及请求耗时。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {sourceError ? (
            <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              <AlertTitle>前置探测警告</AlertTitle>
              <AlertDescription className="text-xs">{sourceError}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="model-test-prompt-input">测试 Prompt 指示</FieldLabel>
            <Input
              id="model-test-prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请输入测试提示词..."
              disabled={testing}
            />
            <FieldDescription>发往模型的简单探测文本。</FieldDescription>
          </Field>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleExecute} disabled={testing || !modelValue}>
              <RefreshCw className={`size-3.5 mr-1.5 ${testing ? "animate-spin" : ""}`} />
              {testing ? "测试探针中..." : "开始测试连接"}
            </Button>
          </div>

          {/* 测试结果 / 响应数据 */}
          {resultText ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> 模型测试成功
                </span>
                <Button variant="ghost" size="xs" onClick={handleCopyDiagnostics}>
                  <Copy className="size-3 mr-1" /> {copied ? "已复制诊断" : "复制诊断报告"}
                </Button>
              </div>
              <Textarea
                readOnly
                value={resultText}
                className="min-h-24 font-mono text-xs bg-background/50 border-border"
              />
            </div>
          ) : null}

          {/* 测试失败提示 */}
          {testError ? (
            <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
              <XCircle className="size-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <AlertTitle className="flex items-center justify-between">
                  <span>模型测试失败</span>
                  <Button variant="ghost" size="xs" onClick={handleCopyDiagnostics} className="h-6 text-xs">
                    <Copy className="size-3 mr-1" /> {copied ? "已复制诊断" : "复制诊断"}
                  </Button>
                </AlertTitle>
                <AlertDescription className="mt-1 text-xs break-all font-mono">
                  {testError}
                </AlertDescription>
              </div>
            </Alert>
          ) : null}

          {/* 详细 Diagnostics 抓包/分析尝试 */}
          {diagnostics ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">请求与网络抓包明细 ({diagnostics.requests.length} 次尝试)</span>
                {diagnostics.error?.category ? (
                  <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                    {categoryLabel(diagnostics.error.category)}
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-2">
                {diagnostics.requests.map((req, idx) => (
                  <div key={idx} className="rounded border border-border/80 bg-background/50 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px]">{req.method}</Badge>
                        <span className="font-mono text-[11px] font-medium truncate max-w-[320px]" title={req.url}>
                          {req.url}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {req.status ? (
                          <Badge variant={req.status >= 400 ? "destructive" : "outline"} className="text-[9px]">
                            HTTP {req.status}
                          </Badge>
                        ) : null}
                        {req.durationMs ? <span className="text-muted-foreground">{req.durationMs}ms</span> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                      {req.route ? <span>路由: {req.route}</span> : null}
                      {req.requestBodyBytes ? <span>包体大小: {formatBytes(req.requestBodyBytes)}</span> : null}
                      {req.proxyUrl ? <span className="truncate max-w-[200px]" title={req.proxyUrl}>代理: {req.proxyUrl}</span> : null}
                    </div>

                    {req.error?.message ? (
                      <p className="text-[10px] font-mono text-destructive bg-destructive/10 p-1.5 rounded">
                        {req.error.message}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowRawJson(!showRawJson)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground pt-1"
              >
                {showRawJson ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {showRawJson ? "隐藏 JSON 原始数据" : "查看 JSON 原始数据"}
              </button>

              {showRawJson ? (
                <Textarea
                  readOnly
                  value={JSON.stringify(diagnostics, null, 2)}
                  className="min-h-32 font-mono text-[10px] bg-muted/40"
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
