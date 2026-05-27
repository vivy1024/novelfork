/**
 * Context Budget Manager
 *
 * Session 级上下文预算管理器。在 prompt 构造前估算各部分 token 开销，
 * 确保不会超出模型上下文窗口，优先保留核心内容。
 *
 * 设计参考 Codex CLI ContextManager 的 byte/token 预算策略。
 */

export interface ContextBudgetConfig {
  /** 模型上下文窗口 tokens（如 200000） */
  readonly modelContextWindow: number;
  /** 留给模型输出的 buffer tokens（默认 8000） */
  readonly outputReserve: number;
  /** system prompt 预算（默认 6000） */
  readonly systemPromptBudget: number;
  /** 经纬核心包预算（默认 4000） */
  readonly jingweiBriefBudget: number;
  /** 工具输出单条最大 tokens（默认 2000） */
  readonly toolOutputMaxTokens: number;
  /** 历史消息最低保留轮数 */
  readonly minHistoryTurns: number;
}

export interface ContextSlot {
  readonly name: string;
  readonly estimatedTokens: number;
  readonly priority: number;
  readonly required: boolean;
}

export interface BudgetAllocation {
  readonly totalBudget: number;
  readonly allocated: number;
  readonly remaining: number;
  readonly slots: ContextSlot[];
  readonly droppedSlots: ContextSlot[];
  readonly warnings: string[];
}

const DEFAULT_CONFIG: ContextBudgetConfig = {
  modelContextWindow: 200_000,
  outputReserve: 8_000,
  systemPromptBudget: 6_000,
  jingweiBriefBudget: 4_000,
  toolOutputMaxTokens: 2_000,
  minHistoryTurns: 3,
};

export function estimateTokensFromText(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length * 0.6);
}

export function truncateToolOutput(text: string, maxTokens: number): { text: string; truncated: boolean; originalTokens: number } {
  const originalTokens = estimateTokensFromText(text);
  if (originalTokens <= maxTokens) {
    return { text, truncated: false, originalTokens };
  }
  const maxChars = Math.floor(maxTokens / 0.6);
  const truncated = text.slice(0, maxChars).trimEnd();
  const suffix = `\n\n[... 输出已截断，原始约 ${originalTokens} tokens，保留前 ${maxTokens} tokens]`;
  return { text: truncated + suffix, truncated: true, originalTokens };
}

export function createContextBudgetManager(config: Partial<ContextBudgetConfig> = {}): ContextBudgetManager {
  return new ContextBudgetManager({ ...DEFAULT_CONFIG, ...config });
}

export class ContextBudgetManager {
  private readonly config: ContextBudgetConfig;

  constructor(config: ContextBudgetConfig) {
    this.config = config;
  }

  get totalBudget(): number {
    return this.config.modelContextWindow - this.config.outputReserve;
  }

  get jingweiBudget(): number {
    return this.config.jingweiBriefBudget;
  }

  get toolOutputMaxTokens(): number {
    return this.config.toolOutputMaxTokens;
  }

  /**
   * 估算当前上下文各部分占用，返回预算分配结果。
   */
  allocate(slots: ContextSlot[]): BudgetAllocation {
    const budget = this.totalBudget;
    const sorted = [...slots].sort((a, b) => b.priority - a.priority);
    const kept: ContextSlot[] = [];
    const dropped: ContextSlot[] = [];
    const warnings: string[] = [];
    let allocated = 0;

    for (const slot of sorted) {
      if (slot.required || allocated + slot.estimatedTokens <= budget) {
        kept.push(slot);
        allocated += slot.estimatedTokens;
      } else {
        dropped.push(slot);
      }
    }

    if (allocated > budget) {
      warnings.push(`上下文预算超出 ${allocated - budget} tokens（预算 ${budget}，已分配 ${allocated}）。`);
    }

    if (dropped.length > 0) {
      warnings.push(`${dropped.length} 个上下文块因预算限制被省略。`);
    }

    return {
      totalBudget: budget,
      allocated,
      remaining: Math.max(0, budget - allocated),
      slots: kept,
      droppedSlots: dropped,
      warnings,
    };
  }

  /**
   * 计算历史消息应保留多少 tokens。
   */
  historyBudget(systemTokens: number, jingweiTokens: number, toolPendingTokens: number): number {
    const used = systemTokens + jingweiTokens + toolPendingTokens;
    return Math.max(0, this.totalBudget - used);
  }

  /**
   * 截断工具输出。
   */
  truncateToolOutput(text: string): { text: string; truncated: boolean; originalTokens: number } {
    return truncateToolOutput(text, this.config.toolOutputMaxTokens);
  }

  /**
   * 判断是否应该触发 compaction。
   * 当历史消息预估 tokens 超过可用预算的 80% 时建议 compact。
   */
  shouldCompact(historyTokensEstimate: number, systemTokens: number, jingweiTokens: number): boolean {
    const available = this.historyBudget(systemTokens, jingweiTokens, 0);
    return historyTokensEstimate > available * 0.8;
  }

  /**
   * 返回当前配置摘要（用于日志/调试）。
   */
  describe(): string {
    return `ContextBudget: window=${this.config.modelContextWindow}, output_reserve=${this.config.outputReserve}, total_budget=${this.totalBudget}, jingwei=${this.config.jingweiBriefBudget}, tool_max=${this.config.toolOutputMaxTokens}`;
  }
}
