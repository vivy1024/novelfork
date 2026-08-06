import { describe, expect, it } from "vitest";

import {
  MIN_SKILL_QUOTE_CHARS,
  describeWritingSkillAcknowledgementRequirement,
  explainWritingSkillAcknowledgementVerdict,
  verifyWritingSkillAcknowledgements,
  type AcknowledgeableWritingSkill,
} from "./writing-skill-acknowledgement.js";

const BODY = [
  "# 克制写实",
  "",
  "少用形容词，多写动作与可观察的细节。",
  "情绪不要直接命名，用身体反应替代：手心出汗、喉咙发紧、笔尖停住。",
].join("\n");

const HOOK_BODY = [
  "# 章末钩子",
  "",
  "每一章结尾都要留下一个尚未回答的问题，让读者必须点开下一章才能安心。",
  "钩子要落在具体事物上：一张没署名的收据、一通没接的电话、一个提前离场的人。",
].join("\n");

const SKILLS: AcknowledgeableWritingSkill[] = [
  { slug: "austere", name: "克制写实", body: BODY },
  { slug: "hook", name: "章末钩子", body: HOOK_BODY },
];

describe("describeWritingSkillAcknowledgementRequirement", () => {
  it("只要求正文足够长的技能提交引用", () => {
    const required = describeWritingSkillAcknowledgementRequirement([
      ...SKILLS,
      { slug: "tiny", name: "太短", body: "短。" },
    ]);

    expect(required.map((item) => item.slug)).toEqual(["austere", "hook"]);
    expect(required[0]?.minQuoteChars).toBe(MIN_SKILL_QUOTE_CHARS);
  });
});

describe("verifyWritingSkillAcknowledgements", () => {
  it("原文引用命中时通过，允许换行与缩进不同", () => {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: SKILLS,
      acknowledged: [
        { slug: "austere", quote: "少用形容词，多写动作与可观察的细节。\n情绪不要直接命名，用身体反应替代：手心出汗、喉咙发紧、笔尖停住。" },
        { slug: "hook", quote: "钩子要落在具体事物上：一张没署名的收据、\n   一通没接的电话、一个提前离场的人。" },
      ],
    });

    expect(verdict.ok).toBe(true);
    expect(verdict).toMatchObject({ missing: [], tooShort: [], notFound: [], unknown: [] });
  });

  it("没读文件就编不出原文：编造的引用被判 notFound", () => {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: SKILLS,
      acknowledged: [
        { slug: "austere", quote: "本技能要求文风克制、少用形容词并保持画面感，我已经完整阅读并会严格遵守。" },
        { slug: "hook", quote: "钩子要落在具体事物上：一张没署名的收据、一通没接的电话、一个提前离场的人。" },
      ],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.notFound).toEqual(["austere"]);
  });

  it("漏交、过短与未启用技能分别归类", () => {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: SKILLS,
      acknowledged: [
        { slug: "austere", quote: "少用形容词" },
        { slug: "not-enabled", quote: "随便一段足够长的文字用来占位，长度超过四十个字符以便触发校验流程。" },
      ],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.tooShort).toEqual(["austere"]);
    expect(verdict.missing).toEqual(["hook"]);
    expect(verdict.unknown).toEqual(["not-enabled"]);
  });

  it("没有启用任何技能时不产生要求", () => {
    expect(describeWritingSkillAcknowledgementRequirement([])).toEqual([]);
    expect(verifyWritingSkillAcknowledgements({ skills: [], acknowledged: [] }).ok).toBe(true);
  });
});

describe("explainWritingSkillAcknowledgementVerdict", () => {
  it("给出三段式说明并指向 SKILL.md 路径与字段名", () => {
    const verdict = verifyWritingSkillAcknowledgements({ skills: SKILLS, acknowledged: [] });
    const explanation = explainWritingSkillAcknowledgementVerdict({ verdict, skills: SKILLS });

    expect(explanation.whatHappened).toContain("克制写实");
    expect(explanation.whyItMatters).toContain("不可靠");
    expect(explanation.suggestedAction).toContain(".novelfork/skills/");
    expect(explanation.suggestedAction).toContain("acknowledgedSkills");
  });
});
