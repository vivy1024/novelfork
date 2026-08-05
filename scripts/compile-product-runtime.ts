import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
	createIsolatedRuntimeBuild,
	withIsolatedRuntimeEnvironment,
} from "./lib/isolated-runtime-build.ts";
import { prepareEmbeddedProductMigrationData } from "./lib/prepare-product-release-artifacts.ts";
import {
	prepareRuntimeReleaseArtifacts,
	writeRuntimeBuildInfo,
} from "./lib/prepare-runtime-release-artifacts.ts";

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

	const selected = platformArgs.flatMap((argument) => {
		const requested = argument.slice("--platform=".length);
		if (requested === "all") return [...supportedPlatforms];
		const platform = supportedPlatforms.find((candidate) => candidate.aliases.includes(requested));
		if (!platform) {
			throw new Error(
				`Unknown product compile platform: ${requested}. Available values: all, ${supportedPlatforms.flatMap((candidate) => candidate.aliases).join(", ")}`,
			);
		}
		return [platform];
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

function writeChecksum(artifact: string): string {
	const checksum = createHash("sha256").update(readFileSync(artifact)).digest("hex");
	writeFileSync(`${artifact}.sha256`, `${checksum}  ${basename(artifact)}\n`);
	return checksum;
}

/**
 * One aggregate manifest per multi-platform release so a downloader can verify
 * every published binary from a single file, mirroring the generic Runtime's
 * cross-platform build output.
 */
function writeAggregateChecksums(
	entries: readonly { readonly artifactName: string; readonly checksum: string }[],
): string {
	const path = join(distRoot, `novelfork-v${version}-SHA256SUMS`);
	writeFileSync(
		path,
		`${entries.map((entry) => `${entry.checksum}  ${entry.artifactName}`).join("\n")}\n`,
	);
	return path;
}

/**
 * Bun downloads a separate runtime executable for every cross-compilation
 * target and an interrupted download surfaces as
 * "Failed to extract executable for ...". A full matrix build takes tens of
 * minutes, so probe every target with a throwaway compile first: a missing or
 * corrupt target runtime must fail in seconds, before any real artifact work.
 */
function ensureCompileTargetsAvailable(platforms: readonly ProductPlatform[]): void {
	const probeRoot = mkdtempSync(join(tmpdir(), "novelfork-compile-target-probe-"));
	try {
		const probeEntry = join(probeRoot, "probe.ts");
		writeFileSync(probeEntry, 'console.log("novelfork compile target probe");\n');
		for (const platform of platforms) {
			let lastFailure = "";
			let ready = false;
			for (let attempt = 1; attempt <= 3 && !ready; attempt += 1) {
				const probe = Bun.spawnSync(
					[
						process.execPath,
						"build",
						probeEntry,
						"--compile",
						"--target",
						platform.target,
						"--outfile",
						join(probeRoot, `probe-${platform.target}`),
					],
					{ cwd: probeRoot, stdout: "pipe", stderr: "pipe" },
				);
				if (probe.exitCode === 0) {
					ready = true;
					break;
				}
				lastFailure = new TextDecoder().decode(probe.stderr).trim();
				console.warn(`⚠ ${platform.target} runtime not ready (attempt ${attempt}/3): ${lastFailure}`);
			}
			if (!ready) {
				throw new Error(
					`Bun cross-compilation runtime for ${platform.target} is unavailable: ${lastFailure}`,
				);
			}
			console.log(`✓ Cross-compilation runtime ready: ${platform.target}`);
		}
	} finally {
		rmSync(probeRoot, { recursive: true, force: true });
	}
}

async function compileProduct(): Promise<void> {
	const selectedPlatforms = selectPlatforms(process.argv.slice(2));
	console.log(
		`→ Verifying Bun cross-compilation runtimes for ${selectedPlatforms.length} platform(s)...`,
	);
	ensureCompileTargetsAvailable(selectedPlatforms);
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

		// Frontend assets, migrations and changelogs are platform independent, so
		// they are materialized once even for a full cross-platform matrix; only
		// build-info carries the per-target platform id.
		console.log("\n→ Preparing shared Runtime release artifacts...");
		const runtimeArtifacts = prepareRuntimeReleaseArtifacts({
			runtimeRoot: isolatedRuntime.root,
			productName: "NovelFork",
			productVersion: version,
			buildCommit,
			buildPlatform: selectedPlatforms[0]?.buildPlatform ?? "unknown",
			environment: isolatedRuntime.environment,
		});
		console.log(
			`✓ Embedded ${runtimeArtifacts.frontendAssetCount} frontend asset(s), ${runtimeArtifacts.migrationCount} Runtime migration(s), ${runtimeArtifacts.changelogCount} changelog entry(ies)`,
		);
		console.log(
			`→ Compiling ${selectedPlatforms.length} platform(s): ${selectedPlatforms.map((platform) => platform.target).join(", ")}`,
		);

		const compiled: { artifactName: string; checksum: string }[] = [];
		for (const platform of selectedPlatforms) {
			writeRuntimeBuildInfo(isolatedRuntime.root, {
				runtimeRoot: isolatedRuntime.root,
				productName: "NovelFork",
				productVersion: version,
				buildCommit,
				buildPlatform: platform.buildPlatform,
				environment: isolatedRuntime.environment,
			});

			const artifact = join(distRoot, platform.artifactName);
			console.log(`\n→ Compiling NovelFork root entry for ${platform.target}...`);
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
			const checksum = writeChecksum(artifact);
			compiled.push({ artifactName: platform.artifactName, checksum });
			console.log(`✓ Built ${artifact} (${(statSync(artifact).size / 1024 / 1024).toFixed(1)} MiB)`);
		}

		if (compiled.length > 1) {
			console.log(`\n✓ Wrote ${writeAggregateChecksums(compiled)}`);
		}
		console.log(`\n✅ Completed ${compiled.length} platform build(s) in ${distRoot}`);
	} finally {
		isolatedRuntime.dispose();
	}
}

await compileProduct();
