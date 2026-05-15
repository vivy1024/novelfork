// ---------------------------------------------------------------------------
// Variant Generator — 多版本对比 prompt 构建 / 结果解析
// ---------------------------------------------------------------------------

import type { InlineWriteContext, InlineWriteInput, InlineWriteResult } from "./inline-writer.js";

// ---- Types ----------------------------------------------------------------

export interface VariantInput extends InlineWriteInput {
  mode: "variant";
}

export interface VariantResult extends InlineWriteResult {
  variantIndex: number;
  styleTags: string[];
}

// ---- Prompt builder -------------------------------------------------------

const VARIANT_STYLES = [
  "保持原文风格，但换一种叙事节奏",
  "更加紧凑凌厉，短句为主",
  "更加细腻舒缓，注重氛围渲染",
  "增加内心独白和心理描写",
  "偏重对话和动作，减少叙述",
];

export function buildVariantPrompts(
  input: VariantInput,
  context: InlineWriteContext,
  count: number = 3,
): string[] {
  const base = [
    `## 上下文（第 ${context.chapterNumber} 章）`,
    `### 前文\n${context.beforeText}`,
    context.afterText ? `### 后文\n${context.afterText}` : "",
    context.styleGuide ? `## 文风指南\n${context.styleGuide}` : "",
    context.bookRules ? `## 书籍规则\n${context.bookRules}` : "",
    `## 原文\n${input.selectedText}`,
    input.direction ? `## 额外指示\n${input.direction}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompts: string[] = [];
  for (let i = 0; i < count; i++) {
    const styleHint = VARIANT_STYLES[i % VARIANT_STYLES.length];
    prompts.push(
      [
        `# 多版本改写任务（变体 ${i + 1}/${count}）`,
        `你是一位中文网文写作助手。请改写下面的原文，风格要求：${styleHint}。`,
        base,
        "## 输出要求",
        "- 直接输出改写后的内容",
        "- 保持核心情节和信息不变",
        "- 字数与原文相近（±20%）",
        `- 风格标签：${styleHint}`,
      ].join("\n\n"),
    );
  }
  return prompts;
}

// ---- Result parser --------------------------------------------------------

export function parseVariantResult(
  response: string,
  variantIndex: number,
): VariantResult {
  const content = response.trim();
  // 从 prompt 的风格标签中提取（简化实现：根据 index 映射）
  const styleTag = VARIANT_STYLES[variantIndex % VARIANT_STYLES.length];
  return {
    content,
    wordCount: content.length,
    mode: "variant",
    variantIndex,
    styleTags: [styleTag],
  };
}
