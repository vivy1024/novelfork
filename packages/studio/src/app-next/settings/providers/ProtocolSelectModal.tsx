import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { ProviderProtocol } from "@/shared/provider-catalog";
import { providerProtocolLabel, providerProtocolDescription, providerProtocolBadgeColor } from "../../lib/display-labels";

const PROTOCOLS: ProviderProtocol[] = ["anthropic", "completions", "responses", "codex", "claude-code"];

export function ProtocolSelectModal({
  open,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (protocol: ProviderProtocol) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>选择协议类型</DialogTitle>
          <DialogDescription>每种协议对应不同的 API 格式和认证方式，选择后可在详情页修改。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {PROTOCOLS.map((protocol) => (
            <button
              key={protocol}
              type="button"
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
              onClick={() => onSelect(protocol)}
            >
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${providerProtocolBadgeColor(protocol)}`}>
                {providerProtocolLabel(protocol)}
              </span>
              <span className="text-sm text-muted-foreground">{providerProtocolDescription(protocol)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
