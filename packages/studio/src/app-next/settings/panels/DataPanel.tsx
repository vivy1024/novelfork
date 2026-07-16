import { useState } from "react";
import { AlertTriangle, Download, FileJson, ShieldX, Upload } from "lucide-react";

import { createSettingsClient, type RuntimeSettings } from "@/app-next/runtime-admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/lib/notify";

const settingsClient = createSettingsClient();
const REDACTED = "[已脱敏]";
const SECRET_KEY_PATTERN = /(secret|token|password|passphrase|api[-_]?key|authorization|cookie|private[-_]?key|client[-_]?secret|credential)/i;
const SECRET_CONTAINER_PATTERN = /^(env|headers)$/i;
const MASKED_VALUE_PATTERN = /^(?:\*{3,}|•{3,}|<masked>|\[masked\]|<redacted>|\[redacted\])(?:.{0,8})?$/i;

function redactContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(() => REDACTED);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((key) => [key, REDACTED]));
  }
  return REDACTED;
}

export function redactRuntimeSettingsForExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntimeSettingsForExport);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (SECRET_KEY_PATTERN.test(key)) return [key, REDACTED];
      if (SECRET_CONTAINER_PATTERN.test(key)) return [key, redactContainer(nested)];
      return [key, redactRuntimeSettingsForExport(nested)];
    }));
  }
  if (typeof value === "string" && MASKED_VALUE_PATTERN.test(value.trim())) return REDACTED;
  return value;
}

function errorMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 403) return `403：导出特权设置需要 Runtime 管理员权限。${message}`;
  return status ? `${status}：${message}` : message;
}

function downloadSettings(settings: RuntimeSettings) {
  const exported = {
    format: "novelfork-runtime-settings-export",
    exportedAt: new Date().toISOString(),
    warning: "这是特权 Runtime 配置导出。浏览器已对疑似密钥字段、MCP 环境变量值和 MCP 请求头值进行脱敏。",
    settings: redactRuntimeSettingsForExport(settings),
  };
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `novelfork-runtime-settings-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DataPanel() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const settings = await settingsClient.get();
      downloadSettings(settings);
      notify.success("Runtime 设置已导出", { description: "浏览器在创建下载文件前已对疑似密钥值进行脱敏。" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify.error("导出失败", { description: message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">数据管理</h2>
        <p className="mt-1 text-sm text-muted-foreground">导出已脱敏的 Runtime 设置快照，不再重放旧版完整配置写入。</p>
      </div>

      {error && (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTitle>Runtime 设置导出失败</AlertTitle>
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      <Alert className="border-destructive/30 bg-destructive/5">
        <AlertTriangle className="mb-2 size-4 text-destructive" />
        <AlertTitle>特权配置</AlertTitle>
        <AlertDescription>
          Runtime 设置响应包含运维配置，可能包括 MCP 环境变量、MCP 请求头、提供商凭据、Token 和其他已掩码字段。NovelFork 会在浏览器创建下载文件前，对疑似密钥字段以及 <code>env</code> 和 <code>headers</code> 下的所有值进行脱敏，但导出文件仍应按敏感数据妥善保管。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="size-4 text-primary" />导出 Runtime 设置</CardTitle>
          <CardDescription>通过 Runtime 原生设置客户端读取 <code>/api/settings</code>，并下载已脱敏的 JSON 快照。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <FileJson className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <div className="font-medium text-foreground">导出内容</div>
              <p className="mt-1 text-xs text-muted-foreground">包含服务器、路径、Agent、提供商、MCP、搜索、例程、更新、共享及服务端当前返回的其他 Runtime 设置，也可能包含动态元数据。</p>
            </div>
          </div>
          <Button onClick={() => void handleExport()} disabled={exporting}>
            <Download className={exporting ? "animate-pulse" : ""} />
            {exporting ? "导出中…" : "导出已脱敏设置"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="size-4 text-muted-foreground" />此处暂不支持导入</CardTitle>
          <CardDescription>NovelFork 不会在此上传或替换完整的 Runtime 设置文档。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <ShieldX className="mt-0.5 size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">安全的导入器必须验证带版本的导出格式，只对 Runtime 白名单执行 PATCH，并明确处理已掩码密钥。在该契约建立前，导入旧版用户配置可能覆盖特权设置或较新的设置，因此此功能暂不可用。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
