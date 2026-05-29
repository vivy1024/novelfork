/**
 * CompactProgressIndicator — 上下文压缩进度指示器
 *
 * 当收到 session:compact-progress 事件时显示。
 * 简单文本 + 百分比进度条。
 */

interface Props {
  progress: number;
}

export function CompactProgressIndicator({ progress }: Props) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50/50 dark:border-orange-800/50 dark:bg-orange-950/20 px-3 py-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs text-orange-700 dark:text-orange-300 whitespace-nowrap">
          正在压缩上下文... {Math.round(progress)}%
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-orange-200/50 dark:bg-orange-800/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
