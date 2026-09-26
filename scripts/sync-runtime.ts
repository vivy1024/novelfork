/**
 * 按 UPSTREAM.lock.json 把 packages/narrafork-runtime-private/ 对齐到私有 fork 的指定提交。
 *
 *   bun scripts/sync-runtime.ts            同步（首次会克隆 fork，需要仓库读权限）
 *   bun scripts/sync-runtime.ts --check    只报告是否对齐，不写任何文件；未对齐时退出码 1
 *   bun scripts/sync-runtime.ts --force    覆盖 Runtime 目录里的本地修改
 *   bun scripts/sync-runtime.ts --skip-install  同步后不执行 bun install
 *
 * 做法：本地缓存一个 fork 的裸库（packages/.narrafork-runtime-sync/，Git 忽略），
 * 以 Runtime 目录为工作区、用独立索引记录上次同步到的提交，切换版本时走 git 的两路合并：
 * 只改动两版之间变化的文件、删除新版已移除的文件，本地改过且新版也改了的文件会拒绝覆盖。
 * node_modules、dist 等被 Runtime 自身 .gitignore 忽略的内容和 UPSTREAM.lock.json 都不会被动到。
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const RUNTIME_DIR = join(ROOT, "packages", "narrafork-runtime-private");
const LOCK_PATH = join(RUNTIME_DIR, "UPSTREAM.lock.json");
const CACHE_DIR = join(ROOT, "packages", ".narrafork-runtime-sync");
const STATE_INDEX = join(CACHE_DIR, "novelfork-materialized.index");
const STATE_COMMIT = join(CACHE_DIR, "novelfork-materialized-commit");
const LOCK_FILE_NAME = "UPSTREAM.lock.json";

const argv = new Set(process.argv.slice(2));
const CHECK = argv.has("--check");
const FORCE = argv.has("--force");
const SKIP_INSTALL = argv.has("--skip-install");

interface RuntimeLock {
  readonly remote: string;
  readonly branch: string;
  readonly commit: string;
  readonly tree?: string;
}

function fail(what: string, why: string, action: string): never {
  console.error(`\n✗ ${what}\n  原因：${why}\n  怎么办：${action}`);
  process.exit(1);
}

/** 缓存裸库上的 git；带工作区时以 Runtime 目录为工作区、以独立索引记录物化状态。 */
function git(args: string[], opts: { worktree?: boolean; inherit?: boolean; allowFail?: boolean; input?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: CACHE_DIR };
  if (opts.worktree) {
    env.GIT_WORK_TREE = RUNTIME_DIR;
    env.GIT_INDEX_FILE = STATE_INDEX;
  }
  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.worktree ? RUNTIME_DIR : ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: opts.inherit ? "inherit" : "pipe",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  };
  const result = spawnSync("git", args, spawnOpts);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (result.status !== 0 && !opts.allowFail) {
    fail(`git ${args.join(" ")} 失败`, stderr.trim() || result.error?.message || `退出码 ${result.status}`, "按上面的 git 报错处理后重跑");
  }
  return { ok: result.status === 0, stdout, stderr };
}

function readLock(): RuntimeLock {
  if (!existsSync(LOCK_PATH)) {
    fail(`找不到 ${LOCK_PATH}`, "Runtime 来源元数据由主仓库跟踪，缺失说明主仓库检出不完整", "在仓库根执行 git status 确认该文件存在");
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as Partial<RuntimeLock>;
  if (!lock.remote || !lock.branch || !/^[0-9a-f]{40}$/.test(lock.commit ?? "")) {
    fail("UPSTREAM.lock.json 缺少 remote / branch / commit", "同步需要知道从哪里取、取哪个提交", "对照 git log 修复该文件");
  }
  return lock as RuntimeLock;
}

function hasCommit(commit: string): boolean {
  return git(["cat-file", "-e", `${commit}^{commit}`], { allowFail: true }).ok;
}

/** 确保缓存裸库里有目标提交；首次克隆只取 lock 记录的分支。 */
function ensureCommit(lock: RuntimeLock) {
  if (!existsSync(CACHE_DIR)) {
    if (CHECK) fail("还没有本地 fork 缓存", "--check 不做网络克隆", "先不带参数运行一次 bun scripts/sync-runtime.ts");
    console.log(`首次同步：克隆 ${lock.remote}（分支 ${lock.branch}）到 ${CACHE_DIR}`);
    const clone = spawnSync("git", ["clone", "--bare", "--single-branch", "--branch", lock.branch, lock.remote, CACHE_DIR], {
      stdio: "inherit",
    });
    if (clone.status !== 0) {
      fail("克隆 Runtime fork 失败", "多半是没有 NarraFork/novelfork-runtime-private 的访问权限，或网络 / 凭据问题", "找维护者开通仓库权限，确认 git 能用 HTTPS 访问 GitHub 后重跑");
    }
    // 取原始字节：不做换行转换，Windows 上不因可执行位或长路径误判修改。
    for (const [key, value] of [["core.autocrlf", "false"], ["core.filemode", "false"], ["core.longpaths", "true"]]) {
      git(["config", key, value]);
    }
  }
  if (hasCommit(lock.commit)) return;
  if (CHECK) fail(`本地缓存里没有提交 ${lock.commit.slice(0, 8)}`, "lock 已更新而缓存未拉取", "不带 --check 运行一次以拉取");
  console.log(`拉取 ${lock.branch} …`);
  git(["fetch", "origin", `+refs/heads/${lock.branch}:refs/heads/${lock.branch}`], { inherit: true, allowFail: true });
  if (!hasCommit(lock.commit)) git(["fetch", "origin", lock.commit], { inherit: true, allowFail: true });
  if (!hasCommit(lock.commit)) {
    fail(
      `fork 上找不到 lock 记录的提交 ${lock.commit.slice(0, 8)}`,
      "提交可能还没推送到 fork 远端，或 lock 写错了",
      "请更新 lock 的维护者确认该提交已推送到 fork 分支",
    );
  }
}

/** 相对索引（= 上次同步的提交）的本地改动。先 refresh，避免只因时间戳变化被误报。 */
function localChanges() {
  git(["update-index", "-q", "--refresh"], { worktree: true, allowFail: true });
  const modified: string[] = [];
  const missing: string[] = [];
  for (const line of git(["diff-files", "--name-status"], { worktree: true }).stdout.split("\n")) {
    const match = /^([A-Z])\t(.+)$/.exec(line);
    if (!match) continue;
    (match[1] === "D" ? missing : modified).push(match[2]!);
  }
  return { modified, missing };
}

/** 按清单从索引写出文件。清单走标准输入：Windows 命令行有长度上限，首次同步可能要写几千个文件。 */
function checkoutPaths(paths: readonly string[]) {
  if (paths.length === 0) return;
  git(["checkout-index", "-f", "-z", "--stdin"], { worktree: true, input: paths.join("\0") });
}

function extraFiles(): string[] {
  return git(["ls-files", "--others", "--exclude-standard"], { worktree: true })
    .stdout.split("\n")
    .filter((path) => path && path !== LOCK_FILE_NAME);
}

function list(title: string, paths: readonly string[]) {
  if (paths.length === 0) return;
  console.log(`  ${title}（${paths.length}）：`);
  for (const path of paths.slice(0, 20)) console.log(`    ${path}`);
  if (paths.length > 20) console.log(`    ……另有 ${paths.length - 20} 个`);
}

function runInstall() {
  if (SKIP_INSTALL) return;
  console.log("\n在 Runtime 目录执行 bun install --frozen-lockfile …");
  const install = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: RUNTIME_DIR, stdio: "inherit" });
  if (install.status !== 0) fail("bun install 失败", "依赖与 bun.lock 不一致或网络问题", "按上面的报错处理后执行 bun scripts/sync-runtime.ts（已同步的文件不会重复写）");
}

function main() {
  const lock = readLock();
  ensureCommit(lock);
  const target = lock.commit;
  const tree = git(["rev-parse", `${target}^{tree}`]).stdout.trim();
  if (lock.tree && lock.tree !== tree) {
    console.warn(`! lock 记录的 tree（${lock.tree.slice(0, 8)}）与提交实际的 tree（${tree.slice(0, 8)}）不一致，以提交为准。`);
  }
  const recorded = existsSync(STATE_INDEX) && existsSync(STATE_COMMIT) ? readFileSync(STATE_COMMIT, "utf8").trim() : null;
  const short = (commit: string) => commit.slice(0, 8);

  // 首次：不知道目录原先对应哪个提交，只补齐缺失文件，改过的文件默认保留。
  if (!recorded) {
    git(["read-tree", target], { worktree: true });
    const { modified, missing } = localChanges();
    const extras = extraFiles();
    console.log(`Runtime 目录首次登记到 ${short(target)}（${lock.branch}）。`);
    if (CHECK) {
      list("与目标提交不同的文件", modified);
      list("缺失的文件", missing);
      list("目标提交里没有的文件", extras);
      // --check 不留下状态，下次同步仍按首次处理。
      git(["read-tree", "--empty"], { worktree: true });
      process.exit(modified.length + missing.length > 0 ? 1 : 0);
    }
    const overwrite = FORCE ? [...modified, ...missing] : missing;
    checkoutPaths(overwrite);
    writeFileSync(STATE_COMMIT, `${target}\n`);
    list(FORCE ? "已按目标提交覆盖的文件" : "与目标提交不同、已保留的本地修改", modified);
    list("已补齐的缺失文件", missing);
    list("目标提交里没有的文件（可能是旧版本残留，未删除）", extras);
    runInstall();
    console.log(`\n✓ 完成：Runtime 目录对应 ${short(target)}。`);
    return;
  }

  const { modified, missing } = localChanges();
  if (recorded === target) {
    console.log(`Runtime 目录已对应 ${short(target)}（${lock.branch}），无需同步。`);
    list("本地修改", modified);
    list("缺失的文件", missing);
    if (CHECK) process.exit(missing.length > 0 ? 1 : 0);
    if (missing.length > 0) {
      checkoutPaths(missing);
      console.log("  已补齐缺失文件。");
    }
    return;
  }

  console.log(`Runtime 目录对应 ${short(recorded)}，lock 要求 ${short(target)}。`);
  if (CHECK) {
    list("本地修改", modified);
    process.exit(1);
  }
  if (!hasCommit(recorded)) {
    fail(`缓存里找不到上次同步的提交 ${short(recorded)}`, "缓存裸库被清理或上次记录损坏", `删除 ${STATE_COMMIT} 后重跑，按首次登记处理`);
  }
  // 两路合并：本地改过、而两版之间也变了的文件，git 会拒绝覆盖并列出来。
  const merge = FORCE
    ? git(["read-tree", "--reset", "-u", target], { worktree: true, allowFail: true })
    : git(["read-tree", "-m", "-u", recorded, target], { worktree: true, allowFail: true });
  if (!merge.ok) {
    console.error(merge.stderr.trim());
    fail(
      "有本地修改会被新版本覆盖，已停止（没有写入任何文件）",
      "这些文件你本地改过，而 fork 在两个版本之间也改了它们",
      "把需要保留的改动提交到 fork 分支，或确认可以丢弃后加 --force 重跑",
    );
  }
  const changed = git(["diff", "--name-status", recorded, target]).stdout.trim().split("\n").filter(Boolean);
  writeFileSync(STATE_COMMIT, `${target}\n`);
  list("本次变化的文件", changed);
  list("保留的本地修改", modified);
  runInstall();
  console.log(`\n✓ 完成：Runtime 目录已从 ${short(recorded)} 同步到 ${short(target)}。`);
}

main();
