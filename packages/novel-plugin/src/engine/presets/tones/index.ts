import type { Preset } from "../types.js";

export const builtinTonePresets = [
  {
    id: "tragic-solitude",
    name: "悲苦孤独",
    category: "tone",
    description: "克制、孤独、沉郁的叙事声音，适合凡人流与悲情线。",
    promptInjection: "保持悲苦孤独的语言气质：叙事克制，情绪通过行动与环境折射，不用口号式抒情。",
    compatibleGenres: ["xianxia", "history"],
    conflictGroup: "tone",
  },
  {
    id: "austere-pragmatic",
    name: "冷峻质朴",
    category: "tone",
    description: "低修辞、高信息密度、重行动后果的冷峻表达。",
    promptInjection: "保持冷峻质朴的语言气质：句子简洁，描写服务判断和行动，不用浮夸比喻堆砌。",
    compatibleGenres: ["mystery", "scifi", "history"],
    conflictGroup: "tone",
  },
  {
    id: "classical-imagery",
    name: "古典意境",
    category: "tone",
    description: "以景写情、含蓄转折、带古典游历感的叙事口吻。",
    promptInjection: "保持古典意境的语言气质：用景物和物候承接情绪，避免现代口号和空泛古风辞藻。",
    compatibleGenres: ["xianxia", "history", "romance"],
    conflictGroup: "tone",
  },
  {
    id: "dark-humor-social",
    name: "黑色幽默与社会批判",
    category: "tone",
    description: "荒诞、反讽、制度感强的黑色幽默表达。",
    promptInjection: "保持黑色幽默与社会批判的语言气质：笑点来自制度错位和人物自洽，不把现实议论文直接塞进叙事。",
    compatibleGenres: ["urban", "xianxia"],
    conflictGroup: "tone",
  },
  {
    id: "comedic-light",
    name: "沙雕轻快",
    category: "tone",
    description: "节奏轻、包袱密、对话灵活的轻喜剧表达。",
    promptInjection: "保持沙雕轻快的语言气质：用角色反应、误会和节奏制造笑点，避免网络梗无上下文堆砌。",
    compatibleGenres: ["urban", "romance", "xianxia"],
    conflictGroup: "tone",
  },
] as const satisfies ReadonlyArray<Preset>;
