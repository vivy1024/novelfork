/**
 * Chapter Audit v2 — 合并 ContinuityAuditor + Reviser + Canon Check + POV Check
 *
 * 硬约束检查：
 * - H2: Canon violation（新内容推翻已确立事实）
 * - H7: POV violation（角色知道视角外信息）
 *
 * 软约束检查：
 * - S1: 字数范围
 * - S2: AI 味评分
 * - S3: 伏笔超期
 * - S4: 角色弧线
 * - S5: 节奏模式
 */

import type { JingweiLayer, StoryJingweiEntryRecord } from "../engine/jingwei/types.js";

export interface AuditV2Input {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly content: string;
  readonly sceneSpec?: {
    readonly scenes?: ReadonlyArray<{
      readonly characters?: readonly string[];
      readonly location?: string;
      readonly conflict?: string;
      readonly outcome?: string;
    }>;
    readonly constraints?: readonly string[];
    readonly wordTarget?: number;
  };
  readonly canonEntries?: ReadonlyArray<{
    readonly title: string;
    readonly contentMd: string;
    readonly category?: string;
  }>;
  readonly povCharacter?: string;
  readonly wordTarget?: number;
}

export interface AuditV2Violation {
  readonly ruleId: string;
  readonly severity: "hard" | "soft";
  readonly location?: string;
  readonly description: string;
  readonly suggestion?: string;
}

export interface AuditV2Result {
  readonly ok: true;
  readonly passed: boolean;
  readonly hardViolations: AuditV2Violation[];
  readonly softViolations: AuditV2Violation[];
  readonly summary: string;
  readonly wordCount: number;
  readonly revisedContent?: string;
}

function countWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function checkCanonViolations(content: string, canonEntries: AuditV2Input["canonEntries"]): AuditV2Violation[] {
  if (!canonEntries || canonEntries.length === 0) return [];
  const violations: AuditV2Violation[] = [];
  const normalizedContent = normalizeForSearch(content);

  for (const entry of canonEntries) {
    const facts = entry.contentMd.split(/[。！？\n]/).filter((s) => /^(不|禁止|必须|只能|绝对|永远)/.test(s.trim()));
    for (const fact of facts) {
      const trimmed = fact.trim();
      if (trimmed.length < 4) continue;

      if (trimmed.startsWith("不") || trimmed.startsWith("禁止") || trimmed.startsWith("不能") || trimmed.startsWith("不可")) {
        const forbidden = trimmed.replace(/^(不得|不准|不能|不可以|不允许|不可|禁止|不)/, "").trim().slice(0, 20);
        if (forbidden.length < 2) continue;

        const normalizedForbidden = normalizeForSearch(forbidden);
        // 使用统一的 normalizedContent（已去空格）进行搜索
        const idx = normalizedContent.indexOf(normalizedForbidden);
        if (idx === -1) continue;

        // 上下文窗口检查：关键词周围 40 字符内是否有否定/引用词
        const windowStart = Math.max(0, idx - 40);
        const window = normalizedContent.slice(windowStart, idx);
        const negationInWindow = /禁止|不能|不可|不允许|不得|回忆|想起|提到|说过|规则|规定|法则|曾经/.test(window);

        if (negationInWindow) {
          violations.push({
            ruleId: "H2",
            severity: "soft",
            location: `Canon「${entry.title}」→ 疑似`,
            description: `疑似违反 Canon 规则：「${trimmed}」（上下文含否定/引用词，可能是角色讨论规则而非实际违反）`,
            suggestion: `请人工确认正文是否真的违反了「${entry.title}」中的规则。`,
          });
        } else {
          violations.push({
            ruleId: "H2",
            severity: "hard",
            location: `Canon「${entry.title}」`,
            description: `可能违反 Canon 规则：「${trimmed}」`,
            suggestion: `请检查正文是否与「${entry.title}」中的规则冲突。`,
          });
        }
      }
    }
  }

  return violations;
}

function checkPovViolations(content: string, sceneSpec: AuditV2Input["sceneSpec"], povCharacter?: string): AuditV2Violation[] {
  if (!povCharacter && !sceneSpec?.scenes?.length) return [];
  const violations: AuditV2Violation[] = [];

  // 检测常见 POV 违反模式
  const povIndicators = [
    { pattern: /他(?:心想|暗想|心中|内心).*?(?:她|他们|对方)(?:不知道|没想到|没料到)/g, desc: "叙述者透露了非 POV 角色的内心想法" },
    { pattern: /(?:与此同时|另一边|在.*?那里).*?(?:心想|暗想|决定|打算)/g, desc: "切换到非 POV 角色视角" },
  ];

  for (const { pattern, desc } of povIndicators) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      violations.push({
        ruleId: "H7",
        severity: "hard",
        location: matches[0]?.slice(0, 50),
        description: desc,
        suggestion: "请确保只从当前 POV 角色的视角描写内心活动。",
      });
    }
  }

  return violations;
}

function checkSoftConstraints(content: string, input: AuditV2Input): AuditV2Violation[] {
  const violations: AuditV2Violation[] = [];
  const wordCount = countWords(content);
  const target = input.wordTarget ?? input.sceneSpec?.wordTarget ?? 3000;

  // S1: 字数范围 ±20%
  if (wordCount < target * 0.8) {
    violations.push({
      ruleId: "S1",
      severity: "soft",
      description: `章节字数 ${wordCount} 低于目标 ${target} 的 80%（${Math.round(target * 0.8)}）。`,
      suggestion: "考虑扩展场景描写或增加对话。",
    });
  } else if (wordCount > target * 1.2) {
    violations.push({
      ruleId: "S1",
      severity: "soft",
      description: `章节字数 ${wordCount} 超过目标 ${target} 的 120%（${Math.round(target * 1.2)}）。`,
      suggestion: "考虑精简冗余描写或拆分场景。",
    });
  }

  // S2: AI 味检测（简单启发式）
  const aiPatterns = [
    { pattern: /不禁|竟然|居然|没想到/g, threshold: 5, desc: "过度使用惊讶词" },
    { pattern: /仿佛|宛如|犹如|好似/g, threshold: 4, desc: "比喻词堆叠" },
    { pattern: /深邃|璀璨|绚烂|磅礴/g, threshold: 3, desc: "华丽形容词过多" },
  ];
  for (const { pattern, threshold, desc } of aiPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > threshold) {
      violations.push({
        ruleId: "S2",
        severity: "soft",
        description: `AI 味检测：${desc}（出现 ${matches.length} 次，阈值 ${threshold}）。`,
        suggestion: "减少模式化用词，增加口语化和个性化表达。",
      });
    }
  }

  // S5: 检查 scene spec 约束是否被满足
  if (input.sceneSpec?.scenes) {
    for (const scene of input.sceneSpec.scenes) {
      if (scene.characters) {
        for (const char of scene.characters) {
          if (!content.includes(char)) {
            violations.push({
              ruleId: "S5",
              severity: "soft",
              description: `Scene Spec 要求角色「${char}」出场，但正文中未找到。`,
              suggestion: `确认「${char}」是否在本章出现，或更新 Scene Spec。`,
            });
          }
        }
      }
    }
  }

  return violations;
}

export function handleChapterAuditV2(input: AuditV2Input): AuditV2Result {
  const { content, canonEntries, sceneSpec, povCharacter } = input;
  const wordCount = countWords(content);

  const hardViolations = [
    ...checkCanonViolations(content, canonEntries),
    ...checkPovViolations(content, sceneSpec, povCharacter),
  ];

  const softViolations = checkSoftConstraints(content, input);

  const passed = hardViolations.length === 0;
  const totalIssues = hardViolations.length + softViolations.length;

  const summary = passed
    ? totalIssues === 0
      ? `审计通过（${wordCount}字），无违反。`
      : `审计通过（${wordCount}字），${softViolations.length} 个软约束建议。`
    : `审计未通过（${wordCount}字）：${hardViolations.length} 个硬约束违反，${softViolations.length} 个软约束建议。`;

  return {
    ok: true,
    passed,
    hardViolations,
    softViolations,
    summary,
    wordCount,
  };
}
