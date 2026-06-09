import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import type { MockDebtItem } from "./mock-debt-ledger.js";

export const MOCK_DEBT_SCAN_KEYWORDS = [
  "mock",
  "fake",
  "stub",
  "dummy",
  "noop",
  "TODO",
  "后续接入",
  "尚未接入",
  "暂未",
  "buildAssistantReply",
  "PROVIDERS.flatMap",
  "accountsByPlatform",
  "temporary implementation",
] as const;

export interface MockDebtScanHit {
  relativePath: string;
  line: number;
  column: number;
  keyword: string;
  lineText: string;
}

export interface RegisteredMockDebtScanHit extends MockDebtScanHit {
  debtId: string;
}

export interface AllowedMockDebtScanHit extends MockDebtScanHit {
  reason: string;
}

export interface MockDebtScanReport {
  hits: MockDebtScanHit[];
  registered: RegisteredMockDebtScanHit[];
  allowed: AllowedMockDebtScanHit[];
  unregistered: MockDebtScanHit[];
}

const SOURCE_ROOTS = ["packages/studio/src", "packages/core/src", "packages/cli/src"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const GOVERNANCE_FILES = new Set([
  "packages/studio/src/api/lib/mock-debt-ledger.ts",
  "packages/studio/src/api/lib/mock-debt-scan.ts",
]);

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function isTestPath(path: string): boolean {
  const normalized = normalizePath(path);
  const fileName = basename(normalized);
  return normalized.includes("/__tests__/")
    || fileName.includes(".test.")
    || fileName.includes(".spec.");
}

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name === "dist" || name === "coverage" || name === "__tests__";
}

async function collectSourceFiles(dir: string, rootDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = normalizePath(relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        files.push(...await collectSourceFiles(absolutePath, rootDir));
      }
      continue;
    }

    if (!entry.isFile() || !isSourceFile(entry.name) || isTestPath(relativePath) || GOVERNANCE_FILES.has(relativePath)) {
      continue;
    }

    files.push(absolutePath);
  }
  return files;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegExp(keyword: string): RegExp {
  if (/^[a-z]+$/i.test(keyword)) {
    const flags = keyword === "TODO" ? "g" : "gi";
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, flags);
  }
  return new RegExp(escapeRegExp(keyword), "g");
}

function findKeywordHits(relativePath: string, source: string): MockDebtScanHit[] {
  const hits: MockDebtScanHit[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    for (const keyword of MOCK_DEBT_SCAN_KEYWORDS) {
      const match = buildKeywordRegExp(keyword).exec(lineText);
      if (!match) {
        continue;
      }

      hits.push({
        relativePath,
        line: index + 1,
        column: match.index + 1,
        keyword,
        lineText: lineText.trim(),
      });
    }
  });

  return hits;
}

export async function scanProductionSourceForMockDebt(rootDir: string): Promise<MockDebtScanHit[]> {
  const files = (await Promise.all(SOURCE_ROOTS.map((sourceRoot) => collectSourceFiles(join(rootDir, sourceRoot), rootDir))))
    .flat()
    .sort((left, right) => normalizePath(relative(rootDir, left)).localeCompare(normalizePath(relative(rootDir, right))));
  const hits: MockDebtScanHit[] = [];

  for (const file of files) {
    const relativePath = normalizePath(relative(rootDir, file));
    const source = await readFile(file, "utf-8");
    hits.push(...findKeywordHits(relativePath, source));
  }

  return hits.sort((left, right) => {
    if (left.relativePath !== right.relativePath) return left.relativePath.localeCompare(right.relativePath);
    if (left.line !== right.line) return left.line - right.line;
    if (left.column !== right.column) return left.column - right.column;
    return left.keyword.localeCompare(right.keyword);
  });
}

function patternToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const doubleStarToken = "__DOUBLE_STAR__";
  const globbed = escaped
    .replace(/\*\*/g, doubleStarToken)
    .replace(/\*/g, "[^/]*")
    .replaceAll(doubleStarToken, ".*");
  return new RegExp(`^${globbed}$`);
}

function matchesLedgerFile(pattern: string, relativePath: string): boolean {
  return patternToRegExp(pattern).test(relativePath);
}

function findRegisteredDebtId(hit: MockDebtScanHit, ledger: readonly MockDebtItem[]): string | undefined {
  return ledger.find((item) => item.files.some((filePattern) => matchesLedgerFile(filePattern, hit.relativePath)))?.id;
}

function getAllowedHitReason(hit: MockDebtScanHit): string | undefined {
  if (
    (hit.relativePath === "packages/studio/src/api/server.ts" || hit.relativePath === "packages/studio/src/api/routes/index.ts")
    && hit.lineText.includes("TODO: 需要重构为 Hono")
  ) {
    return "transparent-disabled-legacy-router";
  }

  // 独立模块中的 TODO：MCP client SSE 连接尚未接入真实 runtime
  if (hit.relativePath === "packages/studio/src/api/lib/mcp-client-runtime.ts" && hit.lineText.includes("TODO: 实现真实 SSE EventSource 连接")) {
    return "standalone-module-not-wired-mcp-sse";
  }

  // Task 14 真实提交中的 Codex sandbox planned 注释
  if (hit.relativePath === "packages/studio/src/types/settings.ts" && hit.lineText.includes("Codex OS sandbox 尚未接入")) {
    return "codex-sandbox-planned-status-comment";
  }

  // Task 18 runtime-status API 中的 sandbox planned 说明
  if (hit.relativePath === "packages/studio/src/api/routes/settings.ts" && hit.lineText.includes("Codex OS sandbox 尚未接入")) {
    return "codex-sandbox-runtime-status-note";
  }


  if (hit.relativePath === "packages/studio/src/hooks/use-i18n.ts" && hit.lineText.includes("Beta 通道入口已预留")) {
    return "transparent-reserved-ui-copy";
  }

  // FR-1.4 文件去重：未修改文件返回轻量 stub 标记（真实功能，非 mock 债务）
  if (
    hit.relativePath === "packages/studio/src/api/lib/real-tool-handlers.ts"
    && (hit.lineText.includes("if file was previously read and hasn't changed, return stub")
      || hit.lineText.includes("[file_unchanged]"))
  ) {
    return "real-file-dedup-stub-marker";
  }

  // i18n 翻译资源文件的开发者说明注释（项目当前未用 i18n 框架）
  if (
    hit.relativePath === "packages/studio/src/app-next/agent-conversation/i18n/agent-runtime-hardening.ts"
    && hit.lineText.includes("后续接入 i18next")
  ) {
    return "i18n-resource-doc-comment";
  }

  // 未映射的 novel slash 命令返回透明错误（非伪造成功）
  if (
    hit.relativePath === "packages/studio/src/app-next/agent-conversation/slash-command-registry.ts"
    && hit.lineText.includes("unhandled_novel_command")
  ) {
    return "transparent-unhandled-novel-command";
  }

  // PermissionRequestCard 后端桥接增强 TODO（组件已通过现有 confirmationDecision 流程工作）
  if (
    hit.relativePath === "packages/studio/src/app-next/agent-conversation/surface/PermissionRequestCard.tsx"
    && hit.lineText.includes("桥接为 session:permission-request 事件")
  ) {
    return "permission-card-event-bridge-todo";
  }

  // StudioNextApp 自动重试规则 Phase C 增强 TODO
  if (
    hit.relativePath === "packages/studio/src/app-next/StudioNextApp.tsx"
    && hit.lineText.includes("Phase C 实现自动重试规则")
  ) {
    return "studio-next-auto-retry-phase-c-todo";
  }

  // router-harness 测试工具：注释明确声明“不 mock”真实 router（test-helpers 非测试文件）
  if (
    hit.relativePath === "packages/studio/src/app-next/test-helpers/router-harness.tsx"
    && hit.lineText.includes("不 mock @tanstack/react-router")
  ) {
    return "router-harness-real-router-note";
  }

  return undefined;
}

export function buildMockDebtScanReport(hits: readonly MockDebtScanHit[], ledger: readonly MockDebtItem[]): MockDebtScanReport {
  const registered: RegisteredMockDebtScanHit[] = [];
  const allowed: AllowedMockDebtScanHit[] = [];
  const unregistered: MockDebtScanHit[] = [];

  for (const hit of hits) {
    const debtId = findRegisteredDebtId(hit, ledger);
    if (debtId) {
      registered.push({ ...hit, debtId });
      continue;
    }

    const reason = getAllowedHitReason(hit);
    if (reason) {
      allowed.push({ ...hit, reason });
      continue;
    }

    unregistered.push({ ...hit });
  }

  return {
    hits: [...hits],
    registered,
    allowed,
    unregistered,
  };
}

export function assertNoUnregisteredMockDebtHits(report: MockDebtScanReport): void {
  if (report.unregistered.length === 0) {
    return;
  }

  const summary = report.unregistered
    .slice(0, 20)
    .map((hit) => `${hit.relativePath}:${hit.line}:${hit.keyword}`)
    .join("\n");
  throw new Error(`Unregistered mock debt hit(s):\n${summary}`);
}

export async function scanMockDebtLedgerCoverage({
  rootDir,
  ledger,
}: {
  readonly rootDir: string;
  readonly ledger: readonly MockDebtItem[];
}): Promise<MockDebtScanReport> {
  const hits = await scanProductionSourceForMockDebt(rootDir);
  return buildMockDebtScanReport(hits, ledger);
}
