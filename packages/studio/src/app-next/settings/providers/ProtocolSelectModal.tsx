import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RuntimeCustomApiProtocol } from "../../runtime-admin/settings";

export type ProviderProtocolChoice = RuntimeCustomApiProtocol | "nug";

type ProtocolOption = {
  readonly value: ProviderProtocolChoice;
  readonly label: string;
  readonly description: string;
  readonly badge: string;
};

const PROTOCOLS: readonly ProtocolOption[] = [
  {
    value: "anthropic-official",
    label: "Anthropic 官方",
    description: "连接 Anthropic Messages 官方接口。",
    badge: "Anthropic",
  },
  {
    value: "anthropic-compatible",
    label: "Anthropic 兼容",
    description: "连接支持 Anthropic Messages 格式的兼容服务。",
    badge: "兼容 API",
  },
  {
    value: "gemini-compatible",
    label: "Gemini 兼容",
    description: "连接 Google Gemini Generate Content 或 Interactions 协议服务。",
    badge: "Gemini",
  },
  {
    value: "responses-compatible",
    label: "Responses 兼容",
    description: "连接支持 OpenAI Responses API 的服务。",
    badge: "OpenAI",
  },
  {
    value: "completions-compatible",
    label: "Chat Completions 兼容",
    description: "连接兼容 OpenAI Chat Completions 的服务。",
    badge: "OpenAI",
  },
  {
    value: "codex-native",
    label: "Codex Native",
    description: "使用 Codex Responses 能力和可选的 WebSocket。",
    badge: "Codex",
  },
  {
    value: "nug",
    label: "NUG 反代服务",
    description: "连接 NUG 统一网关，使用其远端模型通道。",
    badge: "反代",
  },
];

export function ProtocolSelectModal({
  open,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (protocol: ProviderProtocolChoice) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择供应商类型</DialogTitle>
          <DialogDescription>选择连接协议或 NUG 反代服务，之后在详情页填写配置。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2 sm:grid-cols-2">
          {PROTOCOLS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="text-left"
              onClick={() => onSelect(option.value)}
            >
              <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
                <CardHeader className="gap-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span>{option.label}</span>
                    <Badge variant="outline">{option.badge}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {option.description}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
