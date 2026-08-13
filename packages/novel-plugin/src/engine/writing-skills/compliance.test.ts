/**
 * Writing Skills 硬性约束摘要的契约测试。
 *
 * 这里最关键的一条是「同源」：传给 scene.spec 的约束摘要，必须和出口
 * `writing-skills.check_compliance` 拒绝保存时用的判据是同一份。两者一旦分叉，
 * 就会出现「入口按 A 提示、出口按 B 拒绝」，作者永远修不对。
 */

import { describe, expect, it } from "vitest";
import type { ParsedWritingSkill, WritingSkillComplianceCheck } from "./types.js";
import {
  buildWritingSkillConstraintDigest,
  checkSeverity,
  describeCheck,
  evaluateCheck,
  renderWritingSkillConstraintDigest,
  toSceneSpecConstraintLines,
  DEFAULT_CONSTRAINT_DIGEST_LIMIT,
  EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST,
} from "./compliance.js";

function skill(slug: string, checks: readonly WritingSkillComplianceCheck[]): ParsedWritingSkill {
  return {
    id: `nf-${slug}`,
    slug: `nf-${slug}`,
    name: `技能 ${slug}`,
    description: `${slug} 的描述`,
    kind: "workflow",
    body: "# 方法论正文\n这段正文不应该进入摘要。",
    source: "bundled",
    mode: "manual",
    checks,
  } as ParsedWritingSkill;
}

const forbidden: WritingSkillComplianceCheck = {
  type: "forbidden-terms",
  terms: ["忽然之间"],
  severity: "error",
  message: "禁用套话",
};

const required: WritingSkillComplianceCheck = {
  type: "required-terms",
  terms: ["钩子"],
  severity: "warning",
};

describe("Writing Skills 约束摘要", () => {
  it("只收 checks 里可机器判定的条目，不带技能正文", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden])]);

    expect(digest.skillCount).toBe(1);
    expect(digest.items).toHaveLength(1);
    // 正文（方法论）绝不能被管线代为注入：它由 Runtime 的 Skill 机制交给 agent 自主读取。
    expect(JSON.stringify(digest)).not.toContain("方法论正文");
  });

  it("blockingCount 只数 severity=error（即出口会拒绝保存的那些）", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden, required])]);

    expect(digest.items).toHaveLength(2);
    expect(digest.blockingCount).toBe(1);
  });

  it("没有声明 checks 的技能不计入 skillCount", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", []), skill("b", [forbidden])]);

    expect(digest.skillCount).toBe(1);
  });

  it("超过上限时优先保留 error 条目", () => {
    const many: WritingSkillComplianceCheck[] = Array.from({ length: DEFAULT_CONSTRAINT_DIGEST_LIMIT + 5 }, () => required);
    const digest = buildWritingSkillConstraintDigest([skill("soft", many), skill("hard", [forbidden])], {
      limit: 3,
    });

    expect(digest.items).toHaveLength(3);
    // 硬性条目不能因为软条目太多而被挤掉——挤掉就等于出口会拦但入口没提示。
    expect(digest.items.some((item) => item.severity === "error")).toBe(true);
  });

  it("空技能列表得到 EMPTY 摘要", () => {
    expect(buildWritingSkillConstraintDigest([])).toEqual(EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST);
  });
});

describe("与出口合规校验同源", () => {
  it("摘要里的 rule 与 severity 来自出口使用的同一组判定函数", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden])]);
    const item = digest.items[0]!;

    // 出口 handleWritingSkillsCheckCompliance 报违规时，rule 用 describeCheck、
    // severity 用 checkSeverity。摘要必须逐字一致，否则两侧口径分叉。
    expect(item.rule).toBe(describeCheck(forbidden));
    expect(item.severity).toBe(checkSeverity(forbidden));
  });

  it("摘要声明为 error 的条目，出口 evaluateCheck 确实会判违规", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden])]);
    const blocking = digest.items.filter((item) => item.severity === "error");
    expect(blocking).toHaveLength(1);

    // 入口说会拦，出口就必须真的拦。
    expect(evaluateCheck("忽然之间他明白了。", forbidden)).toBeTruthy();
    // 反之，满足约束的正文不该被判违规。
    expect(evaluateCheck("他慢慢明白了。", forbidden)).toBeNull();
  });

  it("severity 缺省时两侧都视为 warning，不会一边当 error", () => {
    const noSeverity: WritingSkillComplianceCheck = { type: "forbidden-terms", terms: ["套话"] };
    const digest = buildWritingSkillConstraintDigest([skill("a", [noSeverity])]);

    expect(digest.items[0]!.severity).toBe("warning");
    expect(checkSeverity(noSeverity)).toBe("warning");
    expect(digest.blockingCount).toBe(0);
  });
});

describe("渲染与 scene.spec 并入", () => {
  it("渲染结果标出硬性条目，供审修阶段按已知标准修", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden, required])]);
    const text = renderWritingSkillConstraintDigest(digest);

    expect(text).toContain(describeCheck(forbidden));
    expect(text.length).toBeGreaterThan(0);
  });

  it("toSceneSpecConstraintLines 产出可直接并入 sceneSpec.constraints 的行", () => {
    const digest = buildWritingSkillConstraintDigest([skill("a", [forbidden])]);
    const lines = toSceneSpecConstraintLines(digest);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => typeof line === "string" && line.length > 0)).toBe(true);
    expect(lines.join("\n")).toContain(describeCheck(forbidden));
  });

  it("空摘要不产出噪音行", () => {
    expect(toSceneSpecConstraintLines(EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST)).toHaveLength(0);
    expect(renderWritingSkillConstraintDigest(EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST)).toBe("");
  });
});
