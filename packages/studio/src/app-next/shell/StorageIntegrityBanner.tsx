import { useState } from "react";
import { DatabaseZap, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { RuntimeStorageIntegrityAlert } from "../runtime/product-contract";

export interface StorageIntegrityBannerProps {
  readonly alert: RuntimeStorageIntegrityAlert | null;
  /** 跳到「我的作品」，作者在那里逐本导出档案。 */
  readonly onOpenBooks?: () => void;
}

function alertKey(alert: RuntimeStorageIntegrityAlert): string {
  return `${alert.code}\n${alert.explanation.whatHappened}`;
}

/**
 * 启动完整性告警横幅：产品库损坏时挂在应用顶层。
 *
 * 三段式文案全部来自服务端（bootstrap.storageIntegrity.explanation），这里不按 code 自造。
 * 可以关闭，但关闭只记在本次页面的内存里：刷新后告警仍存在就会再次出现；
 * 轮询拿到的是另一条告警时也会重新出现。
 */
export function StorageIntegrityBanner({ alert, onOpenBooks }: StorageIntegrityBannerProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (!alert) return null;
  const key = alertKey(alert);
  if (dismissedKey === key) return null;
  const { whatHappened, whyItMatters, suggestedAction } = alert.explanation;

  return (
    <Alert
      data-testid="storage-integrity-banner"
      aria-live="assertive"
      className="shrink-0 rounded-none border-x-0 border-t-0 border-destructive/40 bg-destructive/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <DatabaseZap aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-1">
          <AlertTitle className="text-destructive">产品库完整性检查未通过，请先备份</AlertTitle>
          <AlertDescription className="space-y-1 text-foreground">
            <p>
              <span className="font-medium">发生了什么：</span>
              {whatHappened}
            </p>
            <p>
              <span className="font-medium">为什么要看：</span>
              {whyItMatters}
            </p>
            <p>
              <span className="font-medium">建议怎么做：</span>
              {suggestedAction}
            </p>
            <p className="text-muted-foreground">
              导出备份：打开「我的作品」，逐本点「导出档案」，把档案保存到这台电脑以外的位置。
            </p>
          </AlertDescription>
          {onOpenBooks && (
            <div className="pt-1">
              <Button type="button" size="sm" variant="destructive" onClick={onOpenBooks}>
                去「我的作品」导出档案
              </Button>
            </div>
          )}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="暂时关闭产品库告警"
          title="暂时关闭（刷新后告警仍存在会再次出现）"
          onClick={() => setDismissedKey(key)}
        >
          <X />
        </Button>
      </div>
    </Alert>
  );
}
