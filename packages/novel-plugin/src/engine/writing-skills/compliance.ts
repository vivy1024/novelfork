/**
 * Writing Skills 声明式合规检查的**唯一**判定实现。
 *
 * 单一权威源纪律：出口硬拦（`writing-skills.check_compliance` →
 * `writing-skill-compliance-failed`）与写前/审修阶段下发的「硬性约束摘要」
 * 必须读同一份 `ParsedWritingSkill.checks`，并复用这里的 `describeCheck` /
 * `evaluateCheck`。禁止在提示词里另写一套「技能要求」表述：那样一旦分叉，
 * 模型按摘要写、出口按 checks 判，就会出现「照做了还是被拦」。
 */

import type {
  ParsedWritingSkill,
  WritingSkillComplianceCheck,
} from "./types.js";

/** 未显式声明 severity 的检查按 warning 处理（与出口判定一致）。 */
export function checkSeverity(check: WritingSkillComplianceCheck): "warning" | "error" {
  return check.severity ?? "warning";
}

/** 稳定的 check 标识；出口违规回报与摘要引用同一套 id。 */
export function checkId(check: WritingSkillComplianceCheck, index: number): string {
  return check.id?.trim() || `${check.type}-${index + 1}`;
}

/** 把一条 check 表述成人可读规则；出口违规文案与写前摘要共用。 */
export function describeCheck(check: WritingSkillComplianceCheck): string {
  switch (check.type) {
    case "required-terms":
      return `必须出现：${check.terms.join("、")}${
        check.minOccurrences && check.minOccurrences > 1 ? `（每项至少 ${check.minOccurrences} 次）` : ""
      }`;
    case "forbidden-terms":
      return `不得出现：${check.terms.join("、")}`;
    case "pattern":
      return `模式匹配：${check.pattern}${
        check.minMatches !== undefined ? `（至少 ${check.minMatches} 次）` : ""
      }${check.maxMatches !== undefined ? `（至多 ${check.maxMatches} 次）` : ""}`;
  }
}

function occurrences(content: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = content.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

/**
 * loader 已在解析阶段拒绝 lookaround、回溯引用与嵌套量词，因此这里只按已校验的
 * 声明编译一次；仍旧不接受 g/y 之外的有状态标志。
 */
function compilePattern(check: { readonly pattern: string; readonly flags?: string }): RegExp | null {
  try {
    return new RegExp(check.pattern, `g${(check.flags ?? "").replace(/[^im]/gu, "")}`);
  } catch {
    return null;
  }
}

/** 返回违规描述；通过检查时返回 null。出口硬拦与自检共用这一个判定。 */
export function evaluateCheck(content: string, check: WritingSkillComplianceCheck): string | null {
  if (check.type === "required-terms") {
    const minimum = check.minOccurrences ?? 1;
    const missing = check.terms.filter((term) => occurrences(content, term) < minimum);
    return missing.length > 0
      ? `缺少要求的词项：${missing.join("、")}${minimum > 1 ? `（每项至少 ${minimum} 次）` : ""}`
      : null;
  }
  if (check.type === "forbidden-terms") {
    const hits = check.terms.filter((term) => content.includes(term));
    return hits.length > 0 ? `命中禁止词项：${hits.join("、")}` : null;
  }
  const pattern = compilePattern(check);
  if (!pattern) return null;
  const matches = content.match(pattern) ?? [];
  const minMatches = check.minMatches ?? 1;
  if (matches.length < minMatches) {
    return `模式匹配 ${matches.length} 次，少于要求的 ${minMatches} 次`;
  }
  if (check.maxMatches !== undefined && matches.length > check.maxMatches) {
    return `模式匹配 ${matches.length} 次，超过允许的 ${check.maxMatches} 次（例如「${matches[0]?.slice(0, 120) ?? ""}」）`;
  }
  return null;
}

/** 单条硬性约束条目：直接对应一条可机器判定的 check。 */
export interface WritingSkillConstraintItem {
  readonly skillId: string;
  readonly skillSlug: string;
  readonly skillName: string;
  readonly checkId: string;
  /** describeCheck 的输出；与出口违规文案里的 rule 完全一致。 */
  readonly rule: string;
  /** error = 出口会拒绝保存；warning = 出口只提醒。 */
  readonly severity: "warning" | "error";
  /** 技能作者写的失败说明（若有），用于说明「为什么这么要求」。 */
  readonly message?: string;
}

/** 传给 scene.spec / reviser 的硬性约束摘要（结构化，不含技能正文）。 */
export interface WritingSkillConstraintDigest {
  /** 有声明式 check 的技能数量。 */
  readonly skillCount: number;
  /** severity=error 的条目数；这些在出口会直接拒绝保存。 */
  readonly blockingCount: number;
  readonly items: readonly WritingSkillConstraintItem[];
}

export const EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST: WritingSkillConstraintDigest = {
  skillCount: 0,
  blockingCount: 0,
  items: [],
};

/** 摘要默认上限：避免启用大量技能时把提示词撑爆。error 条目优先保留。 */
export const DEFAULT_CONSTRAINT_DIGEST_LIMIT = 40;

/**
 * 从已启用技能构建硬性约束摘要。
 *
 * 只取 `checks` 里可机器判定的条目 —— 也就是出口 `writing-skill-compliance-failed`
 * 真正会拿来判的东西。技能正文（方法论、示例、解释）不进摘要：正文由 Runtime 的
 * Skill 机制交给 agent 自主选择读取，管线不代为注入。
 */
export function buildWritingSkillConstraintDigest(
  skills: readonly ParsedWritingSkill[],
  options?: { readonly limit?: number },
): WritingSkillConstraintDigest {
  const all: WritingSkillConstraintItem[] = [];
  let skillCount = 0;
  for (const skill of skills) {
    const checks = skill.checks ?? [];
    if (checks.length === 0) continue;
    skillCount += 1;
    for (const [index, check] of checks.entries()) {
      all.push({
        skillId: skill.id,
        skillSlug: skill.slug,
        skillName: skill.name,
        checkId: checkId(check, index),
        rule: describeCheck(check),
        severity: checkSeverity(check),
        ...(check.message?.trim() ? { message: check.message.trim() } : {}),
      });
    }
  }

  const blockingCount = all.filter((item) => item.severity === "error").length;
  const limit = options?.limit ?? DEFAULT_CONSTRAINT_DIGEST_LIMIT;
  // 超限时保留全部 error（它们会拦保存），再按顺序补 warning。
  const items = all.length <= limit
    ? all
    : [
        ...all.filter((item) => item.severity === "error"),
        ...all.filter((item) => item.severity === "warning"),
      ].slice(0, limit);

  return { skillCount, blockingCount, items };
}

/**
 * 把摘要渲染成提示词可用的文本行。
 *
 * 只输出规则本身与「违反会怎样」，不复述技能方法论，保持与出口判据一字不差。
 */
export function renderWritingSkillConstraintDigest(
  digest: WritingSkillConstraintDigest,
): string {
  if (digest.items.length === 0) return "";
  const lines = digest.items.map((item) => {
    const gate = item.severity === "error" ? "硬性（违反将拒绝保存）" : "提醒";
    return `- [${gate}]《${item.skillName}》${item.rule}${item.message ? `｜说明：${item.message}` : ""}`;
  });
  const head = `已启用 Writing Skills 的可机器校验条目共 ${digest.items.length} 条${
    digest.blockingCount > 0 ? `，其中 ${digest.blockingCount} 条为硬性` : ""
  }。这些条目在章节保存前会被逐条校验（writing-skills.check_compliance），请在写作/修稿时直接满足：`;
  return `${head}\n${lines.join("\n")}`;
}

/** 摘要压成 sceneSpec.constraints 可用的短行；每条对应一个 check。 */
export function toSceneSpecConstraintLines(
  digest: WritingSkillConstraintDigest,
): readonly string[] {
  return digest.items.map((item) => (
    `${item.severity === "error" ? "技能硬性约束" : "技能约束提醒"}｜${item.skillName}：${item.rule}`
  ));
}
