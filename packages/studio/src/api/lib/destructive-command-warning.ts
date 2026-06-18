/**
 * Destructive Command Warning — generates human-readable risk descriptions
 * for dangerous bash commands. Shown in permission dialogs.
 */

interface DestructiveWarning {
  command: string;
  warning: string;
  severity: "high" | "critical";
}

const DESTRUCTIVE_PATTERNS: Array<{ regex: RegExp; warning: string; severity: "high" | "critical" }> = [
  { regex: /\brm\s+(-[a-z]*r|-[a-z]*f|--recursive|--force)/i, warning: "可能递归删除文件，无法恢复", severity: "critical" },
  { regex: /\bgit\s+push\s+.*--force/i, warning: "强制推送会覆盖远程历史，可能丢失团队成员的提交", severity: "critical" },
  { regex: /\bgit\s+reset\s+--hard/i, warning: "会丢弃所有未提交的修改，无法恢复", severity: "high" },
  { regex: /\bgit\s+clean\s+-[a-z]*f/i, warning: "会删除所有未跟踪的文件", severity: "high" },
  { regex: /\bgit\s+checkout\s+--\s/i, warning: "会丢弃指定文件的未提交修改", severity: "high" },
  { regex: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)/i, warning: "会永久删除数据库表或整个数据库", severity: "critical" },
  { regex: /\bDELETE\s+FROM\b/i, warning: "会删除数据库记录", severity: "high" },
  { regex: /\bnpm\s+publish\b/i, warning: "会将包发布到公共 npm registry", severity: "high" },
  { regex: /\bchmod\s+777\b/i, warning: "会将文件设为完全公开可读写执行", severity: "high" },
  { regex: /\bcurl\s+.*\|\s*(bash|sh)\b/i, warning: "从网络下载并直接执行脚本，可能包含恶意代码", severity: "critical" },
  { regex: /\bsudo\s+rm\b/i, warning: "以管理员权限删除文件，影响范围更大", severity: "critical" },
  { regex: /\bformat\s+[a-z]:/i, warning: "会格式化整个磁盘分区", severity: "critical" },
  { regex: /\bdd\s+if=.*of=\/dev\//i, warning: "会直接写入磁盘设备，可能破坏整个分区", severity: "critical" },
  { regex: /\bshutdown\b|\breboot\b/i, warning: "会关闭或重启系统", severity: "high" },
];

/**
 * Check a command and return a human-readable warning if it's destructive.
 * Returns null if the command appears safe.
 */
export function getDestructiveWarning(command: string): DestructiveWarning | null {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.regex.test(command)) {
      return { command, warning: pattern.warning, severity: pattern.severity };
    }
  }
  return null;
}

/**
 * Format a warning for display in a permission dialog.
 */
export function formatDestructiveWarning(warning: DestructiveWarning): string {
  const icon = warning.severity === "critical" ? "⛔" : "⚠️";
  return `${icon} 风险提示: ${warning.warning}`;
}
