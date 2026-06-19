/**
 * PolisherAgent — prose-only surface polish after structure is accepted.
 *
 * ONLY touches: sentence craft, paragraph shape, wording, punctuation,
 * five-sense immersion, dialogue naturalness.
 *
 * FORBIDDEN from: changing plot, character setup, mainline, chapter structure.
 *
 * If a structural issue is found, marks it as [polisher-note] at chapter end
 * for the reviewer — does NOT attempt to fix it.
 *
 * Ported from InkOS polisher.ts with NovelFork tool interface.
 */

export interface PolishChapterInput {
  content: string;
  chapterNumber: number;
  language?: "zh" | "en";
}

export interface PolishChapterOutput {
  polishedContent: string;
  changed: boolean;
  notes: string[]; // [polisher-note] lines extracted from output
}

const POLISHER_SYSTEM_PROMPT_ZH = `你是一位专业中文网文文字层润色编辑。

## 润色边界（硬约束）

你只改文字层——句式 / 段落 / 排版 / 用词 / 五感 / 对话自然度。你禁止增删情节、改变人设、调整主线。发现情节/结构问题只能以 [polisher-note] 形式附在章末供下一轮 reviewer 参考，不能动正文。

## 6 条文笔类雷点（你要消灭的）

- 描写无效：冗长的环境描写、与主线无关的对话塞满页面。把无效描写删到"一笔带过"。
- 文笔华丽过度：为辞藻堆辞藻，情感失真，形容词地毯轰炸。让文字服从情绪，不要炫技。
- 文笔欠佳：句意含混、指代不清、逻辑跳跃、语言干瘪。重写成通顺、有画面感的句子。
- 排版不规范：段落过长、格式不统一、对话无换行。统一为手机阅读友好格式。
- AI 味痕迹：转折词泛滥、"了"字堆砌、"仿佛/宛如/竟然"等情绪中介词、编剧旁白。替换成口语化表达或具体动作。
- 群像脸谱化：不写"众人齐声惊呼"，而是挑 1-2 个角色写具体反应。

## 文字层硬规约

- 段落：3-5 行/段（手机阅读），连续 7 行以上必须拆段
- 句式：多样化，禁止连续 3 句以上同结构/同主语开头
- 动词 > 形容词：名词+动词驱动画面
- 五感代入：每个场景至少 1-2 种感官细节
- 情绪外化：把"他感到愤怒"改为"他捏碎了茶杯"
- 删除无意义的叙述者结论和 AI 标记词

## 输出契约

直接返回润色后的完整章节正文——不要 JSON、不要章节标题行、不要任何解释。如果发现必须交给 reviewer 的情节/结构问题，在正文末尾另起一行以 "[polisher-note] " 开头写明。保留原文绝大多数句子，只改真正有问题的句子。`;

const POLISHER_SYSTEM_PROMPT_EN = `You are a professional prose editor for web fiction.

## Editing Boundaries (Hard Constraints)

You ONLY touch the prose layer — sentence craft, paragraph shape, wording, punctuation, five-sense immersion, dialogue naturalness. You are FORBIDDEN from adding/removing plot, changing character setup, or adjusting the main storyline. If you spot a structural issue, append it as a [polisher-note] at the end for the reviewer — do NOT touch the prose itself.

## Output Contract

Return the polished chapter in full — no JSON, no chapter title line, no explanations. If you find a structural issue the reviewer must see, append a line at the end starting with "[polisher-note] ". Preserve the vast majority of sentences; only rewrite genuinely problematic ones.`;

/**
 * Build the system + user prompt for polishing a chapter.
 */
export function buildPolisherPrompt(
  content: string,
  chapterNumber: number,
  language: "zh" | "en" = "zh",
): { system: string; user: string } {
  const system =
    language === "zh" ? POLISHER_SYSTEM_PROMPT_ZH : POLISHER_SYSTEM_PROMPT_EN;
  const user =
    language === "zh"
      ? `请润色第${chapterNumber}章。只返回完整的润色后正文。\n\n## 待润色章节\n${content}`
      : `Polish chapter ${chapterNumber}. Return the polished chapter in full.\n\n## Chapter Under Polish\n${content}`;
  return { system, user };
}

/**
 * Extract [polisher-note] lines from polisher output.
 */
export function extractPolisherNotes(content: string): {
  cleanContent: string;
  notes: string[];
} {
  const noteRegex = /\[polisher-note\]\s*(.+)/g;
  const notes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = noteRegex.exec(content)) !== null) {
    notes.push(match[1].trim());
  }
  // Remove notes from content
  const cleanContent = content
    .replace(/\[polisher-note\]\s*.+\n?/g, "")
    .trimEnd();
  return { cleanContent, notes };
}
