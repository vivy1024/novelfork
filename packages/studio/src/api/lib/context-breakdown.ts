/**
 * 上下文注入可视化 — 计算各部分 token 占用
 */
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { estimateTokensFromText } from "./ai-request-observer.js";
import { getSessionById } from "./session-service.js";
import { getSessionChatSnapshot } from "./session-chat-service.js";
import { getEnabledSessionTools } from "./session-tool-registry.js";

export interface ContextBreakdownPart {
  label: string;
  tokens: number;
  /** 内容摘要（前 200 字符） */
  preview: string;
}

export interface ContextBreakdown {
  totalTokens: number;
  maxTokens: number;
  /** 上次 API 实际报告的 input tokens（精确值） */
  lastApiInputTokens?: number;
  parts: ContextBreakdownPart[];
}

export async function getContextBreakdown(sessionId: string): Promise<ContextBreakdown | null> {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  const snapshot = await getSessionChatSnapshot(sessionId);
  const parts: ContextBreakdownPart[] = [];

  // 1. 系统提示词（agent prompt + TOOL_USE_GUIDELINES + write-next instructions）
  const systemPromptEstimate = 2000;
  parts.push({
    label: "系统提示词",
    tokens: systemPromptEstimate,
    preview: "Agent 角色提示词 + 工具使用指南 + 写作链路指令",
  });

  // 2. 项目规则（CLAUDE.md 等）
  const workDir = session.worktree?.trim() || process.cwd();
  let rulesContent = "";

  const globalRulesPath = join(homedir(), ".novelfork", "CLAUDE.md");
  try { if (existsSync(globalRulesPath)) rulesContent += readFileSync(globalRulesPath, "utf-8"); } catch { /* ignore */ }

  const projectRulesPath = join(workDir, "CLAUDE.md");
  try { if (existsSync(projectRulesPath)) rulesContent += readFileSync(projectRulesPath, "utf-8"); } catch { /* ignore */ }

  if (rulesContent) {
    parts.push({
      label: "项目规则 (CLAUDE.md)",
      tokens: estimateTokensFromText(rulesContent),
      preview: rulesContent.slice(0, 200),
    });
  }

  // 3. 工具定义（动态计算实际注册的工具数量和 schema 大小）
  const tools = getEnabledSessionTools(session.sessionConfig.permissionMode, session.agentId, {
    disabledTools: session.sessionConfig.toolPolicy?.deny,
  });
  // 每个工具的 schema JSON 大约 300-500 tokens，取实际工具数
  const toolCount = tools.length;
  const toolsTokens = Math.round(toolCount * 380);
  parts.push({
    label: `工具定义 (${toolCount} 个)`,
    tokens: toolsTokens,
    preview: tools.slice(0, 5).map(t => t.name).join(", ") + (toolCount > 5 ? ` 等 ${toolCount} 个` : ""),
  });

  // 4. 消息历史（应用 contextCutoffSeq 过滤）
  const contextCutoffSeq = session.sessionConfig.contextCutoffSeq ?? 0;
  if (snapshot) {
    const contextMessages = contextCutoffSeq > 0
      ? snapshot.messages.filter((m) => (m.seq ?? 0) > contextCutoffSeq)
      : snapshot.messages;
    const messagesContent = contextMessages
      .map(m => typeof m.content === "string" ? m.content : "")
      .join("");
    const messagesTokens = estimateTokensFromText(messagesContent);
    parts.push({
      label: `消息历史 (${contextMessages.length} 条)`,
      tokens: messagesTokens,
      preview: contextMessages.length > 0
        ? `最近: ${(contextMessages[contextMessages.length - 1]?.content ?? "").slice(0, 100)}`
        : contextCutoffSeq > 0 ? "已清空上下文（历史消息保留可查看）" : "无消息",
    });
  } else {
    parts.push({
      label: "消息历史 (0 条)",
      tokens: 0,
      preview: "无消息",
    });
  }

  // 5. 经纬注入（作品上下文）
  const projectId = session.projectId;
  if (projectId) {
    try {
      const { buildAgentContext } = await import("./agent-context.js");
      const bookContext = await buildAgentContext({ bookId: projectId });
      if (bookContext) {
        parts.push({
          label: "经纬注入 (作品上下文)",
          tokens: estimateTokensFromText(bookContext),
          preview: bookContext.slice(0, 200),
        });
      }
    } catch { /* non-fatal */ }
  }

  // 6. Goals
  const goals = session.goals;
  if (goals && goals.length > 0) {
    const goalsText = goals.map(g => g.objective || "").join("\n");
    parts.push({
      label: `目标 (${goals.length} 个)`,
      tokens: estimateTokensFromText(goalsText),
      preview: goalsText.slice(0, 200),
    });
  }

  // 7. 格式化开销（JSON 结构、role 标签、分隔符等）
  const formatOverhead = 800;
  parts.push({
    label: "格式化开销",
    tokens: formatOverhead,
    preview: "消息 JSON 结构、role 标签、工具调用格式等",
  });

  const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
  const maxTokens = session.sessionConfig.modelId
    ? (tools as Array<{ contextWindow?: number }>)[0]?.contextWindow ?? 200000
    : 200000;

  // 获取上次 API 实际报告的 input tokens
  const lastApiInputTokens = (session as { cumulativeUsage?: { lastInputTokens?: number } }).cumulativeUsage?.lastInputTokens;

  return { totalTokens, maxTokens: 1000000, lastApiInputTokens: lastApiInputTokens ?? undefined, parts };
}
