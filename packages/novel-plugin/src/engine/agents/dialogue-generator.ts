// ---------------------------------------------------------------------------
// Dialogue Generator — 对话生成 prompt 构建 / 结果解析
// ---------------------------------------------------------------------------

import type { InlineWriteContext, InlineWriteResult } from "./inline-writer.js";

// ---- Types ----------------------------------------------------------------

export interface DialogueCharacter {
  name: string;
  personality?: string;
  speechStyle?: string;
}

export interface DialogueInput {
  characters: DialogueCharacter[];
  scene: string;
  purpose: string;
  /** 期望对话轮次 */
  turns: number;
  direction?: string;
}

export interface DialogueLine {
  character: string;
  line: string;
  action?: string;
}

export interface DialogueResult extends InlineWriteResult {
  lines: DialogueLine[];
}

// ---- Prompt builder -------------------------------------------------------

function buildCharacterBlock(characters: DialogueCharacter[]): string {
  return characters
    .map((c) => {
      const parts = [`- **${c.name}**`];
      if (c.personality) parts.push(`  性格：${c.personality}`);
      if (c.speechStyle) parts.push(`  说话风格：${c.speechStyle}`);
      return parts.join("\n");
    })
    .join("\n");
}

export function buildDialoguePrompt(
  input: DialogueInput,
  context: InlineWriteContext,
): string {
  return [
    "# 对话生成任务",
    "你是一位中文网文写作助手。请根据场景和角色设定生成自然、有张力的对话。",
    `## 上下文（第 ${context.chapterNumber} 章）`,
    `### 前文\n${context.beforeText}`,
    context.afterText ? `### 后文\n${context.afterText}` : "",
    context.styleGuide ? `## 文风指南\n${context.styleGuide}` : "",
    context.bookRules ? `## 书籍规则\n${context.bookRules}` : "",
    `## 角色\n${buildCharacterBlock(input.characters)}`,
    `## 场景\n${input.scene}`,
    `## 对话目的\n${input.purpose}`,
    input.direction ? `## 额外指示\n${input.direction}` : "",
    "## 输出格式",
    `- 生成约 ${input.turns} 轮对话`,
    "- 每行格式：角色名「对话内容」（动作描写）",
    "- 动作描写用括号包裹，可省略",
    "- 对话要体现角色性格差异，避免千人一面",
    "- 适当穿插神态、动作描写，不要纯对话",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---- Result parser --------------------------------------------------------

const DIALOGUE_LINE_RE = /^(.+?)[「""](.+?)[」""](?:\s*[（(](.+?)[）)])?$/;

export function parseDialogueResult(response: string): DialogueResult {
  const lines: DialogueLine[] = [];
  for (const raw of response.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = DIALOGUE_LINE_RE.exec(trimmed);
    if (match) {
      lines.push({
        character: match[1].trim(),
        line: match[2],
        action: match[3]?.trim(),
      });
    }
  }

  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "dialogue",
    lines,
  };
}
