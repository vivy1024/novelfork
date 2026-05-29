/**
 * YOLO mode: auto-approve safe/write tools, trigger safety reflection for dangerous ops.
 * Safety reflection: use the current conversation model (with full history) to judge
 * whether a dangerous operation is reasonable in context.
 */

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";

// --- Risk Classification ---

export type ToolRiskLevel = "safe" | "write" | "dangerous";

const TOOL_RISK_MAP: Record<string, ToolRiskLevel | "dynamic"> = {
  // safe — read-only operations
  Read: "safe",
  Glob: "safe",
  Grep: "safe",
  WebSearch: "safe",
  WebFetch: "safe",
  LearningGuide: "safe",
  GetGoals: "safe",
  Recall: "safe",

  // write — modification operations
  Write: "write",
  Edit: "write",
  Terminal: "write",
  AddGoal: "write",
  UpdateGoal: "write",
  TaskCreate: "write",

  // Bash is dynamic — classified by command content
  Bash: "dynamic",
};

/** Patterns that indicate a dangerous bash command */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+checkout\s+--\s/i,
  /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bnpm\s+publish\b/i,
  /\bcurl\s+.*\|\s*(bash|sh)\b/i,
  /\bchmod\s+777\b/i,
  /\bsudo\s+rm\b/i,
];

/**
 * Classify the risk level of a tool call.
 */
export function classifyToolRisk(toolName: string, toolInput: Record<string, unknown>): ToolRiskLevel {
  const mapped = TOOL_RISK_MAP[toolName];

  if (mapped && mapped !== "dynamic") {
    return mapped as ToolRiskLevel;
  }

  // Bash: classify by command content
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return "dangerous";
      }
    }
    return "write";
  }

  // Unknown tools default to write (require confirmation in non-YOLO)
  return "write";
}

// --- Safety Reflection ---

export interface SafetyReflectionResult {
  decision: "approve" | "reject";
  reason: string;
}

export interface SafetyReflectionOptions {
  toolName: string;
  toolInput: Record<string, unknown>;
  conversationHistory: NarratorSessionChatMessage[];
  generateFn: (messages: Array<{ role: string; content: string }>, options: { maxTokens: number; signal?: AbortSignal }) => Promise<string>;
  timeoutMs?: number;
}

/**
 * Build the reflection prompt for the model to judge a dangerous operation.
 */
function buildReflectionPrompt(toolName: string, toolInput: Record<string, unknown>): string {
  const inputStr = JSON.stringify(toolInput, null, 2);
  // Truncate very long inputs to avoid blowing up context
  const truncatedInput = inputStr.length > 2000 ? inputStr.slice(0, 2000) + "\n...(truncated)" : inputStr;

  return `[安全反思] 你即将执行以下操作：
工具：${toolName}
参数：${truncatedInput}

请判断这个操作在当前任务上下文中是否合理且安全。
- 如果合理且符合用户意图，回答：APPROVE
- 如果不合理、有风险或不符合当前任务，回答：REJECT: <简短原因>

只回答 APPROVE 或 REJECT: <原因>，不要其他内容。`;
}

/**
 * Parse the model's reflection response.
 */
function parseReflectionResponse(response: string): SafetyReflectionResult {
  const trimmed = response.trim();

  if (trimmed.startsWith("APPROVE")) {
    return { decision: "approve", reason: "模型判定操作合理" };
  }

  if (trimmed.startsWith("REJECT")) {
    const reason = trimmed.replace(/^REJECT:?\s*/i, "").trim() || "模型判定操作不合理";
    return { decision: "reject", reason };
  }

  // Ambiguous response — default to reject for safety
  return { decision: "reject", reason: `模型响应不明确: "${trimmed.slice(0, 100)}"` };
}

/**
 * Perform safety reflection using the current conversation model with full history.
 * The reflection result is NOT appended to conversation history.
 */
export async function performSafetyReflection(options: SafetyReflectionOptions): Promise<SafetyReflectionResult> {
  const { toolName, toolInput, conversationHistory, generateFn, timeoutMs = 15_000 } = options;

  const reflectionPrompt = buildReflectionPrompt(toolName, toolInput);

  // Build messages: full conversation history + reflection prompt
  const messages: Array<{ role: string; content: string }> = [
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: reflectionPrompt },
  ];

  try {
    const response = await generateFn(messages, {
      maxTokens: 200,
      signal: AbortSignal.timeout(timeoutMs),
    });

    return parseReflectionResponse(response);
  } catch (error: unknown) {
    // Timeout or generation failure — default to reject (let user decide)
    const message = error instanceof Error ? error.message : String(error);
    return { decision: "reject", reason: `安全反思失败: ${message}` };
  }
}

// --- YOLO Decision ---

export interface YoloDecisionOptions {
  toolName: string;
  toolInput: Record<string, unknown>;
  yoloEnabled: boolean;
  safetyReflectionEnabled: boolean;
}

export type YoloDecision =
  | { action: "auto-approve" }
  | { action: "reflect"; riskLevel: "dangerous" }
  | { action: "ask-user"; riskLevel: ToolRiskLevel };

/**
 * Determine what to do with a tool call under YOLO mode settings.
 *
 * Returns:
 * - auto-approve: execute without asking
 * - reflect: trigger safety reflection (dangerous op in YOLO mode)
 * - ask-user: show confirmation to user (non-YOLO or reflection disabled)
 */
export function getYoloDecision(options: YoloDecisionOptions): YoloDecision {
  const { toolName, toolInput, yoloEnabled, safetyReflectionEnabled } = options;
  const riskLevel = classifyToolRisk(toolName, toolInput);

  if (!yoloEnabled) {
    // Non-YOLO: safe tools auto-approve, everything else asks user
    if (riskLevel === "safe") {
      return { action: "auto-approve" };
    }
    return { action: "ask-user", riskLevel };
  }

  // YOLO mode enabled
  switch (riskLevel) {
    case "safe":
    case "write":
      return { action: "auto-approve" };
    case "dangerous":
      if (safetyReflectionEnabled) {
        return { action: "reflect", riskLevel: "dangerous" };
      }
      // Safety reflection disabled — ask user for dangerous ops
      return { action: "ask-user", riskLevel: "dangerous" };
  }
}
