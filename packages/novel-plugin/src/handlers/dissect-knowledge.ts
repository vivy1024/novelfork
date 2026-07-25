/**
 * Dissect knowledge pack — 从已有正文抽取结构化续写知识包。
 *
 * 规则抽取（无 LLM 也可用）+ 可选 LLM 增补。
 * 所有产物都是 dynamic/draft 级；不自动写 canon。
 */

export interface DissectCharacterCard {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly role: "protagonist" | "supporting" | "minor" | "faction" | "unknown";
  readonly identity: string;
  readonly relationships: readonly { readonly target: string; readonly relation: string }[];
  readonly firstAppearance: number;
  /** 出现章数 / 分析章数 */
  readonly frequency: number;
  readonly confidence: number;
}

export type DissectWorldCategory =
  | "location"
  | "faction"
  | "power-system"
  | "rules"
  | "props"
  | "timeline";

export interface DissectWorldElement {
  readonly name: string;
  readonly category: DissectWorldCategory;
  readonly description: string;
  readonly sourceChapters: readonly number[];
}

export interface DissectChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly summary: string;
  readonly keyEvents: readonly string[];
}

export interface DissectOpenHook {
  readonly description: string;
  readonly plantedChapter: number;
  readonly status: "pending" | "progressed";
  readonly evidence: string;
  readonly speculation: string;
}

export interface DissectRelationEdge {
  readonly source: string;
  readonly target: string;
  readonly description: string;
}

export interface DissectStyleHints {
  readonly tone: string;
  readonly customVocabulary: readonly string[];
  readonly formattingRules: readonly string[];
}

/** 结构化续写知识包（兼容旧扁平字段）。 */
export interface DissectKnowledgePack {
  readonly characters: readonly string[];
  readonly locations: readonly string[];
  readonly hooks: readonly string[];
  readonly chapterSummaries: readonly { readonly number: number; readonly summary: string }[];
  readonly suggestedFocus: string | null;
  readonly notes: readonly string[];

  readonly characterCards: readonly DissectCharacterCard[];
  readonly worldElements: readonly DissectWorldElement[];
  readonly detailedSummaries: readonly DissectChapterSummary[];
  readonly openHooks: readonly DissectOpenHook[];
  readonly relationshipGraph: readonly DissectRelationEdge[];
  readonly styleHints: DissectStyleHints;
}

export interface DissectSourceChapter {
  readonly number: number;
  readonly title: string;
  readonly content: string;
}

const SPEECH_VERBS = "道|说|笑|怒|问|答|看|望|走|站|坐|冷声|淡淡|沉声|开口|皱眉|点头|摇头|叹|喝";
const NAME_PATTERN = new RegExp(`[\\u4e00-\\u9fff]{2,4}(?=(?:${SPEECH_VERBS}))`, "gu");
const LOCATION_MOVE_PATTERN = /(?:来到|抵达|进入|回到|离开了?|返回|前往)([\u4e00-\u9fff]{2,8})/gu;
const LOCATION_SUFFIX_PATTERN = /([\u4e00-\u9fff]{1,6}(?:山|峰|阁|府|宗|殿|城|镇|村|国|界|谷|洞|岛|林|海|塔|院|园|坊|营))/gu;
const FACTION_SUFFIX_PATTERN = /([\u4e00-\u9fff]{2,6}(?:门|派|宗|会|盟|帮|族|军|团|阁|殿|司|堂))/gu;
const POWER_KEYWORDS = ["境界", "突破", "修炼", "灵根", "丹田", "真气", "等级", "血脉", "功法", "秘籍", "天赋"];
const RULE_KEYWORDS = ["禁忌", "铁律", "规矩", "祖训", "律法", "契约", "代价", "不可", "禁止", "只有", "必须"];
const HOOK_KEYWORDS = [
  "日后",
  "将来",
  "总有一天",
  "秘密",
  "不知为何",
  "殊不知",
  "未曾想",
  "留下",
  "后手",
  "暗中",
  "尚未",
  "并未告诉",
  "隐瞒",
];
const PROGRESS_KEYWORDS = ["终于明白", "揭开", "真相", "原来", "得知", "确认"];

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: readonly string[], limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

/** 关键句权重：长度适中 + 含动作/冲突词 + 含角色名 */
function scoreSentence(sentence: string, names: readonly string[]): number {
  let score = Math.min(sentence.length, 60) / 60;
  if (/[，,]/u.test(sentence)) score += 0.1;
  if (/(?:却|竟|突然|终于|终究|随即|于是|因此)/u.test(sentence)) score += 0.35;
  if (/(?:杀|战|夺|逃|救|拒|签|破|夺回|交手|争执|决定|答应)/u.test(sentence)) score += 0.4;
  if (names.some((name) => sentence.includes(name))) score += 0.35;
  if (/["“”「」]/u.test(sentence)) score += 0.1;
  return score;
}

function pickKeySentences(text: string, names: readonly string[], limit = 3): string[] {
  const list = sentences(text);
  if (list.length === 0) return [];
  const thirds = Math.max(1, Math.floor(list.length / 3));
  const zones = [
    list.slice(0, thirds),
    list.slice(thirds, thirds * 2),
    list.slice(thirds * 2),
  ];
  const picked: string[] = [];
  for (const zone of zones) {
    const best = [...zone].sort((a, b) => scoreSentence(b, names) - scoreSentence(a, names))[0];
    if (best && !picked.includes(best)) picked.push(best);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** 别名合并：短名是长名子串，或共享 2 字前缀且共现 */
function mergeAliases(counts: Map<string, number>): Map<string, Set<string>> {
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const groups = new Map<string, Set<string>>();
  for (const name of names) {
    let attached = false;
    for (const [main, aliases] of groups) {
      if (main.includes(name) || name.includes(main)) {
        aliases.add(name);
        attached = true;
        break;
      }
      if (main.length >= 2 && name.length >= 2 && main.slice(0, 2) === name.slice(0, 2)) {
        aliases.add(name);
        attached = true;
        break;
      }
    }
    if (!attached) groups.set(name, new Set());
  }
  return groups;
}

function roleOf(frequency: number, index: number): DissectCharacterCard["role"] {
  if (index === 0 && frequency >= 0.4) return "protagonist";
  if (frequency >= 0.3) return "supporting";
  if (frequency > 0) return "minor";
  return "unknown";
}

function collectMatches(text: string, pattern: RegExp, group = 1): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = (match[group] ?? match[0])?.trim();
    if (value) out.push(value);
  }
  return out;
}

function keywordFragments(text: string, keywords: readonly string[], radius = 40): string[] {
  const out: string[] = [];
  for (const sentence of sentences(text)) {
    if (keywords.some((keyword) => sentence.includes(keyword))) {
      out.push(sentence.slice(0, radius * 2));
    }
  }
  return out;
}

/**
 * 规则抽取（无 LLM）：把正文变成结构化知识包基线。
 */
export function extractKnowledgePack(chapters: readonly DissectSourceChapter[]): DissectKnowledgePack {
  const total = Math.max(1, chapters.length);
  const nameCounts = new Map<string, number>();
  const nameChapters = new Map<string, Set<number>>();
  const locationChapters = new Map<string, Set<number>>();
  const factionChapters = new Map<string, Set<number>>();
  const powerFragments = new Map<string, Set<number>>();
  const ruleFragments = new Map<string, Set<number>>();
  const openHooks: DissectOpenHook[] = [];
  const detailedSummaries: DissectChapterSummary[] = [];

  for (const chapter of chapters) {
    const text = chapter.content.slice(0, 12000);

    for (const name of collectMatches(text, NAME_PATTERN, 0)) {
      if (name.length < 2) continue;
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      const set = nameChapters.get(name) ?? new Set<number>();
      set.add(chapter.number);
      nameChapters.set(name, set);
    }

    for (const location of [
      ...collectMatches(text, LOCATION_MOVE_PATTERN, 1),
      ...collectMatches(text, LOCATION_SUFFIX_PATTERN, 1),
    ]) {
      const set = locationChapters.get(location) ?? new Set<number>();
      set.add(chapter.number);
      locationChapters.set(location, set);
    }

    for (const faction of collectMatches(text, FACTION_SUFFIX_PATTERN, 1)) {
      const set = factionChapters.get(faction) ?? new Set<number>();
      set.add(chapter.number);
      factionChapters.set(faction, set);
    }

    for (const fragment of keywordFragments(text, POWER_KEYWORDS)) {
      const set = powerFragments.get(fragment) ?? new Set<number>();
      set.add(chapter.number);
      powerFragments.set(fragment, set);
    }
    for (const fragment of keywordFragments(text, RULE_KEYWORDS)) {
      const set = ruleFragments.get(fragment) ?? new Set<number>();
      set.add(chapter.number);
      ruleFragments.set(fragment, set);
    }

    for (const sentence of sentences(text)) {
      if (!HOOK_KEYWORDS.some((keyword) => sentence.includes(keyword))) continue;
      const progressed = PROGRESS_KEYWORDS.some((keyword) => sentence.includes(keyword));
      openHooks.push({
        description: sentence.slice(0, 80),
        plantedChapter: chapter.number,
        status: progressed ? "progressed" : "pending",
        evidence: sentence.slice(0, 160),
        speculation: progressed
          ? "已有推进痕迹，续写时确认是否需要收束。"
          : "尚未回收，续写时可安排线索推进或兑现。",
      });
      if (openHooks.length >= 40) break;
    }
  }

  const aliasGroups = mergeAliases(nameCounts);
  const mainNames = [...aliasGroups.keys()];
  const characterCards: DissectCharacterCard[] = mainNames.map((name, index) => {
    const aliases = [...(aliasGroups.get(name) ?? new Set<string>())].filter((alias) => alias !== name);
    const chaptersSeen = new Set<number>(nameChapters.get(name) ?? []);
    for (const alias of aliases) {
      for (const n of nameChapters.get(alias) ?? []) chaptersSeen.add(n);
    }
    const frequency = Number((chaptersSeen.size / total).toFixed(2));
    return {
      name,
      aliases: uniqueStrings(aliases, 6),
      role: roleOf(frequency, index),
      identity: `${name}（规则抽取，出现 ${chaptersSeen.size}/${total} 章）`,
      relationships: [],
      firstAppearance: chaptersSeen.size > 0 ? Math.min(...chaptersSeen) : chapters[0]?.number ?? 1,
      frequency,
      confidence: Number(Math.min(0.9, 0.35 + frequency).toFixed(2)),
    };
  }).slice(0, 20);

  const worldElements: DissectWorldElement[] = [
    ...[...locationChapters.entries()].slice(0, 20).map(([name, set]) => ({
      name,
      category: "location" as const,
      description: `正文提及地点（${set.size} 章）`,
      sourceChapters: [...set].sort((a, b) => a - b),
    })),
    ...[...factionChapters.entries()].slice(0, 12).map(([name, set]) => ({
      name,
      category: "faction" as const,
      description: `正文提及势力/组织（${set.size} 章）`,
      sourceChapters: [...set].sort((a, b) => a - b),
    })),
    ...[...powerFragments.entries()].slice(0, 8).map(([fragment, set]) => ({
      name: fragment.slice(0, 18),
      category: "power-system" as const,
      description: fragment,
      sourceChapters: [...set].sort((a, b) => a - b),
    })),
    ...[...ruleFragments.entries()].slice(0, 8).map(([fragment, set]) => ({
      name: fragment.slice(0, 18),
      category: "rules" as const,
      description: fragment,
      sourceChapters: [...set].sort((a, b) => a - b),
    })),
  ];

  const topNames = characterCards.slice(0, 5).map((card) => card.name);
  for (const chapter of chapters) {
    const text = chapter.content.slice(0, 12000);
    const keySentences = pickKeySentences(text, topNames, 3);
    const chapterNames = topNames.filter((name) => text.includes(name)).slice(0, 2);
    const chapterLocation = [...locationChapters.entries()]
      .find(([, set]) => set.has(chapter.number))?.[0];
    const head = chapterNames.length > 0 ? chapterNames.join("、") : "本章人物";
    const where = chapterLocation ? `于${chapterLocation}` : "";
    const summary = keySentences.length > 0
      ? `${head}${where}：${keySentences.join(" ")}`.slice(0, 200)
      : `${chapter.title || `第${chapter.number}章`}（摘要待补）`;
    detailedSummaries.push({
      number: chapter.number,
      title: chapter.title || `第${chapter.number}章`,
      summary,
      keyEvents: keySentences.map((item) => item.slice(0, 60)),
    });
  }

  const relationshipGraph: DissectRelationEdge[] = [];
  for (const chapter of chapters) {
    const present = topNames.filter((name) => chapter.content.includes(name));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const source = present[i]!;
        const target = present[j]!;
        if (relationshipGraph.some((edge) => edge.source === source && edge.target === target)) continue;
        relationshipGraph.push({ source, target, description: "同章共现（规则推断，需确认）" });
        if (relationshipGraph.length >= 20) break;
      }
    }
  }

  const sample = chapters.map((chapter) => chapter.content).join("\n").slice(0, 20000);
  const sentenceList = sentences(sample);
  const avgLength = sentenceList.length
    ? Math.round(sentenceList.reduce((sum, item) => sum + item.length, 0) / sentenceList.length)
    : 0;
  const dialogueRatio = sentenceList.length
    ? Number((sentenceList.filter((item) => /["“”「」]/u.test(item)).length / sentenceList.length).toFixed(2))
    : 0;
  const styleHints: DissectStyleHints = {
    tone: dialogueRatio > 0.3 ? "对话推进为主" : avgLength > 40 ? "叙述铺陈偏长" : "叙述紧凑",
    customVocabulary: uniqueStrings(
      [...powerFragments.keys()].map((item) => item.slice(0, 10)),
      10,
    ),
    formattingRules: [
      `平均句长约 ${avgLength} 字`,
      `对话句占比约 ${Math.round(dialogueRatio * 100)}%`,
    ],
  };

  const lastSummary = detailedSummaries.at(-1);
  const pendingHook = openHooks.find((hook) => hook.status === "pending");
  const suggestedFocus = lastSummary
    ? `续写重点：承接第${lastSummary.number}章「${lastSummary.summary.slice(0, 60)}」${
        pendingHook ? `，并推进未回收线索「${pendingHook.description.slice(0, 30)}」` : "，推进主线冲突"
      }。`
    : null;

  const notes = [
    "规则抽取仅供续写启动；角色卡与世界设定默认 draft/needs-review，需人工确认后再入 canon。",
    characterCards.length === 0 ? "未稳定识别角色名，建议开启 LLM 增补或手动补角色卡。" : "",
  ].filter(Boolean);

  return {
    characters: characterCards.map((card) => card.name),
    locations: [...locationChapters.keys()].slice(0, 20),
    hooks: uniqueStrings(openHooks.map((hook) => hook.description), 20),
    chapterSummaries: detailedSummaries.slice(-8).map((item) => ({ number: item.number, summary: item.summary })),
    suggestedFocus,
    notes,
    characterCards,
    worldElements,
    detailedSummaries,
    openHooks: openHooks.slice(0, 20),
    relationshipGraph,
    styleHints,
  };
}

export const DISSECT_LLM_SYSTEM_PROMPT = `你是小说内容解构专家。以「规则抽取初稿」为基准，结合章节正文，输出结构化续写知识包。

硬要求：
1. 角色不含无名龙套；relationships 双向合理；confidence 在 0-1。
2. worldElements 必须分类明确并给出规则/设定描述，不写空话。
3. detailedSummaries 必须事件级（发生什么、结果如何、对后续影响），禁止套话。
4. openHooks 必须给 speculation（续写如何推进/兑现）。
5. 只输出纯 JSON，不要 Markdown 代码围栏、不要解释。`;

export function buildDissectLlmUserPrompt(input: {
  readonly heuristic: DissectKnowledgePack;
  readonly chapters: readonly DissectSourceChapter[];
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? 12000;
  const perChapter = Math.max(600, Math.floor(maxChars / Math.max(1, input.chapters.length)));
  const body = input.chapters
    .map((chapter) => `## 第${chapter.number}章\n${chapter.content.slice(0, perChapter)}`)
    .join("\n\n")
    .slice(0, maxChars);
  const heuristic = {
    characterCards: input.heuristic.characterCards.slice(0, 10),
    worldElements: input.heuristic.worldElements.slice(0, 12),
    openHooks: input.heuristic.openHooks.slice(0, 8),
    styleHints: input.heuristic.styleHints,
  };
  return [
    "【规则抽取初稿（仅参考，可修正）】",
    JSON.stringify(heuristic),
    "",
    `【正文范围】第 ${input.fromChapter}-${input.toChapter} 章`,
    body,
    "",
    "【输出 JSON 结构】",
    JSON.stringify({
      characterCards: [
        {
          name: "角色主名",
          aliases: ["别名"],
          role: "protagonist|supporting|minor|faction|unknown",
          identity: "一句话身份",
          relationships: [{ target: "角色", relation: "关系" }],
          firstAppearance: 1,
          frequency: 0.8,
          confidence: 0.9,
        },
      ],
      worldElements: [
        { name: "设定名", category: "location|faction|power-system|rules|props|timeline", description: "规则描述", sourceChapters: [1] },
      ],
      detailedSummaries: [{ number: 1, title: "标题", summary: "事件级摘要", keyEvents: ["事件"] }],
      openHooks: [
        { description: "伏笔", plantedChapter: 1, status: "pending|progressed", evidence: "正文摘录", speculation: "续写方向" },
      ],
      relationshipGraph: [{ source: "A", target: "B", description: "关系" }],
      styleHints: { tone: "基调", customVocabulary: ["词"], formattingRules: ["特征"] },
      suggestedFocus: "下一章一句写作目标",
    }),
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).match(/\{[\s\S]*\}/u)?.[0];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clamp01(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Number(Math.min(1, Math.max(0, num)).toFixed(2));
}

/** 合并 LLM 输出到规则基线；LLM 字段缺失或非法时保留基线。 */
export function mergeLlmKnowledgePack(
  base: DissectKnowledgePack,
  llmText: string,
): DissectKnowledgePack {
  const parsed = parseJsonObject(llmText);
  if (!parsed) {
    return { ...base, notes: [...base.notes, "LLM 输出无法解析为 JSON，保留规则抽取结果。"] };
  }

  const characterCards: DissectCharacterCard[] = asArray(parsed.characterCards)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const name = trimText(record.name);
      if (!name) return null;
      const existing = base.characterCards.find((card) => card.name === name);
      const roleRaw = trimText(record.role);
      const role: DissectCharacterCard["role"] =
        roleRaw === "protagonist" || roleRaw === "supporting" || roleRaw === "minor" || roleRaw === "faction"
          ? roleRaw
          : existing?.role ?? "unknown";
      return {
        name,
        aliases: uniqueStrings(
          [...asArray(record.aliases).map((alias) => trimText(alias)), ...(existing?.aliases ?? [])].filter(Boolean),
          6,
        ),
        role,
        identity: trimText(record.identity) || existing?.identity || `${name}（LLM 抽取）`,
        relationships: asArray(record.relationships)
          .map((relation) => {
            const rel = relation as Record<string, unknown>;
            const target = trimText(rel.target);
            const description = trimText(rel.relation);
            return target && description ? { target, relation: description } : null;
          })
          .filter((value): value is { target: string; relation: string } => value !== null)
          .slice(0, 8),
        firstAppearance: Number.isFinite(Number(record.firstAppearance))
          ? Math.max(1, Math.trunc(Number(record.firstAppearance)))
          : existing?.firstAppearance ?? 1,
        frequency: clamp01(record.frequency, existing?.frequency ?? 0),
        confidence: clamp01(record.confidence, existing?.confidence ?? 0.5),
      } satisfies DissectCharacterCard;
    })
    .filter((card): card is DissectCharacterCard => card !== null)
    .slice(0, 24);

  const worldElements: DissectWorldElement[] = asArray(parsed.worldElements)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const name = trimText(record.name);
      if (!name) return null;
      const categoryRaw = trimText(record.category);
      const category: DissectWorldCategory =
        categoryRaw === "location"
        || categoryRaw === "faction"
        || categoryRaw === "power-system"
        || categoryRaw === "rules"
        || categoryRaw === "props"
        || categoryRaw === "timeline"
          ? categoryRaw
          : "rules";
      return {
        name,
        category,
        description: trimText(record.description) || name,
        sourceChapters: asArray(record.sourceChapters)
          .map((n) => Math.trunc(Number(n)))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, 20),
      } satisfies DissectWorldElement;
    })
    .filter((element): element is DissectWorldElement => element !== null)
    .slice(0, 40);

  const detailedSummaries: DissectChapterSummary[] = asArray(parsed.detailedSummaries)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const number = Math.trunc(Number(record.number));
      const summary = trimText(record.summary);
      if (!Number.isFinite(number) || number <= 0 || !summary) return null;
      const existing = base.detailedSummaries.find((entry) => entry.number === number);
      return {
        number,
        title: trimText(record.title) || existing?.title || `第${number}章`,
        summary,
        keyEvents: asArray(record.keyEvents).map((event) => trimText(event)).filter(Boolean).slice(0, 8),
      } satisfies DissectChapterSummary;
    })
    .filter((entry): entry is DissectChapterSummary => entry !== null);

  const openHooks: DissectOpenHook[] = asArray(parsed.openHooks)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const description = trimText(record.description);
      if (!description) return null;
      const statusRaw = trimText(record.status);
      return {
        description,
        plantedChapter: Number.isFinite(Number(record.plantedChapter))
          ? Math.max(1, Math.trunc(Number(record.plantedChapter)))
          : 1,
        status: statusRaw === "progressed" ? "progressed" : "pending",
        evidence: trimText(record.evidence),
        speculation: trimText(record.speculation) || "续写时确认如何推进。",
      } satisfies DissectOpenHook;
    })
    .filter((hook): hook is DissectOpenHook => hook !== null)
    .slice(0, 30);

  const relationshipGraph: DissectRelationEdge[] = asArray(parsed.relationshipGraph)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const source = trimText(record.source);
      const target = trimText(record.target);
      if (!source || !target) return null;
      return { source, target, description: trimText(record.description) || "关系（LLM 推断）" };
    })
    .filter((edge): edge is DissectRelationEdge => edge !== null)
    .slice(0, 40);

  const styleRecord = (parsed.styleHints ?? {}) as Record<string, unknown>;
  const styleHints: DissectStyleHints = {
    tone: trimText(styleRecord.tone) || base.styleHints.tone,
    customVocabulary: uniqueStrings(
      [
        ...asArray(styleRecord.customVocabulary).map((item) => trimText(item)),
        ...base.styleHints.customVocabulary,
      ].filter(Boolean),
      12,
    ),
    formattingRules: uniqueStrings(
      [
        ...asArray(styleRecord.formattingRules).map((item) => trimText(item)),
        ...base.styleHints.formattingRules,
      ].filter(Boolean),
      8,
    ),
  };

  const mergedSummaries = detailedSummaries.length > 0 ? detailedSummaries : base.detailedSummaries;
  const mergedCards = characterCards.length > 0 ? characterCards : base.characterCards;
  const mergedHooks = openHooks.length > 0 ? openHooks : base.openHooks;
  const suggestedFocus = trimText(parsed.suggestedFocus);

  return {
    characters: mergedCards.map((card) => card.name),
    locations: uniqueStrings(
      [
        ...worldElements.filter((element) => element.category === "location").map((element) => element.name),
        ...base.locations,
      ],
      24,
    ),
    hooks: uniqueStrings(mergedHooks.map((hook) => hook.description), 24),
    chapterSummaries: mergedSummaries.slice(-8).map((entry) => ({ number: entry.number, summary: entry.summary })),
    suggestedFocus: suggestedFocus.length >= 8 ? suggestedFocus : base.suggestedFocus,
    notes: [...base.notes, "已用 LLM 增补结构化知识包。"],
    characterCards: mergedCards,
    worldElements: worldElements.length > 0 ? worldElements : base.worldElements,
    detailedSummaries: mergedSummaries,
    openHooks: mergedHooks,
    relationshipGraph: relationshipGraph.length > 0 ? relationshipGraph : base.relationshipGraph,
    styleHints,
  };
}
