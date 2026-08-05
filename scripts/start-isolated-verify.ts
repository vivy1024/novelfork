/**
 * Launch a throwaway NovelFork instance whose Runtime database, product
 * database, session store and books root all live inside one disposable
 * directory.
 *
 * Why this exists: `main.ts` defaults `NOVELFORK_RUNTIME_DIR` and
 * `NOVELFORK_STORAGE_DB_PATH` to `~/.novelfork`, so setting only
 * `NOVELFORK_PROJECT_ROOT` still writes accounts and preferences into the
 * user's real database. Verification runs that register a test account have
 * repeatedly polluted the production Runtime database that way. Every variable
 * this script sets must stay set together; overriding a subset reintroduces the
 * exact leak it prevents.
 *
 * Usage:
 *   bun scripts/start-isolated-verify.ts                 # random port, temp dir
 *   bun scripts/start-isolated-verify.ts --port=4613
 *   bun scripts/start-isolated-verify.ts --root=/tmp/nf  # reuse a data dir
 *   bun scripts/start-isolated-verify.ts --keep          # keep data on exit
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

type Options = {
	readonly port: number;
	readonly root: string;
	readonly keep: boolean;
	readonly createdRoot: boolean;
};

function parseOptions(argv: readonly string[]): Options {
	let port = 0;
	let root = "";
	let keep = false;

	for (const argument of argv) {
		if (argument === "--keep") {
			keep = true;
			continue;
		}
		const port_ = /^--port=(\d+)$/.exec(argument);
		if (port_) {
			port = Number(port_[1]);
			continue;
		}
		const root_ = /^--root=(.+)$/.exec(argument);
		if (root_) {
			root = resolve(root_[1]);
			continue;
		}
		throw new Error(
			`Unsupported argument: ${argument}. Supported: --port=<n>, --root=<dir>, --keep`,
		);
	}

	// A random high port keeps parallel verification runs from colliding with the
	// developer's own instance (default 4567) or the dev Runtime port (7778).
	const resolvedPort = port > 0 ? port : 41000 + Math.floor(Math.random() * 4000);
	const createdRoot = root.length === 0;
	const resolvedRoot = createdRoot ? mkdtempSync(join(tmpdir(), "novelfork-verify-")) : root;
	if (!createdRoot && !existsSync(resolvedRoot)) mkdirSync(resolvedRoot, { recursive: true });

	return { port: resolvedPort, root: resolvedRoot, keep: keep || !createdRoot, createdRoot };
}

const options = parseOptions(process.argv.slice(2));
const runtimeDir = join(options.root, "runtime");
mkdirSync(runtimeDir, { recursive: true });

const environment: NodeJS.ProcessEnv = {
	...process.env,
	// Never open a window: verification must not take over the user's screen.
	NOVELFORK_NO_BROWSER: "1",
	PORT: String(options.port),
	NOVELFORK_PROJECT_ROOT: options.root,
	NOVELFORK_BOOKS_ROOT: join(options.root, "books"),
	NOVELFORK_RUNTIME_DIR: runtimeDir,
	NARRAFORK_HOME: runtimeDir,
	NOVELFORK_SESSION_STORE_DIR: join(runtimeDir, "sessions"),
	NOVELFORK_STORAGE_DB_PATH: join(options.root, "novelfork.db"),
};

console.log("→ Isolated NovelFork verification instance");
console.log(`  data root:    ${options.root}`);
console.log(`  runtime dir:  ${runtimeDir}`);
console.log(`  product db:   ${environment.NOVELFORK_STORAGE_DB_PATH}`);
console.log(`  listening on: http://127.0.0.1:${options.port}`);
console.log(`  studio proxy: NOVELFORK_RUNTIME_PORT=${options.port} pnpm run --cwd packages/studio dev`);
console.log(options.keep ? "  cleanup:      data kept on exit" : "  cleanup:      data root removed on exit");
console.log("");

const child = Bun.spawn([process.execPath, "run", "main.ts"], {
	cwd: repositoryRoot,
	env: environment,
	stdio: ["inherit", "inherit", "inherit"],
});

function dispose(): void {
	if (!options.keep && options.createdRoot) {
		rmSync(options.root, { recursive: true, force: true });
		console.log(`\n✓ Removed isolated data root ${options.root}`);
	}
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		child.kill();
	});
}

const exitCode = await child.exited;
dispose();
process.exit(exitCode ?? 0);
