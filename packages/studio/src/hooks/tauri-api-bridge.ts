/**
 * tauri-api-bridge — intercepts API paths and routes them to TauriStorageAdapter.
 * This allows all existing useApi/fetchJson calls to work in Tauri mode
 * without modifying page components.
 */

import type { ClientStorageAdapter } from "../storage/adapter.js";
import { getWorkspace } from "../storage/tauri-adapter.js";

// ── Tauri invoke 辅助 ──

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@tauri-apps/api/core") as any;
  return mod.invoke(cmd, args) as T;
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function ws(): string {
  const w = getWorkspace();
  if (!w) throw new Error("Workspace not selected");
  return w;
}

// ── 内置流派数据（Tauri 模式无法读取 node_modules 内的 .md 文件） ──

interface BuiltinGenreData {
  readonly profile: {
    readonly name: string;
    readonly id: string;
    readonly language: string;
    readonly chapterTypes: ReadonlyArray<string>;
    readonly fatigueWords: ReadonlyArray<string>;
    readonly numericalSystem: boolean;
    readonly powerScaling: boolean;
    readonly eraResearch: boolean;
    readonly pacingRule: string;
    readonly auditDimensions: ReadonlyArray<number>;
  };
  readonly body: string;
}

const BUILTIN_GENRES: Record<string, BuiltinGenreData> = {
  xuanhuan: { profile: { name: "玄幻", id: "xuanhuan", language: "zh", chapterTypes: ["战斗章","布局章","过渡章","回收章"], fatigueWords: ["冷笑","蝼蚁","倒吸凉气","瞳孔骤缩"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "三章内必有明确反馈", auditDimensions: [1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,24,25,26] }, body: "玄幻题材规则" },
  xianxia: { profile: { name: "仙侠", id: "xianxia", language: "zh", chapterTypes: ["修炼章","历劫章","论道章","过渡章"], fatigueWords: ["道友","贫道","天劫","渡劫"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "修炼与历劫交替推进", auditDimensions: [1,2,3,4,5,6,7,8,9,10] }, body: "仙侠题材规则" },
  urban: { profile: { name: "都市", id: "urban", language: "zh", chapterTypes: ["日常章","冲突章","反转章"], fatigueWords: ["不禁","竟然","没想到"], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "节奏紧凑，冲突驱动", auditDimensions: [1,2,3,4,5] }, body: "都市题材规则" },
  horror: { profile: { name: "恐怖", id: "horror", language: "zh", chapterTypes: ["铺垫章","惊吓章","揭秘章"], fatigueWords: ["毛骨悚然","不寒而栗"], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "恐惧递进，张弛有度", auditDimensions: [1,2,3,4,5] }, body: "恐怖题材规则" },
  other: { profile: { name: "通用", id: "other", language: "zh", chapterTypes: ["正文章","过渡章"], fatigueWords: [], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "", auditDimensions: [] }, body: "" },
  litrpg: { profile: { name: "LitRPG", id: "litrpg", language: "en", chapterTypes: ["combat","quest","downtime"], fatigueWords: ["suddenly","somehow"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Level-up every 3-5 chapters", auditDimensions: [1,2,3,4,5] }, body: "LitRPG genre rules" },
  progression: { profile: { name: "Progression Fantasy", id: "progression", language: "en", chapterTypes: ["training","breakthrough","conflict"], fatigueWords: ["suddenly","somehow"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Steady power growth", auditDimensions: [1,2,3,4,5] }, body: "Progression Fantasy rules" },
  cultivation: { profile: { name: "English Cultivation", id: "cultivation", language: "en", chapterTypes: ["cultivation","tribulation","exploration"], fatigueWords: ["qi","dao"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Realm breakthroughs as milestones", auditDimensions: [1,2,3,4,5] }, body: "Cultivation rules" },
  isekai: { profile: { name: "Isekai / Portal Fantasy", id: "isekai", language: "en", chapterTypes: ["discovery","adaptation","conflict"], fatigueWords: ["suddenly","somehow"], numericalSystem: false, powerScaling: true, eraResearch: false, pacingRule: "World discovery pacing", auditDimensions: [1,2,3,4,5] }, body: "Isekai rules" },
  cozy: { profile: { name: "Cozy Fantasy", id: "cozy", language: "en", chapterTypes: ["slice-of-life","community","gentle-conflict"], fatigueWords: [], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "Gentle, character-driven", auditDimensions: [1,2,3] }, body: "Cozy Fantasy rules" },
  romantasy: { profile: { name: "Romantasy", id: "romantasy", language: "en", chapterTypes: ["romance","adventure","tension"], fatigueWords: ["heart pounded","breath caught"], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "Romance and plot interleaved", auditDimensions: [1,2,3,4,5] }, body: "Romantasy rules" },
  "sci-fi": { profile: { name: "Science Fiction", id: "sci-fi", language: "en", chapterTypes: ["exploration","conflict","discovery"], fatigueWords: ["suddenly","somehow"], numericalSystem: false, powerScaling: false, eraResearch: true, pacingRule: "Ideas drive plot", auditDimensions: [1,2,3,4,5] }, body: "Sci-fi rules" },
  "dungeon-core": { profile: { name: "Dungeon Core", id: "dungeon-core", language: "en", chapterTypes: ["building","defense","expansion"], fatigueWords: ["mana","core"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Build-defend cycles", auditDimensions: [1,2,3,4,5] }, body: "Dungeon Core rules" },
  "system-apocalypse": { profile: { name: "System Apocalypse", id: "system-apocalypse", language: "en", chapterTypes: ["survival","combat","system"], fatigueWords: ["suddenly","notification"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Survival tension", auditDimensions: [1,2,3,4,5] }, body: "System Apocalypse rules" },
  "tower-climber": { profile: { name: "Tower Climbing", id: "tower-climber", language: "en", chapterTypes: ["floor","boss","rest"], fatigueWords: ["floor","level"], numericalSystem: true, powerScaling: true, eraResearch: false, pacingRule: "Floor-by-floor progression", auditDimensions: [1,2,3,4,5] }, body: "Tower Climbing rules" },
};

// ── 流派 frontmatter 解析/序列化 ──

interface GenreProfile {
  name: string; id: string; language: string;
  chapterTypes: string[]; fatigueWords: string[];
  numericalSystem: boolean; powerScaling: boolean; eraResearch: boolean;
  pacingRule: string; auditDimensions: number[];
}

function parseGenreFrontmatter(raw: string): { profile: GenreProfile; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) {
    return {
      profile: { name: "", id: "", language: "zh", chapterTypes: [], fatigueWords: [], numericalSystem: false, powerScaling: false, eraResearch: false, pacingRule: "", auditDimensions: [] },
      body: raw,
    };
  }
  // 简易 YAML 解析（流派文件结构固定）
  const lines = m[1].split("\n");
  const obj: Record<string, unknown> = {};
  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      try { obj[key] = JSON.parse(val); } catch { obj[key] = []; }
    } else if (val === "true") { obj[key] = true; }
    else if (val === "false") { obj[key] = false; }
    else if (val.startsWith('"') && val.endsWith('"')) { obj[key] = val.slice(1, -1); }
    else { obj[key] = val; }
  }
  return {
    profile: {
      name: String(obj.name ?? ""),
      id: String(obj.id ?? ""),
      language: String(obj.language ?? "zh"),
      chapterTypes: Array.isArray(obj.chapterTypes) ? obj.chapterTypes as string[] : [],
      fatigueWords: Array.isArray(obj.fatigueWords) ? obj.fatigueWords as string[] : [],
      numericalSystem: obj.numericalSystem === true,
      powerScaling: obj.powerScaling === true,
      eraResearch: obj.eraResearch === true,
      pacingRule: String(obj.pacingRule ?? ""),
      auditDimensions: Array.isArray(obj.auditDimensions) ? obj.auditDimensions as number[] : [],
    },
    body: m[2].trim(),
  };
}

function serializeGenreFrontmatter(profile: Record<string, unknown>, body: string): string {
  return [
    "---",
    `name: ${profile.name ?? ""}`,
    `id: ${profile.id ?? ""}`,
    `language: ${profile.language ?? "zh"}`,
    `chapterTypes: ${JSON.stringify(profile.chapterTypes ?? [])}`,
    `fatigueWords: ${JSON.stringify(profile.fatigueWords ?? [])}`,
    `numericalSystem: ${profile.numericalSystem ?? false}`,
    `powerScaling: ${profile.powerScaling ?? false}`,
    `eraResearch: ${profile.eraResearch ?? false}`,
    `pacingRule: "${profile.pacingRule ?? ""}"`,
    `satisfactionTypes: ${JSON.stringify(profile.satisfactionTypes ?? [])}`,
    `auditDimensions: ${JSON.stringify(profile.auditDimensions ?? [])}`,
    "---",
    "",
    body ?? "",
  ].join("\n");
}

// ── 中文字数统计 ──

function countWords(text: string): number {
  // 中文按字计数，英文按空格分词
  const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const english = text.replace(/[\u4e00-\u9fff]/g, "").split(/\s+/).filter(Boolean).length;
  return chinese + english;
}

// ── LLM 多配置管理 ──

type LLMProvider = "openai" | "anthropic" | "ollama" | "gemini" | "custom";

interface LLMProfile {
  readonly name: string;
  readonly provider: LLMProvider;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

interface ChatMessage {
  readonly role: string;
  readonly content: string;
}

interface CallLLMOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
}

const PROFILES_KEY = "novelfork-llm-profiles";
const ACTIVE_KEY = "novelfork-llm-active";

/** 读取所有 LLM 配置 */
function loadAllProfiles(): LLMProfile[] {
  const raw = localStorage.getItem(PROFILES_KEY);
  if (raw) {
    try { return JSON.parse(raw) as LLMProfile[]; } catch { /* fall through */ }
  }
  return [];
}

/** 获取当前激活的配置 */
function loadActiveProfile(): LLMProfile {
  const profiles = loadAllProfiles();
  if (profiles.length === 0) {
    throw new Error("未配置 LLM API。请在设置 → LLM 配置中添加至少一个配置。");
  }
  const activeName = localStorage.getItem(ACTIVE_KEY);
  const active = activeName ? profiles.find(p => p.name === activeName) : profiles[0];
  if (!active) return profiles[0];
  if (!active.apiKey && active.provider !== "ollama") {
    throw new Error(`配置「${active.name}」缺少 API Key。`);
  }
  if (!active.baseUrl) {
    throw new Error(`配置「${active.name}」缺少 Base URL。`);
  }
  return active;
}

/** 保存配置列表 */
function saveAllProfiles(profiles: LLMProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

/** 规范化 baseUrl：去尾斜杠，自动补全常见路径 */
function normalizeBaseUrl(url: string, provider: LLMProvider): string {
  let u = url.trim().replace(/\/+$/, "");
  // 如果用户已经填了完整的 chat/completions 路径，截掉
  if (u.endsWith("/chat/completions")) {
    u = u.slice(0, -"/chat/completions".length);
  }
  if (u.endsWith("/v1/messages")) {
    u = u.slice(0, -"/v1/messages".length);
  }
  // 按 provider 补全
  if (provider === "openai" || provider === "custom") {
    if (!u.endsWith("/v1")) u += "/v1";
  }
  return u;
}

/** 按 provider 分发请求 */
async function callUserLLM(
  messages: ReadonlyArray<ChatMessage>,
  options?: CallLLMOptions,
): Promise<string> {
  const profile = loadActiveProfile();
  const p = profile.provider || "openai";
  const temp = options?.temperature ?? profile.temperature ?? 0.7;
  const maxTok = options?.maxTokens ?? profile.maxTokens ?? 4096;

  if (p === "anthropic") {
    return callAnthropic(profile, messages, temp, maxTok);
  }
  if (p === "ollama") {
    return callOllama(profile, messages, temp, maxTok);
  }
  if (p === "gemini") {
    return callGemini(profile, messages, temp, maxTok);
  }
  // openai / custom — OpenAI 兼容格式
  return callOpenAICompat(profile, messages, temp, maxTok);
}

/** 按 provider 获取上游可用模型列表 */
async function fetchUpstreamModels(profile: LLMProfile): Promise<string[]> {
  const p = profile.provider || "openai";

  if (p === "ollama") {
    const base = profile.baseUrl.trim().replace(/\/+$/, "") || "http://localhost:11434";
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Ollama models 错误: ${res.status}`);
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map(m => m.name);
  }

  if (p === "anthropic") {
    // 尝试调用 /v1/models 端点（兼容 Sub2API 等中转）
    try {
      const base = profile.baseUrl.trim().replace(/\/+$/, "") || "https://api.anthropic.com";
      const res = await fetch(`${base}/v1/models`, {
        headers: {
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01"
        },
      });
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ id: string }> };
        if (data.data && data.data.length > 0) {
          return data.data.map(m => m.id);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch models from anthropic endpoint:", e);
    }
    // 如果 API 调用失败，返回空数组（让用户手动输入模型名）
    return [];
  }

  if (p === "gemini") {
    const base = profile.baseUrl.trim().replace(/\/+$/, "") || "https://generativelanguage.googleapis.com";
    const res = await fetch(`${base}/v1beta/models?key=${profile.apiKey}`);
    if (!res.ok) throw new Error(`Gemini models 错误: ${res.status}`);
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map(m => m.name.replace("models/", ""));
  }

  // openai / custom
  const base = normalizeBaseUrl(profile.baseUrl, profile.provider);
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${profile.apiKey}` },
  });
  if (!res.ok) throw new Error(`Models 错误: ${res.status}`);
  const data = await res.json() as { data?: Array<{ id: string }> };
  return (data.data ?? []).map(m => m.id).sort();
}

/** OpenAI 兼容格式（OpenAI / DeepSeek / Moonshot / 中转站等） */
async function callOpenAICompat(
  profile: LLMProfile,
  messages: ReadonlyArray<ChatMessage>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const base = normalizeBaseUrl(profile.baseUrl, profile.provider);
  const url = `${base}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify({
      model: profile.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `LLM API 错误: ${res.status} (${profile.name})`);
  }

  const data = await res.json() as {
    choices: ReadonlyArray<{ message: { content: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 返回了空响应");
  return content;
}

/** Anthropic Messages API */
async function callAnthropic(
  profile: LLMProfile,
  messages: ReadonlyArray<ChatMessage>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const base = profile.baseUrl.trim().replace(/\/+$/, "");
  const url = base.includes("/v1/messages") ? base : `${base}/v1/messages`;

  // Anthropic 格式：system 单独提取，其余为 user/assistant 交替
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  const body: Record<string, unknown> = {
    model: profile.model,
    max_tokens: maxTokens,
    temperature,
    messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Anthropic API 错误: ${res.status} (${profile.name})`);
  }

  const data = await res.json() as {
    content: ReadonlyArray<{ type: string; text: string }>;
  };
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("Anthropic 返回了空响应");
  return text;
}

/** Ollama 本地模型（无需 API Key） */
async function callOllama(
  profile: LLMProfile,
  messages: ReadonlyArray<ChatMessage>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const base = profile.baseUrl.trim().replace(/\/+$/, "") || "http://localhost:11434";
  const url = `${base}/api/chat`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: profile.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama 错误: ${res.status} ${errText} (${profile.name})`);
  }

  const data = await res.json() as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama 返回了空响应");
  return content;
}

/** Gemini generateContent API */
async function callGemini(
  profile: LLMProfile,
  messages: ReadonlyArray<ChatMessage>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const base = profile.baseUrl.trim().replace(/\/+$/, "") || "https://generativelanguage.googleapis.com";
  const model = profile.model || "gemini-2.0-flash";
  const url = `${base}/v1beta/models/${model}:generateContent?key=${profile.apiKey}`;

  // 转换 messages 为 Gemini contents 格式
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  const contents = nonSystem.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API 错误: ${res.status} (${profile.name})`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 返回了空响应");
  return text;
}

// ── 守护进程状态 ──

interface DaemonLogEntry {
  readonly timestamp: string;
  readonly event: string;
  readonly message: string;
}

let _daemonInterval: ReturnType<typeof setInterval> | null = null;
let _daemonRunning = false;
let _daemonIntervalMinutes = 5;
let _daemonLog: DaemonLogEntry[] = [];
let _daemonBusy = false; // 防止并发 tick

function daemonAddLog(event: string, message: string): void {
  _daemonLog.push({ timestamp: new Date().toISOString(), event, message });
  // 只保留最近 50 条
  if (_daemonLog.length > 50) _daemonLog = _daemonLog.slice(-50);
}

/**
 * 守护进程单次 tick：找到需要写章节的书，调用 LLM 生成并保存
 */
async function daemonTick(adapter: ClientStorageAdapter): Promise<void> {
  if (_daemonBusy) return;
  _daemonBusy = true;
  try {
    const books = await adapter.listBooks();
    // 筛选活跃书籍
    const activeBooks = books.filter(b => b.status === "active" || b.status === "outlining");
    if (activeBooks.length === 0) {
      daemonAddLog("daemon:idle", "没有活跃书籍");
      return;
    }

    // 找需要章节最少的书（简易轮询）
    const needsWork = activeBooks
      .filter(b => !b.targetChapters || b.chaptersWritten < b.targetChapters)
      .sort((a, b) => a.chaptersWritten - b.chaptersWritten);

    if (needsWork.length === 0) {
      daemonAddLog("daemon:idle", "所有活跃书籍已达目标章数");
      return;
    }

    const book = needsWork[0];
    daemonAddLog("daemon:pick", `选中《${book.title}》(${book.chaptersWritten}章)`);

    // 加载书籍数据
    const bookData = await adapter.loadBook(book.id);
    const nextNum = bookData.nextChapter;
    const targetWords = book.chapterWordCount || 3000;

    // 收集上下文：最近 2 章
    const recentChapters: string[] = [];
    const chaptersToLoad = bookData.chapters.slice(-2);
    for (const ch of chaptersToLoad) {
      try {
        const detail = await adapter.loadChapter(book.id, ch.number);
        recentChapters.push(`## 第${ch.number}章 ${ch.title}\n\n${detail.content}`);
      } catch { /* 跳过 */ }
    }

    // 收集真相文件摘要
    let truthSummary = "";
    try {
      const truthFiles = await adapter.listTruthFiles(book.id);
      const previews = truthFiles.slice(0, 5).map(f => `[${f.name}] ${f.preview}`);
      if (previews.length > 0) truthSummary = previews.join("\n");
    } catch { /* 无真相文件 */ }

    // 构建写作提示词
    const lang = book.language === "en" ? "en" : "zh";
    const systemPrompt = lang === "zh"
      ? `你是一位专业的网络小说作家。请根据提供的上下文，续写下一章。要求：
- 字数约 ${targetWords} 字
- 保持与前文的连贯性（人物、情节、语气）
- 章节有明确的开头、发展和结尾钩子
- 直接输出章节正文，不要加标题或元信息`
      : `You are a professional fiction writer. Write the next chapter based on the provided context.
- Target length: ~${targetWords} words
- Maintain continuity with previous chapters (characters, plot, tone)
- Include a clear opening, development, and ending hook
- Output chapter text directly, no title or metadata`;

    let userPrompt = lang === "zh"
      ? `书名：${book.title}\n题材：${book.genre}\n当前要写：第${nextNum}章\n`
      : `Title: ${book.title}\nGenre: ${book.genre}\nWriting: Chapter ${nextNum}\n`;

    if (truthSummary) {
      userPrompt += lang === "zh" ? `\n设定摘要：\n${truthSummary}\n` : `\nStory bible:\n${truthSummary}\n`;
    }
    if (recentChapters.length > 0) {
      userPrompt += lang === "zh" ? `\n前文回顾：\n${recentChapters.join("\n\n")}\n` : `\nPrevious chapters:\n${recentChapters.join("\n\n")}\n`;
    }
    userPrompt += lang === "zh" ? "\n请续写下一章：" : "\nWrite the next chapter:";

    daemonAddLog("daemon:writing", `正在为《${book.title}》生成第${nextNum}章...`);

    const content = await callUserLLM(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.7, maxTokens: 8192 },
    );

    // 保存章节文件
    const padded = String(nextNum).padStart(4, "0");
    // 从生成内容的第一行提取标题
    const firstLine = content.split("\n")[0].replace(/^#+\s*/, "").trim();
    const title = firstLine.slice(0, 50) || (lang === "zh" ? `第${nextNum}章` : `Chapter ${nextNum}`);
    const safeTitle = title.replace(/[/\\:*?"<>|]/g, "_");

    const chaptersDir = join(ws(), "books", book.id, "chapters");
    await invoke("create_dir_all", { path: chaptersDir });
    await invoke("write_file_text", {
      path: join(chaptersDir, `${padded}-${safeTitle}.md`),
      content,
    });

    // 更新 chapter_index.json
    const indexPath = join(ws(), "books", book.id, "chapter_index.json");
    let index: Array<{ number: number; title: string; status: string; wordCount: number }> = [];
    try {
      const raw = await invoke<string>("read_file_text", { path: indexPath });
      index = JSON.parse(raw) as typeof index;
    } catch { /* 新索引 */ }
    index.push({ number: nextNum, title, status: "draft", wordCount: countWords(content) });
    await invoke("write_file_text", { path: indexPath, content: JSON.stringify(index, null, 2) });

    daemonAddLog("daemon:done", `《${book.title}》第${nextNum}章已生成（${countWords(content)}字）`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    daemonAddLog("daemon:error", `写作失败: ${msg}`);
  } finally {
    _daemonBusy = false;
  }
}

let _adapter: ClientStorageAdapter | null = null;

export function setTauriBridge(adapter: ClientStorageAdapter): void {
  _adapter = adapter;
}

export function isTauriBridgeActive(): boolean {
  return _adapter !== null && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Route an API path to the local TauriStorageAdapter.
 * Returns the response data or throws on error.
 */
export async function tauriFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!_adapter) throw new Error("Tauri bridge not initialized");

  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  // POST /api/books/create
  if (path === "/api/books/create" && method === "POST") {
    const result = await _adapter.createBook(body);
    return result as T;
  }

  // GET /api/books
  if (path === "/api/books" && method === "GET") {
    const books = await _adapter.listBooks();
    return { books } as T;
  }

  // GET /api/books/:id
  const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
  if (bookMatch && method === "GET") {
    const data = await _adapter.loadBook(bookMatch[1]);
    return data as T;
  }

  // GET /api/books/:id/chapters
  const chaptersMatch = path.match(/^\/api\/books\/([^/]+)\/chapters$/);
  if (chaptersMatch && method === "GET") {
    const data = await _adapter.loadBook(chaptersMatch[1]);
    return { chapters: data.chapters } as T;
  }

  // GET /api/books/:id/chapters/:num
  const chapterMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)$/);
  if (chapterMatch && method === "GET") {
    const detail = await _adapter.loadChapter(chapterMatch[1], Number(chapterMatch[2]));
    return detail as T;
  }

  // PUT /api/books/:id/chapters/:num
  if (chapterMatch && method === "PUT") {
    await _adapter.saveChapter(chapterMatch[1], Number(chapterMatch[2]), body?.content ?? "");
    return { ok: true } as T;
  }

  // POST /api/books/:id/chapters/:num/approve
  const approveMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/approve$/);
  if (approveMatch && method === "POST") {
    await _adapter.approveChapter(approveMatch[1], Number(approveMatch[2]));
    return { ok: true } as T;
  }

  // POST /api/books/:id/chapters/:num/reject
  const rejectMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/reject$/);
  if (rejectMatch && method === "POST") {
    await _adapter.rejectChapter(rejectMatch[1], Number(rejectMatch[2]));
    return { ok: true } as T;
  }

  // PUT /api/books/:id
  if (bookMatch && method === "PUT") {
    await _adapter.updateBook(bookMatch[1], body);
    return { ok: true } as T;
  }

  // DELETE /api/books/:id
  if (bookMatch && method === "DELETE") {
    await _adapter.deleteBook(bookMatch[1]);
    return { ok: true } as T;
  }

  // GET /api/books/:id/truth
  const truthMatch = path.match(/^\/api\/books\/([^/]+)\/truth$/);
  if (truthMatch && method === "GET") {
    const files = await _adapter.listTruthFiles(truthMatch[1]);
    return { files } as T;
  }

  // GET /api/books/:id/truth/:file
  const truthFileMatch = path.match(/^\/api\/books\/([^/]+)\/truth\/(.+)$/);
  if (truthFileMatch && method === "GET") {
    const content = await _adapter.loadTruthFile(truthFileMatch[1], truthFileMatch[2]);
    return content as T;
  }

  // PUT /api/books/:id/truth/:file
  if (truthFileMatch && method === "PUT") {
    await _adapter.saveTruthFile(truthFileMatch[1], truthFileMatch[2], body?.content ?? "");
    return { ok: true } as T;
  }

  // GET /api/project
  if (path === "/api/project" && method === "GET") {
    const config = await _adapter.loadProject();
    return config as T;
  }

  // PUT /api/project
  if (path === "/api/project" && method === "PUT") {
    await _adapter.updateProject(body);
    return { ok: true } as T;
  }

  // POST /api/project/language
  if (path === "/api/project/language" && method === "POST") {
    await _adapter.updateProject({ language: body?.language });
    return { ok: true } as T;
  }

  // GET /api/project/model-overrides — 读取模型路由覆盖
  if (path === "/api/project/model-overrides" && method === "GET") {
    try {
      const raw = await invoke<string>("read_file_text", { path: join(ws(), "novelfork.json") });
      const config = JSON.parse(raw) as Record<string, unknown>;
      return { overrides: config.modelOverrides ?? {} } as T;
    } catch {
      return { overrides: {} } as T;
    }
  }

  // PUT /api/project/model-overrides — 保存模型路由覆盖
  if (path === "/api/project/model-overrides" && method === "PUT") {
    const configPath = join(ws(), "novelfork.json");
    let config: Record<string, unknown> = {};
    try {
      const raw = await invoke<string>("read_file_text", { path: configPath });
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* new file */ }
    config.modelOverrides = body?.overrides ?? {};
    await invoke("write_file_text", { path: configPath, content: JSON.stringify(config, null, 2) });
    return { ok: true } as T;
  }

  // GET /api/auth/me — always authenticated in Tauri
  if (path === "/api/auth/me") {
    return { session: { userId: 0, email: "local" } } as T;
  }

  // GET /api/mode
  if (path === "/api/mode") {
    return { mode: "tauri" } as T;
  }

  // GET /api/daemon — 返回守护进程状态
  if (path === "/api/daemon" && method === "GET") {
    return {
      running: _daemonRunning,
      log: _daemonLog.slice(-20),
      intervalMinutes: _daemonIntervalMinutes,
    } as T;
  }

  // POST /api/daemon/start — 启动本地守护进程
  if (path === "/api/daemon/start" && method === "POST") {
    if (_daemonRunning) return { ok: true, message: "already running" } as T;
    const minutes = (body?.intervalMinutes as number) || _daemonIntervalMinutes;
    _daemonIntervalMinutes = Math.max(1, Math.min(60, minutes));
    _daemonRunning = true;
    daemonAddLog("daemon:started", `守护进程已启动，间隔 ${_daemonIntervalMinutes} 分钟`);
    // 立即执行一次
    void daemonTick(_adapter!);
    _daemonInterval = setInterval(() => {
      if (_daemonRunning && _adapter) void daemonTick(_adapter);
    }, _daemonIntervalMinutes * 60 * 1000);
    return { ok: true } as T;
  }

  // POST /api/daemon/stop — 停止本地守护进程
  if (path === "/api/daemon/stop" && method === "POST") {
    if (_daemonInterval) {
      clearInterval(_daemonInterval);
      _daemonInterval = null;
    }
    _daemonRunning = false;
    daemonAddLog("daemon:stopped", "守护进程已停止");
    return { ok: true } as T;
  }

  // GET /api/genres — 内置 + 项目自定义流派列表
  if (path === "/api/genres" && method === "GET") {
    const genreMap = new Map<string, { id: string; name: string; source: string; language: string }>();
    // 内置流派
    for (const [id, g] of Object.entries(BUILTIN_GENRES)) {
      genreMap.set(id, { id, name: g.profile.name, source: "builtin", language: g.profile.language });
    }
    // 项目自定义流派（覆盖同名内置）
    try {
      const genresDir = join(ws(), "genres");
      const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: genresDir });
      for (const e of entries) {
        if (e.is_dir || !e.name.endsWith(".md")) continue;
        const id = e.name.replace(/\.md$/, "");
        try {
          const raw = await invoke<string>("read_file_text", { path: join(genresDir, e.name) });
          const parsed = parseGenreFrontmatter(raw);
          genreMap.set(id, { id, name: parsed.profile.name || id, source: "project", language: parsed.profile.language });
        } catch { /* 跳过损坏文件 */ }
      }
    } catch { /* 无 workspace 或 genres 目录 */ }
    const genres = [...genreMap.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { genres } as T;
  }

  // GET /api/books/:id/create-status
  const createStatusMatch = path.match(/^\/api\/books\/([^/]+)\/create-status$/);
  if (createStatusMatch && method === "GET") {
    return { status: "ready" } as T;
  }

  // ── 流派管理 ──

  // GET /api/genres/:id — 流派详情（先查项目自定义，再查内置）
  const genreDetailMatch = path.match(/^\/api\/genres\/([^/]+)$/);
  if (genreDetailMatch && method === "GET") {
    const genreId = genreDetailMatch[1];
    // 先尝试读取项目自定义流派
    const genrePath = join(ws(), "genres", `${genreId}.md`);
    try {
      const raw = await invoke<string>("read_file_text", { path: genrePath });
      return parseGenreFrontmatter(raw) as T;
    } catch {
      // 回退到内置流派
      const builtin = BUILTIN_GENRES[genreId];
      if (builtin) return builtin as T;
      throw new Error(`Genre "${genreId}" not found`);
    }
  }

  // POST /api/genres/create — 创建自定义流派
  if (path === "/api/genres/create" && method === "POST") {
    if (!body?.id || !body?.name) throw new Error("id and name are required");
    const genresDir = join(ws(), "genres");
    await invoke("create_dir_all", { path: genresDir });
    const content = serializeGenreFrontmatter(body, body.body ?? "");
    await invoke("write_file_text", { path: join(genresDir, `${body.id}.md`), content });
    return { ok: true, id: body.id } as T;
  }

  // PUT /api/genres/:id — 更新流派
  if (genreDetailMatch && method === "PUT") {
    const genreId = genreDetailMatch[1];
    const genresDir = join(ws(), "genres");
    await invoke("create_dir_all", { path: genresDir });
    const p = body?.profile ?? {};
    const content = serializeGenreFrontmatter(p, body?.body ?? "");
    await invoke("write_file_text", { path: join(genresDir, `${genreId}.md`), content });
    return { ok: true, id: genreId } as T;
  }

  // DELETE /api/genres/:id — 删除项目自定义流派
  if (genreDetailMatch && method === "DELETE") {
    const genreId = genreDetailMatch[1];
    const filePath = join(ws(), "genres", `${genreId}.md`);
    try {
      await invoke("delete_path", { path: filePath });
      return { ok: true, id: genreId } as T;
    } catch {
      throw new Error(`Genre "${genreId}" not found in project`);
    }
  }

  // POST /api/genres/:id/copy — 复制内置流派到项目
  const genreCopyMatch = path.match(/^\/api\/genres\/([^/]+)\/copy$/);
  if (genreCopyMatch && method === "POST") {
    const genreId = genreCopyMatch[1];
    const builtin = BUILTIN_GENRES[genreId];
    if (!builtin) throw new Error(`Built-in genre "${genreId}" not found`);
    const genresDir = join(ws(), "genres");
    await invoke("create_dir_all", { path: genresDir });
    const content = serializeGenreFrontmatter(
      builtin.profile as unknown as Record<string, unknown>,
      builtin.body,
    );
    await invoke("write_file_text", { path: join(genresDir, `${genreId}.md`), content });
    return { ok: true, path: `genres/${genreId}.md` } as T;
  }

  // ── 搜索 ──

  // GET /api/search?q=... — 全文搜索所有书籍章节
  if (path.startsWith("/api/search") && method === "GET") {
    const urlObj = new URL(path, "http://localhost");
    const q = urlObj.searchParams.get("q")?.trim() ?? "";
    if (!q) return { hits: [] } as T;

    const hits: Array<{ bookId: string; bookTitle: string; chapterNumber: number; snippet: string }> = [];
    const booksDir = join(ws(), "books");
    let bookDirs: Array<{ name: string; is_dir: boolean }> = [];
    try { bookDirs = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: booksDir }); } catch { /* 无书籍 */ }

    for (const bd of bookDirs) {
      if (!bd.is_dir) continue;
      const bookId = bd.name;
      let bookTitle = bookId;
      try {
        const configRaw = await invoke<string>("read_file_text", { path: join(booksDir, bookId, "book.json") });
        const config = JSON.parse(configRaw) as { title?: string };
        bookTitle = config.title ?? bookId;
      } catch { /* 跳过 */ }

      const chaptersDir = join(booksDir, bookId, "chapters");
      let chapterFiles: Array<{ name: string; is_dir: boolean }> = [];
      try { chapterFiles = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }); } catch { continue; }

      const mdFiles = chapterFiles.filter(f => !f.is_dir && f.name.endsWith(".md") && /^\d{4}/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const f of mdFiles) {
        try {
          const content = await invoke<string>("read_file_text", { path: join(chaptersDir, f.name) });
          const chapterNum = parseInt(f.name.slice(0, 4), 10);
          const lowerQ = q.toLowerCase();
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQ)) {
              // 提取上下文片段
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              const snippet = lines.slice(start, end).join("\n").slice(0, 200);
              hits.push({ bookId, bookTitle, chapterNumber: chapterNum, snippet });
              break; // 每章只取第一个匹配
            }
          }
        } catch { /* 跳过不可读文件 */ }
      }
    }
    return { hits } as T;
  }

  // ── 数据分析 ──

  // GET /api/books/:id/analytics — 书籍统计
  const analyticsMatch = path.match(/^\/api\/books\/([^/]+)\/analytics$/);
  if (analyticsMatch && method === "GET") {
    const bookId = analyticsMatch[1];
    const indexPath = join(ws(), "books", bookId, "chapter_index.json");
    let chapters: Array<{ number: number; status: string; wordCount?: number }> = [];
    try {
      const raw = await invoke<string>("read_file_text", { path: indexPath });
      chapters = JSON.parse(raw) as typeof chapters;
    } catch { /* 无索引 */ }

    // 如果 index 没有 wordCount，从文件读取
    let totalWords = 0;
    const chaptersDir = join(ws(), "books", bookId, "chapters");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }).catch(() => []);
    const mdFiles = entries.filter(e => !e.is_dir && e.name.endsWith(".md") && /^\d{4}/.test(e.name));

    for (const f of mdFiles) {
      try {
        const content = await invoke<string>("read_file_text", { path: join(chaptersDir, f.name) });
        totalWords += countWords(content);
      } catch { /* 跳过 */ }
    }

    const statusDist: Record<string, number> = {};
    for (const ch of chapters) {
      const s = ch.status ?? "draft";
      statusDist[s] = (statusDist[s] ?? 0) + 1;
    }

    const totalChapters = Math.max(chapters.length, mdFiles.length);
    return {
      bookId,
      totalChapters,
      totalWords,
      avgWordsPerChapter: totalChapters > 0 ? Math.round(totalWords / totalChapters) : 0,
      statusDistribution: statusDist,
    } as T;
  }

  // ── 导入 ──

  // POST /api/books/:id/import/chapters — 导入章节文本
  const importChaptersMatch = path.match(/^\/api\/books\/([^/]+)\/import\/chapters$/);
  if (importChaptersMatch && method === "POST") {
    const bookId = importChaptersMatch[1];
    const { text, splitRegex } = body as { text: string; splitRegex?: string };
    if (!text?.trim()) throw new Error("导入文本不能为空");

    // 按正则或默认按空行分割
    const pattern = splitRegex ? new RegExp(splitRegex, "gm") : /\n{2,}/;
    const parts = text.split(pattern).map(s => s.trim()).filter(Boolean);

    const indexPath = join(ws(), "books", bookId, "chapter_index.json");
    const chaptersDir = join(ws(), "books", bookId, "chapters");
    await invoke("create_dir_all", { path: chaptersDir });

    // 读取现有索引
    let index: Array<{ number: number; title: string; status: string; wordCount: number }> = [];
    try {
      const raw = await invoke<string>("read_file_text", { path: indexPath });
      index = JSON.parse(raw) as typeof index;
    } catch { /* 新索引 */ }

    const startNum = index.length > 0 ? Math.max(...index.map(c => c.number)) + 1 : 1;
    let imported = 0;

    for (let i = 0; i < parts.length; i++) {
      const num = startNum + i;
      const padded = String(num).padStart(4, "0");
      // 尝试从第一行提取标题
      const firstLine = parts[i].split("\n")[0].replace(/^#+\s*/, "").trim();
      const title = firstLine.slice(0, 50) || `第${num}章`;
      const content = parts[i];
      const wc = countWords(content);

      await invoke("write_file_text", {
        path: join(chaptersDir, `${padded}-${title.replace(/[/\\:*?"<>|]/g, "_")}.md`),
        content,
      });
      index.push({ number: num, title, status: "draft", wordCount: wc });
      imported++;
    }

    await invoke("write_file_text", { path: indexPath, content: JSON.stringify(index, null, 2) });
    return { ok: true, importedCount: imported } as T;
  }

  // POST /api/books/:id/import/canon — 导入原作素材
  const importCanonMatch = path.match(/^\/api\/books\/([^/]+)\/import\/canon$/);
  if (importCanonMatch && method === "POST") {
    const bookId = importCanonMatch[1];
    const { fromBookId } = body as { fromBookId: string };
    if (!fromBookId) throw new Error("fromBookId is required");

    // 读取源书籍的 story 目录内容，复制到目标书籍
    const srcStoryDir = join(ws(), "books", fromBookId, "story");
    const dstStoryDir = join(ws(), "books", bookId, "story");
    await invoke("create_dir_all", { path: dstStoryDir });

    const srcFiles = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: srcStoryDir }).catch(() => []);
    let copied = 0;
    for (const f of srcFiles) {
      if (f.is_dir) continue;
      try {
        const content = await invoke<string>("read_file_text", { path: join(srcStoryDir, f.name) });
        await invoke("write_file_text", { path: join(dstStoryDir, f.name), content });
        copied++;
      } catch { /* 跳过 */ }
    }

    // 同时读取源书籍所有章节合并为 fanfic_canon.md
    const srcChaptersDir = join(ws(), "books", fromBookId, "chapters");
    const chapterEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: srcChaptersDir }).catch(() => []);
    const mdFiles = chapterEntries.filter(e => !e.is_dir && e.name.endsWith(".md") && /^\d{4}/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const allContent: string[] = [];
    for (const f of mdFiles) {
      try {
        const c = await invoke<string>("read_file_text", { path: join(srcChaptersDir, f.name) });
        allContent.push(c);
      } catch { /* 跳过 */ }
    }
    if (allContent.length > 0) {
      await invoke("write_file_text", {
        path: join(dstStoryDir, "fanfic_canon.md"),
        content: allContent.join("\n\n---\n\n"),
      });
    }

    return { ok: true, copiedFiles: copied } as T;
  }

  // POST /api/fanfic/init — 初始化同人模式
  if (path === "/api/fanfic/init" && method === "POST") {
    const { title, sourceText, mode, genre, language } = body as {
      title: string; sourceText: string; mode?: string; genre?: string; language?: string;
    };
    if (!title?.trim() || !sourceText?.trim()) throw new Error("title and sourceText are required");

    // 创建新书
    const result = await _adapter.createBook({
      title,
      genre: genre ?? "other",
      language: language ?? "zh",
    });
    const bookId = result.bookId;

    // 更新 book.json 添加 fanficMode
    const configPath = join(ws(), "books", bookId, "book.json");
    const configRaw = await invoke<string>("read_file_text", { path: configPath });
    const config = JSON.parse(configRaw) as Record<string, unknown>;
    config.fanficMode = mode ?? "canon";
    await invoke("write_file_text", { path: configPath, content: JSON.stringify(config, null, 2) });

    // 保存原作文本到 story/fanfic_canon.md
    const storyDir = join(ws(), "books", bookId, "story");
    await invoke("create_dir_all", { path: storyDir });
    await invoke("write_file_text", {
      path: join(storyDir, "fanfic_canon.md"),
      content: sourceText,
    });

    return { ok: true, bookId } as T;
  }

  // ── 导出 ──

  // GET /api/books/:id/export — 导出书籍全文
  const exportMatch = path.match(/^\/api\/books\/([^/]+)\/export/);
  if (exportMatch && method === "GET") {
    const bookId = exportMatch[1];
    const urlObj = new URL(path, "http://localhost");
    const format = urlObj.searchParams.get("format") ?? "txt";
    const approvedOnly = urlObj.searchParams.get("approvedOnly") === "true";

    const chaptersDir = join(ws(), "books", bookId, "chapters");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }).catch(() => []);
    let mdFiles = entries.filter(e => !e.is_dir && e.name.endsWith(".md") && /^\d{4}/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));

    if (approvedOnly) {
      const indexPath = join(ws(), "books", bookId, "chapter_index.json");
      try {
        const raw = await invoke<string>("read_file_text", { path: indexPath });
        const index = JSON.parse(raw) as Array<{ number: number; status: string }>;
        const approvedNums = new Set(index.filter(ch => ch.status === "approved").map(ch => ch.number));
        mdFiles = mdFiles.filter(f => approvedNums.has(parseInt(f.name.slice(0, 4), 10)));
      } catch { /* 无索引则导出全部 */ }
    }

    const contents: string[] = [];
    for (const f of mdFiles) {
      try {
        const c = await invoke<string>("read_file_text", { path: join(chaptersDir, f.name) });
        contents.push(c);
      } catch { /* 跳过 */ }
    }

    const separator = format === "md" ? "\n\n---\n\n" : "\n\n";
    const text = contents.join(separator);

    // Tauri 模式下返回文本内容供前端处理（兼容 Dashboard 的 content/filename 和 BookDetail 的 text/format）
    const ext = format === "md" ? ".md" : format === "epub" ? ".html" : ".txt";
    return { text, content: text, format, filename: `${bookId}${ext}`, chapters: contents.length } as T;
  }

  // POST /api/books/:id/export-save — 导出并保存到本地
  const exportSaveMatch = path.match(/^\/api\/books\/([^/]+)\/export-save$/);
  if (exportSaveMatch && method === "POST") {
    const bookId = exportSaveMatch[1];
    const { format, approvedOnly } = (body ?? {}) as { format?: string; approvedOnly?: boolean };
    const fmt = format ?? "txt";

    const chaptersDir = join(ws(), "books", bookId, "chapters");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }).catch(() => []);
    let mdFiles = entries.filter(e => !e.is_dir && e.name.endsWith(".md") && /^\d{4}/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));

    if (approvedOnly) {
      const indexPath = join(ws(), "books", bookId, "chapter_index.json");
      try {
        const raw = await invoke<string>("read_file_text", { path: indexPath });
        const index = JSON.parse(raw) as Array<{ number: number; status: string }>;
        const approvedNums = new Set(index.filter(ch => ch.status === "approved").map(ch => ch.number));
        mdFiles = mdFiles.filter(f => approvedNums.has(parseInt(f.name.slice(0, 4), 10)));
      } catch { /* 无索引 */ }
    }

    const contents: string[] = [];
    for (const f of mdFiles) {
      try {
        const c = await invoke<string>("read_file_text", { path: join(chaptersDir, f.name) });
        contents.push(c);
      } catch { /* 跳过 */ }
    }

    const separator = fmt === "md" ? "\n\n---\n\n" : "\n\n";
    const text = contents.join(separator);
    const ext = fmt === "md" ? ".md" : fmt === "epub" ? ".html" : ".txt";
    const outputPath = join(ws(), "books", bookId, `${bookId}${ext}`);
    await invoke("write_file_text", { path: outputPath, content: text });

    return { ok: true, path: outputPath, format: fmt, chapters: mdFiles.length } as T;
  }

  // ── 版本对比 (DiffView) ──

  // GET /api/books/:id/chapters/:num/versions — 列出章节版本
  const versionsMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/versions$/);
  if (versionsMatch && method === "GET") {
    const bookId = versionsMatch[1];
    const num = Number(versionsMatch[2]);
    const padded = String(num).padStart(4, "0");
    const versionsDir = join(ws(), "books", bookId, "chapters", ".versions", padded);

    const versions: Array<{ version: number; timestamp: string; wordCount: number }> = [];
    try {
      const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: versionsDir });
      const jsonFiles = entries.filter(e => !e.is_dir && e.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
      for (let i = 0; i < jsonFiles.length; i++) {
        try {
          const raw = await invoke<string>("read_file_text", { path: join(versionsDir, jsonFiles[i].name) });
          const meta = JSON.parse(raw) as { timestamp: string; wordCount: number };
          versions.push({ version: i + 1, timestamp: meta.timestamp, wordCount: meta.wordCount });
        } catch { /* 跳过损坏的版本 */ }
      }
    } catch { /* 无版本目录 */ }

    return versions as T;
  }

  // GET /api/books/:id/chapters/:num/diff?from=&to= — 对比两个版本
  const diffMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/diff/);
  if (diffMatch && method === "GET") {
    const bookId = diffMatch[1];
    const num = Number(diffMatch[2]);
    const padded = String(num).padStart(4, "0");
    const urlObj = new URL(path, "http://localhost");
    const fromV = Number(urlObj.searchParams.get("from") ?? "1");
    const toV = Number(urlObj.searchParams.get("to") ?? "2");

    const versionsDir = join(ws(), "books", bookId, "chapters", ".versions", padded);
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: versionsDir }).catch(() => []);
    const jsonFiles = entries.filter(e => !e.is_dir && e.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));

    // 读取对应版本的内容文件（.md，与 .json 同名）
    const readVersionContent = async (versionIdx: number): Promise<string> => {
      if (versionIdx < 1 || versionIdx > jsonFiles.length) return "";
      const baseName = jsonFiles[versionIdx - 1].name.replace(/\.json$/, ".md");
      try {
        return await invoke<string>("read_file_text", { path: join(versionsDir, baseName) });
      } catch { return ""; }
    };

    const fromContent = await readVersionContent(fromV);
    const toContent = await readVersionContent(toV);

    // 简易 diff：按行对比生成 hunks
    const fromLines = fromContent.split("\n");
    const toLines = toContent.split("\n");
    const hunks: Array<{ type: "add" | "remove" | "context"; lines: string[] }> = [];

    const maxLen = Math.max(fromLines.length, toLines.length);
    for (let i = 0; i < maxLen; i++) {
      const fl = i < fromLines.length ? fromLines[i] : undefined;
      const tl = i < toLines.length ? toLines[i] : undefined;
      if (fl === tl) {
        hunks.push({ type: "context", lines: [fl ?? ""] });
      } else {
        if (fl !== undefined) hunks.push({ type: "remove", lines: [fl] });
        if (tl !== undefined) hunks.push({ type: "add", lines: [tl] });
      }
    }

    return { hunks } as T;
  }

  // ── AI 路由：使用用户自配置的 LLM ──

  // POST /api/style/analyze — 文风分析
  if (path === "/api/style/analyze" && method === "POST") {
    const { text, sourceName } = body as { text: string; sourceName?: string };
    if (!text?.trim()) throw new Error("分析文本不能为空");
    const raw = await callUserLLM([
      { role: "system", content: "你是一个专业的文学风格分析师。分析给定文本的写作风格，返回严格的 JSON（不要 markdown 代码块）：{\"sourceName\":\"来源名称\",\"avgSentenceLength\":数字,\"sentenceLengthStdDev\":数字,\"avgParagraphLength\":数字,\"vocabularyDiversity\":0到1的数字,\"topPatterns\":[\"模式1\",\"模式2\"],\"rhetoricalFeatures\":[\"特征1\",\"特征2\"]}" },
      { role: "user", content: `分析以下文本的写作风格。来源: "${sourceName ?? "sample"}"\n\n${text.slice(0, 8000)}` },
    ], { temperature: 0.3 });
    const jsonStr = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    try { return JSON.parse(jsonStr) as T; }
    catch { throw new Error(`LLM 返回的风格分析结果无法解析为 JSON: ${raw.slice(0, 200)}`); }
  }

  // POST /api/books/:id/style/import — 导入风格到书籍
  const styleImportMatch = path.match(/^\/api\/books\/([^/]+)\/style\/import$/);
  if (styleImportMatch && method === "POST") {
    const bookId = styleImportMatch[1]!;
    const { text, sourceName } = body as { text: string; sourceName?: string };
    if (!text?.trim()) throw new Error("导入文本不能为空");
    const raw = await callUserLLM([
      { role: "system", content: "你是一个专业的文学风格分析师。分析给定文本并生成风格指南，返回严格的 JSON（不要 markdown 代码块）：{\"sourceName\":\"来源\",\"avgSentenceLength\":数字,\"sentenceLengthStdDev\":数字,\"avgParagraphLength\":数字,\"vocabularyDiversity\":0到1的数字,\"topPatterns\":[\"模式1\"],\"rhetoricalFeatures\":[\"特征1\"],\"styleGuide\":\"风格要点描述\"}" },
      { role: "user", content: `分析以下文本并生成风格指南。来源: "${sourceName ?? "sample"}"\n\n${text.slice(0, 8000)}` },
    ], { temperature: 0.3 });
    const jsonStr = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    let styleData: Record<string, unknown>;
    try { styleData = JSON.parse(jsonStr) as Record<string, unknown>; }
    catch { throw new Error(`LLM 返回的风格数据无法解析: ${raw.slice(0, 200)}`); }
    await _adapter.saveTruthFile(bookId, "style-guide.json", JSON.stringify(styleData, null, 2));
    return { ok: true, style: styleData } as T;
  }

  // POST /api/radar/scan — 市场趋势扫描
  if (path === "/api/radar/scan" && method === "POST") {
    const raw = await callUserLLM([
      { role: "system", content: "你是一个网文市场分析专家。分析当前网文/轻小说市场趋势，返回严格的 JSON（不要 markdown 代码块）：{\"marketSummary\":\"市场概况（200-400字）\",\"recommendations\":[{\"confidence\":0到1的数字,\"platform\":\"平台\",\"genre\":\"题材\",\"concept\":\"一句话概念\",\"reasoning\":\"推荐理由\",\"benchmarkTitles\":[\"参考作品\"]}]} 提供 3-5 条推荐。" },
      { role: "user", content: "请分析当前网文市场趋势，给出题材和平台推荐。" },
    ], { temperature: 0.8, maxTokens: 4096 });
    const jsonStr = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    try { return JSON.parse(jsonStr) as T; }
    catch { throw new Error(`LLM 返回的市场分析结果无法解析: ${raw.slice(0, 200)}`); }
  }

  // POST /api/agent — 聊天助手
  if (path === "/api/agent" && method === "POST") {
    const { instruction } = body as { instruction: string };
    if (!instruction?.trim()) return { response: "请输入指令。" } as T;
    const response = await callUserLLM([
      { role: "system", content: "你是 NovelFork 写作助手，帮助用户进行小说创作。可以回答写作问题、提供创意建议、帮助构思情节角色世界观、给出写作技巧。用简洁友好的语气回复。" },
      { role: "user", content: instruction },
    ], { temperature: 0.7 });
    return { response } as T;
  }

  // GET /api/doctor — 本地环境诊断
  if (path === "/api/doctor" && method === "GET") {
    let workspace: string | null = null;
    try { workspace = ws(); } catch { /* no workspace */ }

    // 1. novelfork.json 是否存在且可解析
    let projectConfig = false;
    if (workspace) {
      try {
        const raw = await invoke<string>("read_file_text", { path: join(workspace, "novelfork.json") });
        JSON.parse(raw);
        projectConfig = true;
      } catch { /* 不存在或解析失败 */ }
    }

    // 2. books/ 目录是否存在，统计书籍数
    let booksDir = false;
    let bookCount = 0;
    const booksDirPath = workspace ? join(workspace, "books") : "";
    if (workspace) {
      try {
        const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: booksDirPath });
        booksDir = true;
        bookCount = entries.filter(e => e.is_dir).length;
      } catch { /* 目录不存在 */ }
    }

    // 3. LLM 配置是否完整（不实际调用 API，避免产生费用）
    let llmConnected = false;
    try {
      const profiles = loadAllProfiles();
      if (profiles.length > 0) {
        const active = profiles.find(p => p.name === (localStorage.getItem(ACTIVE_KEY) ?? "")) ?? profiles[0];
        llmConnected = !!(active.baseUrl && active.model && (active.apiKey || active.provider === "ollama"));
      }
    } catch { /* 解析失败 */ }

    // 4. 章节索引一致性：每本书的 chapter_index.json 与实际 .md 文件匹配
    let chapterConsistencyOk = true;
    if (booksDir) {
      try {
        const bookEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: booksDirPath });
        for (const bd of bookEntries) {
          if (!bd.is_dir) continue;
          const indexPath = join(booksDirPath, bd.name, "chapter_index.json");
          const chapDir = join(booksDirPath, bd.name, "chapters");
          try {
            const indexRaw = await invoke<string>("read_file_text", { path: indexPath });
            const index = JSON.parse(indexRaw) as Array<{ number: number }>;
            const indexNums = new Set(index.map(c => c.number));
            const files = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chapDir }).catch(() => []);
            const fileNums = new Set(
              files.filter(f => !f.is_dir && f.name.endsWith(".md") && /^\d{4}/.test(f.name))
                .map(f => parseInt(f.name.slice(0, 4), 10)),
            );
            if (indexNums.size !== fileNums.size) { chapterConsistencyOk = false; break; }
            for (const n of indexNums) {
              if (!fileNums.has(n)) { chapterConsistencyOk = false; break; }
            }
            if (!chapterConsistencyOk) break;
          } catch { /* 无索引文件视为一致（新书） */ }
        }
      } catch { /* 读取失败 */ }
    }

    // 5. genres/ 目录是否存在且自定义流派可解析
    let genresDirOk = true;
    if (workspace) {
      const genresDirPath = join(workspace, "genres");
      try {
        const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: genresDirPath });
        for (const e of entries) {
          if (e.is_dir || !e.name.endsWith(".md")) continue;
          try {
            const raw = await invoke<string>("read_file_text", { path: join(genresDirPath, e.name) });
            parseGenreFrontmatter(raw);
          } catch {
            genresDirOk = false;
            break;
          }
        }
      } catch {
        // genres 目录不存在也算正常（使用内置流派）
      }
    }

    return {
      projectConfig,
      projectEnv: chapterConsistencyOk,  // 复用：章节索引一致性
      globalEnv: genresDirOk,            // 复用：题材目录有效性
      booksDir,
      llmConnected,
      bookCount,
    } as T;
  }

  // ── LLM 多配置管理路由 ──

  // GET /api/llm/profiles — 列出所有配置
  if (path === "/api/llm/profiles" && method === "GET") {
    const profiles = loadAllProfiles();
    const active = localStorage.getItem(ACTIVE_KEY) ?? (profiles[0]?.name ?? "");
    return {
      profiles: profiles.map(p => ({
        ...p,
        apiKey: p.apiKey ? `${p.apiKey.slice(0, 6)}...${p.apiKey.slice(-4)}` : "",
      })),
      active,
    } as T;
  }

  // POST /api/llm/profiles — 新增配置
  if (path === "/api/llm/profiles" && method === "POST") {
    const body = JSON.parse(init?.body as string ?? "{}") as LLMProfile;
    if (!body.name?.trim()) throw new Error("配置名称不能为空");
    const profiles = loadAllProfiles();
    if (profiles.some(p => p.name === body.name)) throw new Error(`配置「${body.name}」已存在`);
    profiles.push({
      name: body.name.trim(),
      provider: body.provider || "openai",
      apiKey: body.apiKey || "",
      baseUrl: body.baseUrl || "",
      model: body.model || "gpt-4o",
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });
    saveAllProfiles(profiles);
    if (profiles.length === 1) localStorage.setItem(ACTIVE_KEY, body.name.trim());
    return { ok: true } as T;
  }

  // PUT /api/llm/profiles/:name — 更新配置
  if (path.startsWith("/api/llm/profiles/") && method === "PUT") {
    const name = decodeURIComponent(path.slice("/api/llm/profiles/".length));
    const body = JSON.parse(init?.body as string ?? "{}") as Partial<LLMProfile>;
    const profiles = loadAllProfiles();
    const idx = profiles.findIndex(p => p.name === name);
    if (idx < 0) throw new Error(`配置「${name}」不存在`);
    const old = profiles[idx];
    profiles[idx] = {
      name: body.name?.trim() || old.name,
      provider: body.provider ?? old.provider,
      apiKey: body.apiKey || old.apiKey,  // 空字符串保留旧值
      baseUrl: body.baseUrl ?? old.baseUrl,
      model: body.model ?? old.model,
      temperature: body.temperature ?? old.temperature,
      maxTokens: body.maxTokens ?? old.maxTokens,
    };
    saveAllProfiles(profiles);
    // 如果改了名字，同步 active
    if (body.name && body.name !== name && localStorage.getItem(ACTIVE_KEY) === name) {
      localStorage.setItem(ACTIVE_KEY, body.name.trim());
    }
    return { ok: true } as T;
  }

  // DELETE /api/llm/profiles/:name — 删除配置
  if (path.startsWith("/api/llm/profiles/") && method === "DELETE") {
    const name = decodeURIComponent(path.slice("/api/llm/profiles/".length));
    const profiles = loadAllProfiles();
    const filtered = profiles.filter(p => p.name !== name);
    if (filtered.length === profiles.length) throw new Error(`配置「${name}」不存在`);
    saveAllProfiles(filtered);
    if (localStorage.getItem(ACTIVE_KEY) === name) {
      localStorage.setItem(ACTIVE_KEY, filtered[0]?.name ?? "");
    }
    return { ok: true } as T;
  }

  // PUT /api/llm/active — 切换激活配置
  if (path === "/api/llm/active" && method === "PUT") {
    const body = JSON.parse(init?.body as string ?? "{}") as { name: string };
    const profiles = loadAllProfiles();
    if (!profiles.some(p => p.name === body.name)) throw new Error(`配置「${body.name}」不存在`);
    localStorage.setItem(ACTIVE_KEY, body.name);
    return { ok: true } as T;
  }

  // POST /api/llm/test — 测试当前激活配置连通性 + 获取模型列表
  if (path === "/api/llm/test" && method === "POST") {
    const profile = loadActiveProfile();
    let models: string[] = [];
    let testReply = "";
    let testError = "";

    // 1. 尝试获取模型列表
    try {
      models = await fetchUpstreamModels(profile);
    } catch { /* 部分 API 不支持 /models */ }

    // 2. 测试实际调用
    try {
      testReply = (await callUserLLM([{ role: "user", content: "Say OK" }], { maxTokens: 16 })).slice(0, 100);
    } catch (err) {
      testError = err instanceof Error ? err.message : String(err);
    }

    return {
      ok: !testError,
      reply: testReply || undefined,
      error: testError || undefined,
      models,
    } as T;
  }

  // Fallback — unsupported route
  throw new Error(`Tauri bridge: unsupported route ${method} ${path}`);
}