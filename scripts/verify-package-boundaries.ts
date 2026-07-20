#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface BoundaryRule {
  readonly name: string;
  readonly fromDir: string;
  readonly forbiddenPackages: readonly string[];
  readonly forbiddenDirs: readonly string[];
  readonly message: string;
}

interface ImportMatch {
  readonly kind: string;
  readonly specifier: string;
  readonly index: number;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly specifier: string;
  readonly ruleName: string;
  readonly message: string;
}

export interface BoundaryCheckOptions {
  readonly repoRoot?: string;
  /** Test seam. Production checks always derive this list from `npm pack --dry-run`. */
  readonly corePacklistFiles?: readonly string[];
}

const PRIVATE_RUNTIME_PACKAGES = [
  "@vivy1024/novelfork-runtime-private",
  "@vivy1024/runtime-core-private",
  "narrafork-runtime-private",
  "runtime-core-private",
] as const;

const PRODUCT_RUNTIME_PACKAGES = [
  "@vivy1024/novelfork-product-runtime",
  "@product/novelfork",
] as const;

export const boundaryRules: readonly BoundaryRule[] = [
  {
    name: "core-no-upper-layer-or-private-runtime-imports",
    fromDir: "packages/core/src",
    forbiddenPackages: [
      "@vivy1024/novelfork-studio",
      "@vivy1024/novelfork-novel-plugin",
      ...PRIVATE_RUNTIME_PACKAGES,
    ],
    forbiddenDirs: [
      "packages/studio",
      "packages/novel-plugin",
      "packages/narrafork-runtime-private",
      "packages/runtime-core-private",
    ],
    message: "core must not import studio, novel-plugin, or a private Runtime package. Keep product and Runtime implementations behind lower-level public contracts.",
  },
  {
    name: "novel-plugin-no-studio-imports",
    fromDir: "packages/novel-plugin/src",
    forbiddenPackages: ["@vivy1024/novelfork-studio"],
    forbiddenDirs: ["packages/studio"],
    message: "novel-plugin must not import Studio. Move shared contracts to core/novel-plugin and host capabilities to a Runtime product adapter.",
  },
  {
    name: "runtime-no-novelfork-product-imports",
    fromDir: "packages/narrafork-runtime-private/server",
    forbiddenPackages: [
      "@vivy1024/novelfork-core",
      "@vivy1024/novelfork-novel-plugin",
      "@vivy1024/narrafork-runtime-bridge",
      ...PRODUCT_RUNTIME_PACKAGES,
    ],
    forbiddenDirs: [
      "packages/core",
      "packages/novel-plugin",
      "packages/narrafork-runtime-bridge",
      "packages/novelfork-product-runtime",
    ],
    message: "The vendored Runtime server must remain product-agnostic. Put NovelFork behavior in the product package and access Runtime capabilities only through the external bridge.",
  },
  {
    name: "runtime-shared-no-novelfork-product-imports",
    fromDir: "packages/narrafork-runtime-private/shared",
    forbiddenPackages: [
      "@vivy1024/novelfork-core",
      "@vivy1024/novelfork-novel-plugin",
      "@vivy1024/narrafork-runtime-bridge",
      ...PRODUCT_RUNTIME_PACKAGES,
    ],
    forbiddenDirs: [
      "packages/core",
      "packages/novel-plugin",
      "packages/narrafork-runtime-bridge",
      "packages/novelfork-product-runtime",
    ],
    message: "Runtime shared contracts must remain product-agnostic. Product behavior belongs outside the vendored Runtime tree.",
  },
  {
    name: "product-runtime-no-private-runtime-deep-imports",
    fromDir: "packages/novelfork-product-runtime/src",
    forbiddenPackages: ["@server", "@shared", ...PRIVATE_RUNTIME_PACKAGES],
    forbiddenDirs: ["packages/narrafork-runtime-private", "packages/runtime-core-private"],
    message: "NovelFork product code must access the private Runtime only through @vivy1024/narrafork-runtime-bridge.",
  },
];

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const privateRuntimeIdentifierPattern = {
  label: "private Runtime package identifier",
  regex: /(?:runtime-core-private|narrafork-runtime-private)/g,
} as const;

const runtimeContractImplementationPatterns: readonly { readonly label: string; readonly regex: RegExp }[] = [
  {
    label: "Bun private runtime implementation",
    regex: /(?:\bBun\s*\.|\bglobalThis\.Bun\b|\bprocess\.versions\.bun\b|["']bun:[^"']+["'])/g,
  },
  {
    label: "SQLite private runtime implementation",
    regex: /["'](?:node:sqlite|better-sqlite3|bun:sqlite|drizzle-orm\/(?:bun-sqlite|better-sqlite3))(?:\/[^"']*)?["']/g,
  },
  {
    label: "PTY private runtime implementation",
    regex: /["'](?:node-pty|@lydell\/node-pty|bun-pty)(?:\/[^"']*)?["']/g,
  },
];

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isRuntimeContractPath(coreRelativePath: string): boolean {
  const normalized = normalizePath(coreRelativePath);
  return normalized.startsWith("src/runtime-contracts/") || normalized.startsWith("dist/runtime-contracts/");
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function findImportMatches(source: string): ImportMatch[] {
  const patterns: readonly { readonly kind: string; readonly regex: RegExp }[] = [
    {
      kind: "static import/export",
      regex: /\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g,
    },
    {
      kind: "dynamic import",
      regex: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    },
    {
      kind: "require",
      regex: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    },
  ];

  const matches: ImportMatch[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const specifier = match[1];
      if (!specifier || match.index === undefined) continue;
      matches.push({ kind: pattern.kind, specifier, index: match.index });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function isForbiddenPackage(specifier: string, rule: BoundaryRule): boolean {
  return rule.forbiddenPackages.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

function isForbiddenRelativeTarget(repoRoot: string, filePath: string, specifier: string, rule: BoundaryRule): boolean {
  if (!specifier.startsWith(".")) return false;
  const resolved = normalizePath(path.resolve(path.dirname(filePath), specifier));
  return rule.forbiddenDirs.some((dir) => {
    const forbidden = normalizePath(path.resolve(repoRoot, dir));
    return resolved === forbidden || resolved.startsWith(`${forbidden}/`);
  });
}

async function checkRule(repoRoot: string, rule: BoundaryRule): Promise<Violation[]> {
  const root = path.resolve(repoRoot, rule.fromDir);
  const files = await collectSourceFiles(root);
  const violations: Violation[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf-8");
    for (const match of findImportMatches(source)) {
      if (!isForbiddenPackage(match.specifier, rule) && !isForbiddenRelativeTarget(repoRoot, file, match.specifier, rule)) continue;
      violations.push({
        file: normalizePath(path.relative(repoRoot, file)),
        line: lineNumberAt(source, match.index),
        kind: match.kind,
        specifier: match.specifier,
        ruleName: rule.name,
        message: rule.message,
      });
    }
  }

  return violations;
}

const runtimeProductPersistenceIdentifiers = [
  "bookRuntimeBindings",
  "bookProvisionOperations",
  "novelforkLegacySessionImports",
  "book_runtime_bindings",
  "book_provision_operations",
  "novelfork_legacy_session_imports",
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function checkRuntimeProductPersistenceBoundary(repoRoot: string): Promise<Violation[]> {
  const runtimeRoot = path.join(repoRoot, "packages", "narrafork-runtime-private");
  const explicitFiles = [
    path.join(runtimeRoot, "server", "db", "schema.ts"),
    path.join(runtimeRoot, "server", "db", "relations.ts"),
  ];
  const migrationDir = path.join(runtimeRoot, "drizzle");
  const migrationEntries = await readdir(migrationDir, { withFileTypes: true }).catch(() => []);
  const executableMigrations = migrationEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(migrationDir, entry.name));
  const violations: Violation[] = [];

  // Drizzle's meta snapshots intentionally remain historical generation input.
  // This guard checks only Runtime source and executable SQL so new Runtime
  // installations never recreate NovelFork-owned tables.
  for (const file of [...explicitFiles, ...executableMigrations]) {
    const source = await readFile(file, "utf8").catch(() => null);
    if (source === null) continue;
    for (const identifier of runtimeProductPersistenceIdentifiers) {
      const pattern = new RegExp(escapeRegex(identifier), "g");
      for (const match of source.matchAll(pattern)) {
        if (match.index === undefined) continue;
        violations.push({
          file: normalizePath(path.relative(repoRoot, file)),
          line: lineNumberAt(source, match.index),
          kind: "Runtime product persistence reference",
          specifier: identifier,
          ruleName: "runtime-no-novelfork-product-persistence",
          message: "NovelFork bindings, provisioning records, and legacy-session ledgers belong to the product database, not the Runtime schema, relations, or executable migrations.",
        });
      }
    }
  }

  const retiredLegacyMigration = path.join(runtimeRoot, "server", "scripts", "migrate-legacy-sessions.ts");
  if (await readFile(retiredLegacyMigration, "utf8").then(() => true).catch(() => false)) {
    violations.push({
      file: normalizePath(path.relative(repoRoot, retiredLegacyMigration)),
      line: 1,
      kind: "Runtime product migration entrypoint",
      specifier: "migrate-legacy-sessions.ts",
      ruleName: "runtime-no-novelfork-product-persistence",
      message: "Legacy NovelFork session migration belongs to the product package, not the Runtime source tree.",
    });
  }

  return violations;
}

interface WorkspaceManifest {
  readonly dir: string;
  readonly name: string;
  readonly dependencies: readonly string[];
}

async function readWorkspaceManifests(repoRoot: string): Promise<WorkspaceManifest[]> {
  const packagesDir = path.join(repoRoot, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  const manifests: WorkspaceManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, entry.name, "package.json");
    const source = await readFile(manifestPath, "utf8").catch(() => null);
    if (source === null) continue;
    const parsed = JSON.parse(source) as {
      name?: unknown;
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    if (typeof parsed.name !== "string" || !parsed.name) continue;
    manifests.push({
      dir: normalizePath(path.relative(repoRoot, path.dirname(manifestPath))),
      name: parsed.name,
      dependencies: [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.optionalDependencies ?? {}),
      ],
    });
  }
  return manifests;
}

async function checkRuntimeManifestDependencies(repoRoot: string): Promise<Violation[]> {
  const manifests = await readWorkspaceManifests(repoRoot);
  const runtime = manifests.find((manifest) => manifest.dir === "packages/narrafork-runtime-private");
  if (!runtime) return [];
  // The legacy Runtime frontend still carries its temporary NovelFork UI
  // dependencies until the separately-approved Studio migration completes.
  // The server/shared boundary above is already strict; this manifest gate
  // prevents only reverse bridge/product package dependencies today.
  const forbidden = [
    "@vivy1024/narrafork-runtime-bridge",
    ...PRODUCT_RUNTIME_PACKAGES,
  ];
  return runtime.dependencies
    .filter((dependency) => forbidden.includes(dependency))
    .map((dependency) => ({
      file: `${runtime.dir}/package.json`,
      line: 1,
      kind: "Runtime product dependency",
      specifier: dependency,
      ruleName: "runtime-no-novelfork-product-dependencies",
      message: "The vendored Runtime manifest must not depend on NovelFork product packages or the reverse-direction Runtime bridge.",
    }));
}

function canonicalCycle(cycle: readonly string[]): string {
  const ring = cycle.slice(0, -1);
  const rotations = ring.map((_, index) => [...ring.slice(index), ...ring.slice(0, index)]);
  return rotations.map((items) => items.join(" -> ")).sort()[0] ?? "";
}

async function checkWorkspaceDependencyCycles(repoRoot: string): Promise<Violation[]> {
  const manifests = await readWorkspaceManifests(repoRoot);
  const workspaceNames = new Set(manifests.map((manifest) => manifest.name));
  const graph = new Map(manifests.map((manifest) => [
    manifest.name,
    manifest.dependencies.filter((dependency) => workspaceNames.has(dependency)),
  ]));
  const manifestByName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const cycles = new Map<string, readonly string[]>();

  function visit(name: string, stack: readonly string[]): void {
    const index = stack.indexOf(name);
    if (index >= 0) {
      const cycle = [...stack.slice(index), name];
      cycles.set(canonicalCycle(cycle), cycle);
      return;
    }
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...stack, name]);
  }

  for (const name of graph.keys()) visit(name, []);
  return [...cycles.values()].map((cycle) => {
    const owner = manifestByName.get(cycle[0]!)!;
    return {
      file: `${owner.dir}/package.json`,
      line: 1,
      kind: "workspace dependency cycle",
      specifier: cycle.join(" -> "),
      ruleName: "workspace-no-cyclic-package-dependencies",
      message: "Workspace packages must form an acyclic dependency graph. Move shared contracts down to core and remove reverse product dependencies.",
    };
  });
}

async function corePacklist(coreDir: string): Promise<string[]> {
  const child = Bun.spawn(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: coreDir,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`读取 core npm packlist 失败：${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`);

  let report: Array<{ files?: Array<{ path?: unknown }> }>;
  try {
    report = JSON.parse(stdout) as Array<{ files?: Array<{ path?: unknown }> }>;
  } catch {
    throw new Error(`core npm packlist 不是有效 JSON：${stdout.trim().slice(0, 200)}`);
  }
  return (report[0]?.files ?? [])
    .map((entry) => entry.path)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

async function checkPrivateImplementations(
  repoRoot: string,
  packlistOverride?: readonly string[],
): Promise<Violation[]> {
  const coreDir = path.resolve(repoRoot, "packages/core");
  const sourceFiles = await collectSourceFiles(path.join(coreDir, "src"));
  const packlistFiles = packlistOverride ? [...packlistOverride] : await corePacklist(coreDir);
  const candidates = new Map<string, { absolutePath: string; kind: string }>();
  for (const absolutePath of sourceFiles) {
    candidates.set(normalizePath(path.relative(repoRoot, absolutePath)), { absolutePath, kind: "core source" });
  }
  for (const relativePath of packlistFiles) {
    const absolutePath = path.resolve(coreDir, relativePath);
    const repoRelative = normalizePath(path.relative(repoRoot, absolutePath));
    if (!candidates.has(repoRelative)) candidates.set(repoRelative, { absolutePath, kind: "core packlist" });
  }

  const violations: Violation[] = [];
  for (const [file, candidate] of candidates) {
    const normalizedPackPath = normalizePath(path.relative(coreDir, candidate.absolutePath));
    for (const forbiddenName of PRIVATE_RUNTIME_PACKAGES) {
      if (!normalizedPackPath.includes(forbiddenName)) continue;
      violations.push({
        file,
        line: 1,
        kind: candidate.kind,
        specifier: forbiddenName,
        ruleName: "public-core-no-private-runtime-implementation",
        message: "Published core files and core source must not contain private Runtime, Bun/SQLite, or PTY implementations.",
      });
    }

    const source = await readFile(candidate.absolutePath, "utf8").catch(() => null);
    if (source === null) {
      violations.push({
        file,
        line: 1,
        kind: candidate.kind,
        specifier: "missing packlist file",
        ruleName: "public-core-packlist-readable",
        message: "Every file selected by the core npm packlist must exist and be readable.",
      });
      continue;
    }
    const patterns = [
      privateRuntimeIdentifierPattern,
      ...(isRuntimeContractPath(normalizedPackPath) ? runtimeContractImplementationPatterns : []),
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern.regex)) {
        if (match.index === undefined) continue;
        violations.push({
          file,
          line: lineNumberAt(source, match.index),
          kind: candidate.kind,
          specifier: match[0],
          ruleName: "public-core-no-private-runtime-implementation",
          message: `Runtime contracts and published core files must not contain ${pattern.label}.`,
        });
      }
    }
  }
  return violations;
}

export async function checkPackageBoundaries(options: BoundaryCheckOptions = {}): Promise<Violation[]> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const [
    importViolations,
    implementationViolations,
    workspaceCycleViolations,
    runtimePersistenceViolations,
    runtimeManifestViolations,
  ] = await Promise.all([
    Promise.all(boundaryRules.map((rule) => checkRule(repoRoot, rule))).then((groups) => groups.flat()),
    checkPrivateImplementations(repoRoot, options.corePacklistFiles),
    checkWorkspaceDependencyCycles(repoRoot),
    checkRuntimeProductPersistenceBoundary(repoRoot),
    checkRuntimeManifestDependencies(repoRoot),
  ]);
  return [
    ...importViolations,
    ...implementationViolations,
    ...workspaceCycleViolations,
    ...runtimePersistenceViolations,
    ...runtimeManifestViolations,
  ];
}

export async function main(): Promise<void> {
  const allViolations = await checkPackageBoundaries();
  if (allViolations.length > 0) {
    console.error("Package boundary violations found:");
    for (const violation of allViolations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.kind} ${violation.specifier}`);
      console.error(`  Rule ${violation.ruleName}: ${violation.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Package boundary check passed: public core contains no private Runtime implementation and no unapproved upper-layer imports were found.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Package boundary check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
