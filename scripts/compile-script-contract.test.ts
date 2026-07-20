import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const rootMain = readFileSync(join(repositoryRoot, "main.ts"), "utf8");
const buildScript = readFileSync(
  join(repositoryRoot, "packages", "narrafork-runtime-private", "scripts", "build-cross-platform.ts"),
  "utf8",
);
const productCompileScript = readFileSync(
  join(repositoryRoot, "scripts", "compile-product-runtime.ts"),
  "utf8",
);
const productFrontendBuildScript = readFileSync(
  join(repositoryRoot, "scripts", "build-product-frontend.ts"),
  "utf8",
);
const isolatedRuntimeBuildScript = readFileSync(
  join(repositoryRoot, "scripts", "lib", "isolated-runtime-build.ts"),
  "utf8",
);
const studioViteConfig = readFileSync(
  join(repositoryRoot, "packages", "studio", "vite.config.ts"),
  "utf8",
);
const releaseArtifactScript = readFileSync(
  join(repositoryRoot, "scripts", "lib", "prepare-runtime-release-artifacts.ts"),
  "utf8",
);
const runtimeMigrationsOverlayPatch = readFileSync(
  join(
    repositoryRoot,
    "packages",
    "narrafork-runtime-overlay",
    "patches",
    "server-run-migrations.external-assets.patch",
  ),
  "utf8",
);
const runtimeFrontendOverlayPatch = readFileSync(
  join(
    repositoryRoot,
    "packages",
    "narrafork-runtime-overlay",
    "patches",
    "server-main.product-host.patch",
  ),
  "utf8",
);
const generatedModuleDeclaration = readFileSync(
  join(
    repositoryRoot,
    "packages",
    "narrafork-runtime-overlay",
    "files",
    "server",
    "generated-modules.d.ts",
  ),
  "utf8",
);

describe("根 Host 编译契约", () => {
  test("根入口直接加载完整 NarraFork Runtime 后端", () => {
    const runtimeImport = 'await import("./packages/narrafork-runtime-private/server/index.ts")';
    expect(rootMain).toContain(runtimeImport);
    expect(rootMain).not.toContain("runtime-core-private");
    expect(rootMain).not.toContain("legacy-runtime-loader");
    expect(existsSync(join(repositoryRoot, "packages", "runtime-core-private"))).toBe(false);
    expect(rootMain).toContain("NOVELFORK_PROJECT_ROOT");
    expect(rootMain).toContain("NOVELFORK_BOOKS_ROOT");
    expect(rootMain).toContain('resolve(homedir(), ".novelfork")');
    expect(rootMain).toContain("NOVELFORK_RUNTIME_DIR");
    expect(rootMain).toContain("NARRAFORK_HOME");
    expect(rootMain).toContain("NOVELFORK_SESSION_STORE_DIR");
    expect(rootMain).toContain("NOVELFORK_STORAGE_DB_PATH");
    expect(rootMain).toContain('resolve(novelForkHome, "novelfork.db")');
    expect(rootMain).toContain('process.env.PORT ??= "4567"');
    expect(rootMain.indexOf("NOVELFORK_STORAGE_DB_PATH")).toBeLessThan(rootMain.indexOf(runtimeImport));
    expect(rootMain.indexOf("NARRAFORK_HOME")).toBeLessThan(rootMain.indexOf(runtimeImport));
  });

  test("compile 由根级产品编排生成 NovelFork 根入口产物", () => {
    expect(packageJson.version).toBe("3.2.0");
    expect(packageJson.scripts.compile).toBe(
      "bun scripts/compile-product-runtime.ts --platform=windows-x64",
    );
    expect(packageJson.scripts.compile).not.toContain("server/index.ts");
    expect(packageJson.scripts["bun:compile"]).toBe("bun run compile");
    expect(productCompileScript).toContain("prepareRuntimeReleaseArtifacts");
    expect(productCompileScript).toContain("prepareEmbeddedProductMigrationData");
    expect(productCompileScript).toContain("NOVELFORK_PRODUCT_MINIFY");
    expect(productCompileScript).toContain('sourcemap: minify ? "none" : "inline"');
    expect(productCompileScript).toContain('const entry = join(isolatedRuntime.workspaceRoot, "main.ts")');
    expect(productCompileScript).toContain("novelfork-v${version}-windows-x64.exe");
    expect(productCompileScript).toContain("outfile: artifact");
    expect(productCompileScript).toContain("createIsolatedRuntimeBuild");
    expect(productCompileScript).toContain("withIsolatedRuntimeEnvironment");
    expect(productCompileScript).toContain("runtimeRoot: isolatedRuntime.root");
    expect(productCompileScript).not.toContain("build-cross-platform.ts");
    expect(productCompileScript).not.toContain("NARRAFORK_MIGRATIONS_DIR");
    expect(productFrontendBuildScript).toContain('Bun.spawnSync([process.execPath, "run", "build"], {');
    expect(productFrontendBuildScript).not.toContain('Bun.spawnSync(["bun", "run", "build"], {');
    expect(productFrontendBuildScript).toContain("NOVELFORK_PRODUCT_RUNTIME_ROOT");
    expect(isolatedRuntimeBuildScript).toContain('"install", "--frozen-lockfile"');
    expect(isolatedRuntimeBuildScript).toContain('Bun.version !== REQUIRED_RUNTIME_BUN_VERSION');
    expect(isolatedRuntimeBuildScript).toContain("NODE_PATH");
    expect(isolatedRuntimeBuildScript).not.toContain("ln -s");
    expect(isolatedRuntimeBuildScript).not.toContain("mklink");
    expect(studioViteConfig).toContain("NOVELFORK_PRODUCT_RUNTIME_ROOT");
    expect(studioViteConfig).toContain("frontendOutDir");
  });

  test("通用 Runtime 交叉编译脚本保持独立且产品编排生成全部缺失产物", () => {
    expect(buildScript).toContain('"./server/index.ts"');
    expect(buildScript).toContain('const DIST_DIR = join(ROOT, "dist")');
    expect(buildScript).not.toContain("--entry=");
    expect(buildScript).not.toContain("--dist=");
    expect(releaseArtifactScript).toContain("embedded-frontend.ts");
    expect(releaseArtifactScript).toContain("embedded-migrations-data.ts");
    expect(runtimeMigrationsOverlayPatch).toContain('import("@server/generated/embedded-migrations-data")');
    expect(runtimeMigrationsOverlayPatch).not.toContain(
      "+\t\tconst generatedMigrationsDataModulePath",
    );
    expect(runtimeFrontendOverlayPatch).toContain(
      'import("@server/generated/embedded-frontend")',
    );
    expect(runtimeFrontendOverlayPatch).not.toContain(
      "+\t\t\tconst generatedFrontendModulePath",
    );
    expect(releaseArtifactScript).toContain("embedded-changelog.ts");
    expect(releaseArtifactScript).toContain("build-info.ts");
    expect(releaseArtifactScript).toContain("parcel-native-loader.ts");
    expect(generatedModuleDeclaration).toContain("@server/generated/embedded-changelog");
    expect(generatedModuleDeclaration).toContain("@server/generated/embedded-migrations-data");
    expect(generatedModuleDeclaration).toContain("@server/generated/embedded-frontend");
    expect(generatedModuleDeclaration).toContain("@server/generated/parcel-native-loader");
    expect(generatedModuleDeclaration).not.toContain("novelfork-product-runtime");
    expect(generatedModuleDeclaration).not.toContain("novel-plugin");
  });
});
