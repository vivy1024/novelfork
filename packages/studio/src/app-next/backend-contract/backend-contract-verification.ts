export type BackendContractVerificationCommandId =
  | "backend-contract-vitest"
  | "studio-typecheck"
  | "docs-verify"
  | "diff-check"
  | "app-next-api-guard";

export interface BackendContractVerificationCommand {
  readonly id: BackendContractVerificationCommandId;
  readonly command: string;
  readonly description: string;
}

export interface BackendContractVerificationRun {
  readonly id: BackendContractVerificationCommandId;
  readonly command: string;
  readonly exitCode: number | null;
  readonly output?: string;
}

export type BackendContractVerificationStatus = "passed" | "failed" | "unverified";

export interface BackendContractVerificationItem extends BackendContractVerificationCommand {
  readonly status: BackendContractVerificationStatus;
  readonly exitCode: number | null;
  readonly output?: string;
}

export interface BackendContractVerificationReport {
  readonly items: readonly BackendContractVerificationItem[];
}

export interface SourceFileSnapshot {
  readonly path: string;
  readonly content: string;
}

export interface UnregisteredAppNextApiStringFinding {
  readonly path: string;
  readonly apiString: string;
  readonly line: number;
  readonly column: number;
}

export const BACKEND_CONTRACT_VERIFICATION_COMMANDS: readonly BackendContractVerificationCommand[] = [
  {
    id: "backend-contract-vitest",
    command: "pnpm --dir packages/studio exec vitest run src/app-next/backend-contract",
    description: "运行 Backend Contract 聚焦 Vitest。",
  },
  {
    id: "studio-typecheck",
    command: "pnpm --dir packages/studio typecheck",
    description: "运行 Studio typecheck。",
  },
  {
    id: "docs-verify",
    command: "pnpm docs:verify",
    description: "验证文档头信息、链接、索引与禁用口径。",
  },
  {
    id: "diff-check",
    command: "git diff --check",
    description: "检查待提交 diff 空白错误。",
  },
  {
    id: "app-next-api-guard",
    command: "findUnregisteredAppNextApiStrings(app-next sources)",
    description: "确认 app-next 组件没有绕过 backend-contract 散写 /api 字符串。",
  },
];

const APP_NEXT_API_PATTERN = /["'`]((?:\/api\/)[^"'`\s)]+)/g;
const BACKEND_CONTRACT_SEGMENT_PATTERN = /(^|[\\/])backend-contract([\\/]|$)/;

export function buildBackendContractVerificationReport(
  runs: readonly BackendContractVerificationRun[] = [],
): BackendContractVerificationReport {
  const runById = new Map(runs.map((run) => [run.id, run]));
  return {
    items: BACKEND_CONTRACT_VERIFICATION_COMMANDS.map((expected) => {
      const run = runById.get(expected.id);
      if (!run) return { ...expected, status: "unverified", exitCode: null };
      return {
        ...expected,
        command: run.command,
        status: run.exitCode === 0 ? "passed" : "failed",
        exitCode: run.exitCode,
        ...(run.output ? { output: run.output } : {}),
      };
    }),
  };
}

export function listUnverifiedBackendContractItems(
  report: BackendContractVerificationReport,
): readonly BackendContractVerificationItem[] {
  return report.items.filter((item) => item.status !== "passed");
}

export function findUnregisteredAppNextApiStrings(
  sources: readonly SourceFileSnapshot[],
): UnregisteredAppNextApiStringFinding[] {
  const findings: UnregisteredAppNextApiStringFinding[] = [];

  for (const source of sources) {
    const normalizedPath = source.path.replaceAll("\\", "/");
    if (BACKEND_CONTRACT_SEGMENT_PATTERN.test(normalizedPath)) continue;

    for (const match of source.content.matchAll(APP_NEXT_API_PATTERN)) {
      const apiString = match[1];
      const index = match.index ?? 0;
      const { line, column } = lineColumnAt(source.content, index + 1);
      findings.push({ path: normalizedPath, apiString, line, column });
    }
  }

  return findings;
}

function lineColumnAt(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}
