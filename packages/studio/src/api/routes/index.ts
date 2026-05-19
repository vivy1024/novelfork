export { createRunsRouter } from "./runs.js";
export { createAuthRouter } from "./auth.js";
export { createStorageRouter } from "./storage.js";
export { createSnapshotsRouter } from "./snapshots.js";
export { createAIRelayRouter } from "./ai-relay.js";
export { createDaemonRouter } from "./daemon.js";
export { createMCPRouter } from "./mcp.js";
export { createWorkbenchRouter } from "./workbench.js";
export { createLorebookRouter } from "./lorebook.js";
export { createSettingsRouter } from "./settings.js";
export { createOnboardingRouter } from "./onboarding.js";
export { createProvidersRouter } from "./providers.js";
export { createRuntimeCapabilitiesRouter } from "./runtime-capabilities.js";
export { createGitRouter } from "./git.js";
export { createAgentConfigRouter } from "./agent-config.js";
export { createToolsRouter } from "./tools.js";
export { createWorktreeRouter } from "./worktree.js";
export { createWorkspaceManagementRouter } from "./workspace-management.js";
export { createRhythmRouter } from "./rhythm.js";
export { createGoldenChaptersRouter } from "./golden-chapters.js";
export { createAdminRouter, setupAdminWebSocket } from "./admin.js";
export { createRoutinesRouter } from "./routines.js";
export { createChapterCandidatesRouter } from "./chapter-candidates.js";
export { createNarrativeLineRouter } from "./narrative-line.js";
export { createSearchRouter } from "./search.js";
export { default as sessionRouter } from "./session.js";
export { createMonitorRouter, setupMonitorWebSocket } from "./monitor.js";
export { createPresetsRouter } from "./presets.js";
export { createExecRouter } from "./exec.js";
export { createTerminalsRouter } from "./terminals.js";
export { createProxyRouter } from "./proxy.js";
export { createAggregationsRouter } from "./aggregations.js";
export { createRuntimeStatusRouter } from "./runtime-status.js";
export { createUsageRouter } from "./usage.js";
export { createShareRouter } from "./share.js";
export { createUploadRouter } from "./upload.js";
export { createStorageDiagnosticsRouter } from "./storage-diagnostics.js";
export { createLearningRouter } from "./learning.js";
export { createFileChangesRouter } from "./file-changes.js";
export { createAuthUsersRouter } from "./auth-users.js";
export type { RouterContext } from "./context.js";

// Re-export novel-domain routes from novel-plugin
export {
  createAIRouter,
  createJingweiRouter,
  createWritingModesRouter,
  createPipelineRouter,
  createFilterRouter,
  createComplianceRouter,
  createBibleRouter,
  createWritingToolsRouter,
  createContextManagerRouter,
  createWritingResourceRouter,
} from "@vivy1024/novelfork-novel-plugin/routes";
