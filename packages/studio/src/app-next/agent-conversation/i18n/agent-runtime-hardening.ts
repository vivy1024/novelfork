/**
 * Agent Runtime Hardening — i18n 翻译资源
 *
 * 本项目当前未使用 i18n 框架，此文件作为翻译资源参考。
 * 可直接 import 使用，或后续接入 i18next 等框架时作为 namespace 资源。
 */

export const agentRuntimeHardeningTranslations = {
  zh: {
    // Task 21: Settings
    "settings.agentRuntime.title": "Agent 运行时",
    "settings.agentRuntime.description": "运行时加固：YOLO 模式、循环检测、Token 消耗监控和连续失败保护。",
    "settings.agentRuntime.yoloMode.title": "YOLO 模式",
    "settings.agentRuntime.yoloMode.description": "全部允许模式下跳过所有确认，适合信任度高的场景。",
    "settings.agentRuntime.yoloMode.label": "YOLO 模式",
    "settings.agentRuntime.yoloMode.hint": "开启后 Agent 将跳过所有工具执行确认",
    "settings.agentRuntime.safetyReflection.label": "安全反思",
    "settings.agentRuntime.safetyReflection.hint": "即使在 YOLO 模式下，仍对高风险操作进行二次反思确认",
    "settings.agentRuntime.healthMonitor.title": "健康监控",
    "settings.agentRuntime.healthMonitor.description": "配置运行时健康检测的灵敏度和阈值。",
    "settings.agentRuntime.loopDetection.label": "循环检测灵敏度",
    "settings.agentRuntime.loopDetection.hint": "检测 Agent 陷入重复循环的灵敏度（0-100%，越高越敏感）",
    "settings.agentRuntime.tokenWarn.label": "Token 消耗警告阈值",
    "settings.agentRuntime.tokenWarn.hint": "单轮对话 Token 消耗达到上下文窗口此比例时发出警告（0-100%）",
    "settings.agentRuntime.maxFailures.label": "最大连续失败次数",
    "settings.agentRuntime.maxFailures.hint": "Agent 连续失败达到此次数时自动暂停（1-20）",

    // Task 22: Context menu
    "contextMenu.compactBefore": "压缩到此消息前",
    "contextMenu.rollback": "回退到此处",
    "contextMenu.fork": "从此处分叉",
    "contextMenu.editRegenerate": "编辑并重新生成",
    "contextMenu.delete": "删除",

    // Task 23: Continue button
    "session.continue": "继续",
    "session.interrupted": "已中断",

    // Task 24: Safety pause card
    "safetyPause.title": "安全暂停",
    "safetyPause.reason": "拒绝原因",
    "safetyPause.approve": "确认执行",
    "safetyPause.reject": "拒绝",
    "safetyPause.approved": "已确认执行",
    "safetyPause.rejected": "已拒绝",

    // Task 25: Compact progress
    "compact.progress": "正在压缩上下文... {progress}%",

    // Common
    "common.save": "保存变更",
    "common.saving": "保存中...",
    "common.cancel": "取消变更",
    "common.loading": "加载中...",
    "common.error": "错误",
    "common.percent": "%",
  },
  en: {
    // Task 21: Settings
    "settings.agentRuntime.title": "Agent Runtime",
    "settings.agentRuntime.description": "Runtime hardening: YOLO mode, loop detection, token consumption monitoring, and consecutive failure protection.",
    "settings.agentRuntime.yoloMode.title": "YOLO Mode",
    "settings.agentRuntime.yoloMode.description": "Skip all confirmations in allow-all mode, suitable for high-trust scenarios.",
    "settings.agentRuntime.yoloMode.label": "YOLO Mode",
    "settings.agentRuntime.yoloMode.hint": "Agent will skip all tool execution confirmations when enabled",
    "settings.agentRuntime.safetyReflection.label": "Safety Reflection",
    "settings.agentRuntime.safetyReflection.hint": "Still perform secondary reflection on high-risk operations even in YOLO mode",
    "settings.agentRuntime.healthMonitor.title": "Health Monitor",
    "settings.agentRuntime.healthMonitor.description": "Configure runtime health detection sensitivity and thresholds.",
    "settings.agentRuntime.loopDetection.label": "Loop Detection Sensitivity",
    "settings.agentRuntime.loopDetection.hint": "Sensitivity for detecting agent stuck in repetitive loops (0-100%, higher = more sensitive)",
    "settings.agentRuntime.tokenWarn.label": "Token Consumption Warning Threshold",
    "settings.agentRuntime.tokenWarn.hint": "Warn when single-turn token consumption reaches this percentage of context window (0-100%)",
    "settings.agentRuntime.maxFailures.label": "Max Consecutive Failures",
    "settings.agentRuntime.maxFailures.hint": "Auto-pause agent after this many consecutive failures (1-20)",

    // Task 22: Context menu
    "contextMenu.compactBefore": "Compact before this message",
    "contextMenu.rollback": "Rollback to here",
    "contextMenu.fork": "Fork from here",
    "contextMenu.editRegenerate": "Edit and regenerate",
    "contextMenu.delete": "Delete",

    // Task 23: Continue button
    "session.continue": "Continue",
    "session.interrupted": "Interrupted",

    // Task 24: Safety pause card
    "safetyPause.title": "Safety Pause",
    "safetyPause.reason": "Rejection reason",
    "safetyPause.approve": "Approve execution",
    "safetyPause.reject": "Reject",
    "safetyPause.approved": "Approved",
    "safetyPause.rejected": "Rejected",

    // Task 25: Compact progress
    "compact.progress": "Compacting context... {progress}%",

    // Common
    "common.save": "Save changes",
    "common.saving": "Saving...",
    "common.cancel": "Cancel changes",
    "common.loading": "Loading...",
    "common.error": "Error",
    "common.percent": "%",
  },
} as const;

export type AgentRuntimeHardeningTranslationKey = keyof typeof agentRuntimeHardeningTranslations.zh;

/**
 * Simple translation helper (no framework dependency).
 * Usage: t("safetyPause.title") → "安全暂停"
 */
export function t(key: AgentRuntimeHardeningTranslationKey, locale: "zh" | "en" = "zh", params?: Record<string, string | number>): string {
  const translations = agentRuntimeHardeningTranslations[locale];
  let text: string = translations[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
