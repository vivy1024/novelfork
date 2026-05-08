/**
 * Command Enabled Registry — runtime enable/disable of slash commands.
 *
 * 对标：
 * - Claude Code CLI: isCommandEnabled() 检查命令可用性
 * - Codex CLI: feature flags 控制命令可见性
 *
 * 套路页修改 disabled 列表后，runtime 立即拒绝执行被禁用的命令。
 */

export interface CommandExecutionCheck {
  readonly allowed: boolean;
  readonly code?: "command_disabled";
  readonly message?: string;
}

export interface CommandEnabledRegistry {
  isEnabled(commandId: string): boolean;
  checkExecution(commandId: string): CommandExecutionCheck;
  enable(commandId: string): void;
  disable(commandId: string): void;
  getDisabledCommands(): readonly string[];
}

export interface CommandEnabledRegistryConfig {
  readonly disabled: readonly string[];
}

export function createCommandEnabledRegistry(config: CommandEnabledRegistryConfig): CommandEnabledRegistry {
  const disabledSet = new Set<string>(config.disabled);

  return {
    isEnabled(commandId: string): boolean {
      return !disabledSet.has(commandId);
    },

    checkExecution(commandId: string): CommandExecutionCheck {
      if (disabledSet.has(commandId)) {
        return {
          allowed: false,
          code: "command_disabled",
          message: `命令 ${commandId} 已被禁用。可在套路页重新启用。`,
        };
      }
      return { allowed: true };
    },

    enable(commandId: string): void {
      disabledSet.delete(commandId);
    },

    disable(commandId: string): void {
      disabledSet.add(commandId);
    },

    getDisabledCommands(): readonly string[] {
      return [...disabledSet];
    },
  };
}
