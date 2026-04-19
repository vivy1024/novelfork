import { useState } from "react";
import { useColors } from "../../hooks/use-colors";
import type { Theme } from "../../hooks/use-theme";
import { fetchJson } from "../../hooks/use-api";
import { Download, Upload, FileJson } from "lucide-react";

interface Props {
  theme: Theme;
}

export function DataPanel({ theme }: Props) {
  const c = useColors(theme);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const config = await fetchJson("/settings/user");
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `novelfork-config-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("导出失败：" + (error as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        const text = await file.text();
        const config = JSON.parse(text);

        // 验证配置格式
        if (!config.profile || !config.preferences) {
          throw new Error("配置文件格式不正确");
        }

        // 导入配置
        await fetch("/settings/user", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });

        alert("导入成功！页面将刷新以应用新配置。");
        window.location.reload();
      } catch (error) {
        alert("导入失败：" + (error as Error).message);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">数据管理</h2>
        <p className="text-sm text-muted-foreground">
          导出和导入您的配置数据
        </p>
      </div>

      <div className={c.cardStatic + " space-y-6"}>
        {/* 导出配置 */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Download className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">导出配置</h3>
              <p className="text-xs text-muted-foreground">
                将您的所有设置导出为 JSON 文件
              </p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className={c.btnPrimary}
          >
            {exporting ? "导出中..." : "导出配置"}
          </button>
        </div>

        {/* 导入配置 */}
        <div className="pt-6 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Upload className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">导入配置</h3>
              <p className="text-xs text-muted-foreground">
                从 JSON 文件恢复您的设置
              </p>
            </div>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className={c.btnSecondary}
          >
            {importing ? "导入中..." : "导入配置"}
          </button>
          <p className="text-xs text-muted-foreground mt-2">
            ⚠️ 导入将覆盖当前所有设置，请谨慎操作
          </p>
        </div>

        {/* 配置文件位置 */}
        <div className="pt-6 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <FileJson className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">配置文件位置</h3>
              <p className="text-xs text-muted-foreground">
                配置存储在本地文件系统
              </p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">用户配置：</span>
              <code className="ml-2 px-2 py-1 rounded bg-secondary text-foreground font-mono text-xs">
                ~/.novelfork/user-config.json
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">备份文件：</span>
              <code className="ml-2 px-2 py-1 rounded bg-secondary text-foreground font-mono text-xs">
                ~/.novelfork/user-config.backup*.json
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
;
}
