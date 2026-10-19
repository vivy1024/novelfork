import type { EmbeddedSettingsExtension } from "@vivy1024/narrafork-runtime-bridge/frontend/runtime-page";

/**
 * 套路页并入 Runtime 子代理编辑器的小说工具（见 fork 的 settings-host-extension）：
 * 这些工具由 novel-plugin 注册，子代理勾选后可执行，Runtime 原编辑器只列通用工具。
 */
export const NOVELFORK_SUBAGENT_TOOLS: ReadonlyArray<string> = [
  "chapter.read",
  "chapter.list",
  "lore.read",
  "memory.read",
  "memory.graph",
  "memory.search",
  "memory.list",
  "cockpit.snapshot",
  "chapter.audit",
  "hooks.manage",
  "character.check_consistency",
];

export const NOVELFORK_ROUTINES_EXTENSION: EmbeddedSettingsExtension = {
  subagentTools: NOVELFORK_SUBAGENT_TOOLS,
};
