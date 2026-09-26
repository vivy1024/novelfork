#!/usr/bin/env node
/**
 * 公开边界检查：本仓库是公开仓库，Runtime 源码、本地私有目录与密钥类文件不得进入 Git。
 *
 * 用法：
 *   node scripts/check-public-boundary.mjs                 检查当前 HEAD 跟踪的文件
 *   node scripts/check-public-boundary.mjs --staged        检查暂存区（pre-commit 用）
 *   node scripts/check-public-boundary.mjs --range A..B    检查 A..B 之间每个提交新增或修改的路径
 *
 * 只看 tip 不够：中间提交里加过又删掉的文件，合并后仍留在公开历史里，所以 CI 用 --range。
 * 零依赖，公开 CI 不需要安装工作区也能跑。
 */
import { execFileSync } from "node:child_process";

const RUNTIME_LOCK = "packages/narrafork-runtime-private/UPSTREAM.lock.json";

/** 每条规则：命中即违规；reason 说明为什么不能公开。 */
const RULES = [
  {
    test: (p) => p.startsWith("packages/narrafork-runtime-private/") && p !== RUNTIME_LOCK,
    reason: "Runtime 物化树（私有 fork 的导出物），只有 UPSTREAM.lock.json 允许被跟踪",
  },
  {
    test: (p) => p === "packages/narrafork-runtime-overlay" || p.startsWith("packages/narrafork-runtime-overlay/"),
    reason: "已废弃的 Runtime overlay 目录",
  },
  { test: (p) => p.startsWith("packages/.narrafork-runtime-"), reason: "Runtime 宿主库 / 导入暂存等本地私有目录" },
  { test: (p) => p.startsWith(".runtime-backup-"), reason: "Runtime 物化目录备份" },
  { test: (p) => p.startsWith("narrafork-private-main/"), reason: "上游 Runtime 检出" },
  { test: (p) => p.startsWith(".narrafork/") || p.startsWith(".narrafork-reference/"), reason: "本地计划与参考资料" },
  {
    test: (p) => /(^|\/)\.env(\.[^/]+)?$/.test(p) && !p.endsWith(".env.example"),
    reason: "环境变量文件，可能含密钥",
  },
  { test: (p) => /\.(db|sqlite|sqlite3)$/i.test(p), reason: "数据库文件，可能含用户数据" },
  { test: (p) => /\.(pem|key|p12|pfx)$/i.test(p), reason: "证书或私钥" },
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function violationOf(path) {
  const rule = RULES.find((candidate) => candidate.test(path));
  return rule ? { path, reason: rule.reason } : null;
}

/** 从 --name-status 输出里取出新增 / 修改 / 类型变化的路径（删除是清理，不算违规）。 */
function touchedPaths(nameStatus) {
  const paths = [];
  for (const line of nameStatus.split("\n")) {
    const match = /^([AMT])\t(.+)$/.exec(line);
    if (match) paths.push(match[2]);
  }
  return paths;
}

function collect(mode, arg) {
  if (mode === "staged") {
    return touchedPaths(git(["diff", "--cached", "--no-renames", "--name-status"])).map((path) => ({ path }));
  }
  if (mode === "range") {
    // 逐个提交列出，违规时能指出是哪个提交带进来的。
    const found = [];
    let commit = "";
    for (const line of git(["log", "--no-renames", "--format=@@%h %s", "--name-status", arg]).split("\n")) {
      if (line.startsWith("@@")) commit = line.slice(2);
      else for (const path of touchedPaths(line)) found.push({ path, commit });
    }
    return found;
  }
  return git(["ls-files", "-z"]).split("\0").filter(Boolean).map((path) => ({ path }));
}

const argv = process.argv.slice(2);
const mode = argv.includes("--staged") ? "staged" : argv.includes("--range") ? "range" : "tree";
const rangeArg = mode === "range" ? argv[argv.indexOf("--range") + 1] : undefined;
if (mode === "range" && !rangeArg) {
  console.error("--range 需要参数，例如 --range origin/master..HEAD");
  process.exit(2);
}

const violations = [];
const seen = new Set();
for (const entry of collect(mode, rangeArg)) {
  const violation = violationOf(entry.path);
  const key = `${entry.commit ?? ""}\t${entry.path}`;
  if (violation && !seen.has(key)) {
    seen.add(key);
    violations.push({ ...violation, commit: entry.commit });
  }
}

const scope = mode === "staged" ? "暂存区" : mode === "range" ? `提交范围 ${rangeArg}` : "当前跟踪的文件";
if (violations.length === 0) {
  console.log(`公开边界检查通过（${scope}）。`);
  process.exit(0);
}

console.error(`公开边界检查失败（${scope}）：发现 ${violations.length} 个不能进入公开仓库的路径。`);
for (const violation of violations.slice(0, 50)) {
  console.error(`  - ${violation.path}${violation.commit ? `  ← ${violation.commit}` : ""}\n    ${violation.reason}`);
}
if (violations.length > 50) console.error(`  ……另有 ${violations.length - 50} 个`);
console.error(
  [
    "",
    "为什么要拦：本仓库公开，Runtime 源码只能存在于私有 fork NarraFork/novelfork-runtime-private；",
    "文件一旦进入公开历史，之后删除也无法收回。",
    mode === "range"
      ? "怎么办：不要合并或推送这些提交。改写这段未公开的提交把文件去掉（例如交互式变基），再重新检查；已经推送的请立即联系维护者。"
      : "怎么办：用 git rm --cached <路径> 取消跟踪，确认 .gitignore 覆盖后再提交。",
  ].join("\n"),
);
process.exit(1);
