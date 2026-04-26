import { createStudioReleaseSnapshot, STUDIO_PACKAGE_VERSION, type StudioReleaseSnapshot } from "../../shared/release-manifest.js";
import { detectRuntimeMode } from "./runtime-mode.js";
import { execGit } from "./git-utils.js";

function buildRuntimeLabel(snapshot: ReturnType<typeof detectRuntimeMode>): string {
  if (snapshot.isCompiledBinary) {
    return "Bun 单文件产物";
  }
  if (snapshot.runtime === "bun") {
    return "Bun 本地单体";
  }
  return "Node 兼容运行时";
}

function buildSourceLabel(snapshot: ReturnType<typeof detectRuntimeMode>): { source: string; label: string } {
  if (snapshot.isCompiledBinary) {
    return {
      source: "bun-compiled-binary",
      label: "单文件桌面构建",
    };
  }

  if (snapshot.runtime === "bun") {
    return {
      source: "bun-source-server",
      label: "源码启动（Bun）",
    };
  }

  return {
    source: "node-source-server",
    label: "源码启动（Node 兼容层）",
  };
}

async function resolveGitCommit(root: string): Promise<string | null> {
  try {
    const commit = await execGit(["rev-parse", "--short=12", "HEAD"], root);
    return commit || null;
  } catch {
    return null;
  }
}

export async function buildStudioReleaseSnapshot(root: string): Promise<StudioReleaseSnapshot> {
  const runtimeMode = detectRuntimeMode();
  const source = buildSourceLabel(runtimeMode);
  const commit = await resolveGitCommit(root);

  return createStudioReleaseSnapshot({
    version: STUDIO_PACKAGE_VERSION,
    runtime: runtimeMode.runtime,
    runtimeLabel: buildRuntimeLabel(runtimeMode),
    buildSource: source.source,
    buildLabel: source.label,
    commit,
  });
}
