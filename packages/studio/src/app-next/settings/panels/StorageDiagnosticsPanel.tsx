import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson, postApi } from "@/hooks/use-api";
import { notify } from "@/lib/notify";
import { Database, FolderOpen, Trash2, HardDrive } from "lucide-react";

interface StorageInfo {
  databases: Array<{ name: string; path: string; sizeBytes: number }>;
  directories: Array<{ name: string; path: string; sizeBytes: number; fileCount: number }>;
  totalBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function StorageDiagnosticsPanel() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [vacuuming, setVacuuming] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const loadDiagnostics = () => {
    setLoading(true);
    fetchJson<StorageInfo>("/storage/diagnostics")
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const handleVacuum = async () => {
    setVacuuming(true);
    try {
      await postApi<{ success: boolean }>("/storage/vacuum");
      notify.success("VACUUM 完成", { description: "数据库已压缩优化" });
      loadDiagnostics();
    } catch (error) {
      notify.error("VACUUM 失败", { description: (error as Error).message });
    } finally {
      setVacuuming(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await postApi<{ success: boolean; deletedSessions: number }>("/storage/cleanup");
      notify.success("清理完成", { description: `已删除 ${result.deletedSessions} 条过期会话` });
      loadDiagnostics();
    } catch (error) {
      notify.error("清理失败", { description: (error as Error).message });
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">存储诊断</h2>
        <p className="text-sm text-muted-foreground">
          查看数据库与本地存储占用，执行维护操作
        </p>
      </div>

      {loading && <p className="text-muted-foreground">加载中...</p>}

      {info && (
        <>
          {/* 总占用 */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <HardDrive className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">总占用</h3>
                <p className="text-sm text-muted-foreground font-mono">{formatBytes(info.totalBytes)}</p>
              </div>
            </div>
          </div>

          {/* 数据库 */}
          {info.databases.length > 0 && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Database className="w-5 h-5 text-purple-500" />
                </div>
                <h3 className="font-semibold text-foreground">数据库文件</h3>
              </div>
              {info.databases.map((db) => (
                <div key={db.path} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <div>
                    <span className="text-sm text-foreground">{db.name}</span>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">{db.path}</p>
                  </div>
                  <span className="text-sm font-mono text-foreground">{formatBytes(db.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}

          {/* 目录 */}
          {info.directories.length > 0 && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <FolderOpen className="w-5 h-5 text-green-500" />
                </div>
                <h3 className="font-semibold text-foreground">存储目录</h3>
              </div>
              {info.directories.map((dir) => (
                <div key={dir.path} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <div>
                    <span className="text-sm text-foreground">{dir.name}</span>
                    <p className="text-xs text-muted-foreground">
                      {dir.fileCount} 个文件
                    </p>
                  </div>
                  <span className="text-sm font-mono text-foreground">{formatBytes(dir.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Trash2 className="w-5 h-5 text-orange-500" />
              </div>
              <h3 className="font-semibold text-foreground">维护操作</h3>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <Button
                  variant="outline"
                  onClick={handleCleanup}
                  disabled={cleaning}
                >
                  {cleaning ? "清理中..." : "清理过期数据"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">
                  删除 30 天前的旧会话记录（保留最近 50 条）
                </p>
              </div>

              <div>
                <Button
                  variant="outline"
                  onClick={handleVacuum}
                  disabled={vacuuming}
                >
                  {vacuuming ? "压缩中..." : "VACUUM 数据库"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">
                  压缩 SQLite 数据库文件，回收已删除数据占用的空间
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !info && (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">无法获取存储诊断信息</p>
        </div>
      )}
    </div>
  );
}
