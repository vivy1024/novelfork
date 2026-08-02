import {
	existsSync,
	lstatSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { join, parse, resolve } from "node:path";

export interface RuntimeExecutionRoot {
	readonly path: string;
	readonly cleanup: () => void;
}

/**
 * Bun's Windows isolated linker builds paths from the process cwd. Keep Runtime
 * execution under a short drive-root junction so long package names do not
 * exceed the legacy Windows path limit. The junction is disposable and never
 * becomes part of the product tree.
 */
export function prepareRuntimeExecutionRoot(runtimeRoot: string): RuntimeExecutionRoot {
	const canonicalRuntimeRoot = realpathSync(resolve(runtimeRoot));
	if (process.platform !== "win32") {
		return { path: canonicalRuntimeRoot, cleanup: () => undefined };
	}

	const alias = join(parse(canonicalRuntimeRoot).root, "nf-runtime");
	let aliasOwned = false;
	let aliasExists = false;
	try {
		lstatSync(alias);
		aliasExists = true;
	} catch {
		aliasExists = false;
	}

	if (aliasExists) {
		const aliasTarget = realpathSync(alias);
		if (aliasTarget.toLowerCase() !== canonicalRuntimeRoot.toLowerCase()) {
			throw new Error(
				`短路径 Runtime 别名已被占用：${alias} -> ${aliasTarget}（预期 ${canonicalRuntimeRoot}）`,
			);
		}
	} else {
		symlinkSync(canonicalRuntimeRoot, alias, "junction");
		aliasOwned = true;
	}

	return {
		path: alias,
		cleanup: () => {
			if (aliasOwned) {
				try {
					unlinkSync(alias);
				} catch {
					// Preserve the alias if a child process or IDE still holds it.
				}
			}
		},
	};
}
