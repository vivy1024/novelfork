import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
	createIsolatedRuntimeBuild,
	withIsolatedRuntimeEnvironment,
} from "./lib/isolated-runtime-build.ts";
import { prepareEmbeddedProductMigrationData } from "./lib/prepare-product-release-artifacts.ts";
import { prepareRuntimeReleaseArtifacts } from "./lib/prepare-runtime-release-artifacts.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const runtimeSourceRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
const distRoot = resolve(process.env.NOVELFORK_PRODUCT_DIST_DIR?.trim() || join(repositoryRoot, "dist"));
const minify = process.env.NOVELFORK_PRODUCT_MINIFY?.trim() === "1";
const productPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
	version?: string;
};
const version = productPackage.version ?? "0.0.0";

type ProductPlatform = {
	readonly aliases: readonly string[];
	readonly target: string;
	readonly buildPlatform: string;
	readonly artifactName: string;
};

const supportedPlatforms: readonly ProductPlatform[] = [
	{
		aliases: ["darwin-arm64", "macos-arm64", "bun-darwin-arm64"],
		target: "bun-darwin-arm64",
		buildPlatform: "darwin-arm64",
		artifactName: `novelfork-v${version}-macos-arm64`,
	},
	{
		aliases: ["darwin-x64", "macos-x64", "bun-darwin-x64"],
		target: "bun-darwin-x64",
		buildPlatform: "darwin-x64",
		artifactName: `novelfork-v${version}-macos-x64`,
	},
	{
		aliases: ["linux-x64", "bun-linux-x64"],
		target: "bun-linux-x64",
		buildPlatform: "linux-x64",
		artifactName: `novelfork-v${version}-linux-x64`,
	},
	{
		aliases: ["linux-x64-baseline", "bun-linux-x64-baseline"],
		target: "bun-linux-x64-baseline",
		buildPlatform: "linux-x64-baseline",
		artifactName: `novelfork-v${version}-linux-x64-baseline`,
	},
	{
		aliases: ["linux-arm64", "bun-linux-arm64"],
		target: "bun-linux-arm64",
		buildPlatform: "linux-arm64",
		artifactName: `novelfork-v${version}-linux-arm64`,
	},
	{
		aliases: ["windows", "windows-x64", "win-x64", "bun-windows-x64"],
		target: "bun-windows-x64",
		buildPlatform: "win-x64",
		artifactName: `novelfork-v${version}-windows-x64.exe`,
	},
	{
		aliases: [
			"windows-x64-baseline",
			"win-x64-baseline",
			"bun-windows-x64-baseline",
		],
		target: "bun-windows-x64-baseline",
		buildPlatform: "win-x64-baseline",
		artifactName: `novelfork-v${version}-windows-x64-baseline.exe`,
	},
];

function readCommit(environment: NodeJS.ProcessEnv): string {
	const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
		cwd: repositoryRoot,
		env: environment,
		stdout: "pipe",
		stderr: "pipe",
	});
	return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : "";
}

function selectPlatforms(args: readonly string[]): readonly ProductPlatform[] {
	const platformArgs = args.filter((arg) => arg.startsWith("--platform="));
	if (args.length !== platformArgs.length) {
		throw new Error(`Unsupported compile argument(s): ${args.filter((arg) => !arg.startsWith("--platform=")).join(", ")}`);
	}
	if (platformArgs.length === 0) return supportedPlatforms;

	const selected = platformArgs.map((argument) => {
		const requested = argument.slice("--platform=".length);
		const platform = supportedPlatforms.find((candidate) => candidate.aliases.includes(requested));
		if (!platform) {
			throw new Error(
				`Unknown product compile platform: ${requested}. Available values: ${supportedPlatforms.flatMap((candidate) => candidate.aliases).join(", ")}`,
			);
		}
		return platform;
	});
	return [...new Map(selected.map((platform) => [platform.target, platform])).values()];
}

function run(
	command: readonly string[],
	cwd: string,
	purpose: string,
	environment: NodeJS.ProcessEnv,
): void {
	const result = Bun.spawnSync(command, {
		cwd,
		env: environment,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (result.exitCode !== 0) {
		throw new Error(`${purpose} failed with exit code ${result.exitCode ?? "unknown"}`);
	}
}

function writeChecksum(artifact: string): void {
	const checksum = createHash("sha256").update(readFileSync(artifact)).digest("hex");
	writeFileSync(`${artifact}.sha256`, `${checksum}  ${basename(artifact)}\n`);
}

async function compileProduct(): Promise<void> {
	const selectedPlatforms = selectPlatforms(process.argv.slice(2));
	const isolatedRuntime = await createIsolatedRuntimeBuild(runtimeSourceRoot);

	try {
		const productMigrations = prepareEmbeddedProductMigrationData(isolatedRuntime.workspaceRoot);
		console.log(`→ Embedded ${productMigrations.migrationCount} NovelFork product migration(s)...`);

		const frontendEnvironment: NodeJS.ProcessEnv = {
			...isolatedRuntime.environment,
			NOVELFORK_BUILD_WORKSPACE_ROOT: isolatedRuntime.workspaceRoot,
		};
		run(
			[process.execPath, "scripts/build-product-frontend.ts"],
			repositoryRoot,
			"Product Studio build",
			frontendEnvironment,
		);

		mkdirSync(distRoot, { recursive: true });
		const buildCommit = readCommit(isolatedRuntime.environment);
		const entry = join(isolatedRuntime.workspaceRoot, "main.ts");

		for (const platform of selectedPlatforms) {
			console.log(`\n→ Preparing Runtime release artifacts for ${platform.target}...`);
			prepareRuntimeReleaseArtifacts({
				runtimeRoot: isolatedRuntime.root,
				productName: "NovelFork",
				productVersion: version,
				buildCommit,
				buildPlatform: platform.buildPlatform,
				environment: isolatedRuntime.environment,
			});

			const artifact = join(distRoot, platform.artifactName);
			console.log(`→ Compiling NovelFork root entry for ${platform.target}...`);
			const result = await withIsolatedRuntimeEnvironment(
				isolatedRuntime.environment,
				() =>
					Bun.build({
						entrypoints: [entry],
						compile: {
							target: platform.target as Bun.Build.CompileTarget,
							outfile: artifact,
						},
						minify,
						sourcemap: minify ? "none" : "inline",
						external: ["electron"],
						naming: { asset: "[dir]/[name].[ext]" },
						plugins: [isolatedRuntime.resolverPlugin],
					}),
			);
			if (!result.success) {
				throw new Error(`NovelFork ${platform.target} compilation did not complete successfully`);
			}
			if (!existsSync(artifact) || statSync(artifact).size === 0) {
				throw new Error(`Compiler did not produce a non-empty artifact: ${artifact}`);
			}
			writeChecksum(artifact);
			console.log(`✓ Built ${artifact}`);
		}
	} finally {
		isolatedRuntime.dispose();
	}
}

await compileProduct();
