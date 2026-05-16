/**
 * 上下文注入可视化 — 计算各部分 token 占用
 */
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { estimateTokensFromText } from "./ai-request-observer.js";
import { getSessionById } from "./session-service.js";
import { getSessionChatSnapshot } from "./session-chat-service.js";

export interface ContextBreakdownPart {
  label: string;
  tokens: number;
  /** 内容摘要（前 200 字符） */
  preview: string;
}

export interface ContextBreakdown {
  totalTokens: number;
  maxTokens: number;
  parts: ContextBreakdownPart[];
}

export async function getContextBreakdown(sessionId: string): Promise<ContextBreakdown | null> {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  const snapshot = await getSessionChatSnapshot(sessionId);
  const parts: ContextBreakdownPart[] = [];

  // 1. 系统提示词（估算基础 system prompt）
  // AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS 是内部常量，这里用固定估算
  const systemPromptEstimate = 350;
  parts.push({
    label: "系统提示词",
    tokens: systemPromptEstimate,
    preview: "Agent-native 写作链路指令 + 基础系统提示",
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

  // 3. 工具定义（从 session 配置推算）
  // 每个工具定义大约 300-400 tokens
  const toolEstimatePerTool = 350;
  // 基础工具集约 20 个
  const toolCount = 20;
  const toolsTokens = toolCount * toolEstimatePerTool;
  parts.push({
    label: `工具定义 (~${toolCount} 个)`,
    tokens: toolsTokens,
    preview: `${toolCount} 个工具已注册（Read/Write/Edit/Bash/Grep/Glob 等）`,
  });

  // 4. 消息历史
  if (snapshot) {
    const messagesContent = snapshot.messages
      .map(m => typeof m.content === "string" ? m.content : "")
      .join("");
    const messagesTokens = estimateTokensFromText(messagesContent);
    parts.push({
      label: `消息历史 (${snapshot.messages.length} 条)`,
      tokens: messagesTokens,
      preview: snapshot.messages.length > 0
        ? `最近: ${(snapshot.messages[snapshot.messages.length - 1]?.content ?? "").slice(0, 100)}`
        : "无消息",
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

  const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
  const maxTokens = 200000;

  return { totalTokens, maxTokens, parts };
}
