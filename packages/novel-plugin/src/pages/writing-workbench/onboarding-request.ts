/**
 * 把「新书十一问已完成」翻译成给叙述者的编排指令。
 *
 * 纪律与 write-request.ts 一致：前端不自己编排工具执行，也不静默写 book.json。
 * 它只把已落库的建书答案与推荐清单交给叙述者，由 Runtime 的 Agent Loop 依次
 * 执行 writing-skills.recommend / AskUserQuestion / writing-skills.write / lore.write，
 * 权限确认与问答渲染都留在 Runtime 侧。
 */

export interface OnboardingRecommendedSkill {
  readonly name: string;
  readonly reason: string;
}

export interface OnboardingRequestPayload {
  readonly bookTitle?: string;
  /** applyGuidedSetup 返回的推荐清单；为空也照常走推荐工具。 */
  readonly recommendedWritingSkills?: readonly OnboardingRecommendedSkill[];
  readonly matchedGenreCluster?: string | null;
}

/** 建书完成后追问的方面。写死在这里，保证每本新书都被问到同一批关键决定。 */
const FOLLOW_UP_TOPICS = [
  "主线终局与升级台阶（结局大方向、主角靠什么一路变强）",
  "主要对手是谁、他有什么反击能力（不能是纯沙包）",
  "第一卷要兑现的爽点与要埋的伏笔",
  "你明确不想写的内容（题材禁区、雷点、不能碰的桥段）",
];

/** 生成发给叙述者的建书收尾编排消息。 */
export function buildOnboardingRequestMessage(payload: OnboardingRequestPayload = {}): string {
  const title = payload.bookTitle?.trim();
  const recommended = payload.recommendedWritingSkills ?? [];
  const clusterNote = payload.matchedGenreCluster
    ? `（系统判定题材簇：${payload.matchedGenreCluster}）`
    : "";

  const lines: string[] = [
    `我刚完成${title ? `《${title}》的` : ""}新书十一问设定，题材、前提、主角、金手指、世界、力量体系、基调、创作方式、平台、章字数、AI 味容忍度都已落库。${clusterNote}`,
  ];

  if (recommended.length > 0) {
    lines.push(
      "",
      "建书流程已按我的回答预选了这些 Writing Skills：",
      ...recommended.map((skill) => `- ${skill.name}：${skill.reason}`),
    );
  }

  lines.push(
    "",
    "请按顺序执行：",
    "1. 调用 writing-skills.recommend 拿完整推荐清单，并用 writing-skills.read 核对当前启用状态。",
    "2. 用 AskUserQuestion 让我确认要启用哪些（推荐项默认勾选，我可以增删），我确认后再用 writing-skills.write 落库。",
    `3. 再用 AskUserQuestion 就以下方面追问我，每次一组、问完等我回答：${FOLLOW_UP_TOPICS.map((topic, index) => `\n   ${index + 1}) ${topic}`).join("")}`,
    "4. 把我的回答用 lore.write 写进经纬，统一 layer=dynamic、status=needs-review；等我确认后再升 canon。",
    "",
    "不要跳过第 2 步直接启用，也不要在我没回答前替我编造设定。",
  );

  return lines.join("\n");
}
