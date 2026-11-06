import type { EmbeddedSettingsExtension } from "@vivy1024/narrafork-runtime-bridge/frontend/runtime-page";

/**
 * 套路页并入 Runtime 子代理编辑器的小说工具（见 fork 的 settings-host-extension）：
 * 这些工具由 novel-plugin 注册，子代理勾选后可执行，Runtime 原编辑器只列通用工具。
 *
 * 必须写 Runtime 注册名（线上名，点号换下划线）：子代理的工具上限按注册名精确匹配，
 * 写目录名（chapter.read）勾上了也不生效。只列读类——自定义子代理不该拿到写书的工具。
 */
export const NOVELFORK_SUBAGENT_TOOLS: ReadonlyArray<string> = [
  "chapter_read",
  "chapter_list",
  "lore_read",
  "memory_read",
  "memory_graph",
  "memory_search",
  "memory_list",
  "cockpit_snapshot",
  "chapter_audit",
  "character_check_consistency",
];

export const NOVELFORK_ROUTINES_EXTENSION: EmbeddedSettingsExtension = {
  subagentTools: NOVELFORK_SUBAGENT_TOOLS,
};
