/**
 * Budget Pressure — 上下文压力提示注入。
 * 当上下文使用率较高时，自动在 system prompt 中注入提醒，
 * 引导 Agent 收敛当前任务。
 *
 * 参考 LegnaCLI budgetPressure.ts
 */

const PRESSURE_THRESHOLD = 0.80;   // 80% — 温和提示
const CRITICAL_THRESHOLD = 0.92;   // 92% — 紧急提示

/**
 * 获取上下文压力提示消息。
 * @param usageRatio 上下文使用率 (0-1)
 * @param roundCount 当前工具调用轮次（用于控制注入频率）
 * @returns 提示消息，null 表示不注入
 */
export function getBudgetPressureMessage(
  usageRatio: number,
  roundCount: number,
): string | null {
  if (usageRatio >= CRITICAL_THRESHOLD) {
    // 紧急：每轮注入
    return `[上下文即将耗尽：已用 ${Math.round(usageRatio * 100)}%。请立即总结当前任务结果，准备收尾。]`;
  }
  if (usageRatio >= PRESSURE_THRESHOLD) {
    // 温和：每 3 轮注入一次
    if (roundCount % 3 === 0) {
      return `[上下文压力提醒：已用 ${Math.round(usageRatio * 100)}%。建议尽快完成当前任务。]`;
    }
  }
  return null;
}
