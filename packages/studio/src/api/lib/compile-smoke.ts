import { existsSync } from "node:fs";
import { join } from "node:path";

import type { RuntimeModeSnapshot } from "./runtime-mode.js";

export interface CompileSmokeSummary {
  readonly status: "success" | "skipped" | "failed";
  readonly reason: string;
  readonly note?: string;
}

interface BuildCompileSmokeSummaryOptions {
  readonly root: string;
  readonly indexHtmlReady: boolean;
  readonly runtimeMode: RuntimeModeSnapshot;
  readonly exists?: (path: string) => boolean;
}

function getArtifactCandidates(root: string, runtimeMode: RuntimeModeSnapshot): string[] {
  const projectDistCandidates = [join(root, "dist", "novelfork.exe"), join(root, "dist", "novelfork")];
  if (!runtimeMode.isCompiledBinary) {
    return projectDistCandidates;
  }

  return [runtimeMode.exePath, ...projectDistCandidates];
}

export function buildCompileSmokeSummary({
  root,
  indexHtmlReady,
  runtimeMode,
  exists = existsSync,
}: BuildCompileSmokeSummaryOptions): CompileSmokeSummary {
  const artifactCandidates = getArtifactCandidates(root, runtimeMode);
  const artifactPath = artifactCandidates.find((candidate) => exists(candidate));

  if (artifactPath && indexHtmlReady) {
    return {
      status: "success",
      reason: "单文件产物与静态入口均可用",
      note: artifactPath,
    };
  }

  if (runtimeMode.isProd) {
    return {
      status: "failed",
      reason: artifactPath ? "静态资源入口缺失" : "单文件产物缺失",
      note: artifactPath ?? artifactCandidates.join(" | "),
    };
  }

  return {
    status: "skipped",
    reason: artifactPath ? "源码启动静态入口缺失" : "源码启动未检查单文件产物",
    note: artifactPath ?? artifactCandidates.join(" | "),
  };
}
