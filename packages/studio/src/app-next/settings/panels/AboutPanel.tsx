import { ExternalLink, Info, Package, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STUDIO_CHANGELOG_URL, STUDIO_PACKAGE_VERSION } from "@/shared/release-manifest";

export function AboutPanel() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">关于</h2>
        <p className="mt-1 text-sm text-muted-foreground">查看 NovelFork 的版本信息、产品说明和项目链接。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Info className="size-4 text-primary" />NovelFork Studio</CardTitle>
          <CardDescription>面向中文网文创作的 AI 辅助工作台。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <MetadataItem icon={Package} label="Studio 软件包" value={`@vivy1024/novelfork-studio · 版本 ${STUDIO_PACKAGE_VERSION}`} />
          <MetadataItem icon={Info} label="产品定位" value="中文网文创作与 AI 辅助工作台" />
          <MetadataItem icon={Info} label="产品界面" value="NovelFork Studio 设置中心" />
          <MetadataItem icon={Package} label="元数据来源" value="随 Studio 打包的软件包清单" />
        </CardContent>
      </Card>

      <Alert>
        <RefreshCw className="mb-2 size-4 text-muted-foreground" />
        <AlertTitle>更新说明</AlertTitle>
        <AlertDescription>
          NovelFork 当前采用标准桌面二进制 (Windows EXE) 发版模式，暂未开启在线增量热更新服务。如需升级，请前往官方 GitHub Releases 获得最新版发布文件。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>项目链接</CardTitle>
          <CardDescription>公开发布说明与源代码仓库。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <a className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href={STUDIO_CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
            发布说明 <ExternalLink className="size-3.5" />
          </a>
          <a className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="https://github.com/vivy1024/novelfork" target="_blank" rel="noopener noreferrer">
            NovelFork 源代码仓库 <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function MetadataItem({ icon: Icon, label, value }: {
  readonly icon: typeof Info;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 break-words font-mono text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}
