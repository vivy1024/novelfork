import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentRuntimeHardeningPanel() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Agent 运行时加固</h2>
        <p className="text-sm text-muted-foreground">此旧入口不在当前导航中，仅保留真实能力说明。</p>
      </div>
      <Alert>
        <AlertTitle>旧加固字段已停用</AlertTitle>
        <AlertDescription>
          Runtime 当前没有 yoloMode、loopDetectionThreshold、tokenConsumptionWarnRatio 或 maxConsecutiveFailures 设置。
          请在“AI 代理”页面使用真实的权限模式、危险反思、重试与超时字段。
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Runtime 原生替代项</CardTitle>
          <CardDescription>以下能力已合并到 Agent 设置，不会从此面板发起网络请求。</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc pl-5">
            <li>bypassPermissions 权限模式</li>
            <li>dangerReflectionLevel 与 dangerReflectionEnabled</li>
            <li>maxTransientRetries、retryBackoffCeilMs 与 firstTokenTimeoutMs</li>
            <li>customRetryRules</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
