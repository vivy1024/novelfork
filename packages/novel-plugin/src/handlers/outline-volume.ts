/**
 * outline.volume — 卷级大纲（volume outline）读写与建议。
 *
 * 结构化真相存经纬 outline 条目的 fields_json.volumes；volume_outline.md 只是作者可读导出物。
 * 不写 lore canon；suggest 只出草案，需 action=set 才落盘。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import {
  findLedgerEntryByTitle,
  upsertLedgerEntry,
} from "./jingwei-ledger-store.js";
import {
  checkOverdraft,
  parseEndgameReserve,
  type EndgameReserve,
  type OverdraftReport,
} from "./endgame-reserve.js";
import { DEFAULT_VOLUME_DIRECTORY, volumeDirectoryName } from "../engine/writing-resource/chapter-layout.js";

export type VolumeStatus = "planned" | "active" | "done";
export type MainlineBeatStatus = "planned" | "active" | "done";

export interface VolumeMainlineBeat {
  readonly id: string;
  readonly title: string;
  readonly status: MainlineBeatStatus;
  readonly notes?: string;
}

/** 卷纲在经纬中的条目标题（唯一权威承载）。 */
const VOLUME_ENTRY_TITLE = "卷纲";

export interface VolumeEntry {
  readonly id: string;
  readonly title: string;
  readonly chapterRange: { readonly from: number; readonly to: number };
  readonly goal: string;
  readonly status: VolumeStatus;
  /** 本卷目标章数/字数：用于进度展示，不直接替代 chapterRange 硬门。 */
  readonly targetChapters?: number;
  readonly targetWords?: number;
  /** 本卷必须推进的主线节点；完成状态用于上下文和驾驶舱展示。 */
  readonly mainlineBeats?: readonly VolumeMainlineBeat[];
  readonly notes?: string;
}

export interface VolumeOutline {
  readonly bookId: string;
  readonly volumes: readonly VolumeEntry[];
  readonly updatedAt: string;
  /**
   * 终局储备：全书级的底牌与升级台阶账，不属于任何单卷。
   * 用于回答「牌还剩多少」，防止中盘把宿敌/真相/境界一次打光。
   */
  readonly endgameReserve?: EndgameReserve | null;
}

export type OutlineVolumeAction = "get" | "set" | "suggest";

export interface OutlineVolumeInput {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly action?: string;
  readonly volumes?: readonly unknown[];
  /** suggest 用：目标卷数（默认 3） */
  readonly volumeCount?: number;
  /** suggest 用：全书目标章数（默认读 book.json targetChapters） */
  readonly targetChapters?: number;
  /** set 用：终局储备账（底牌与升级台阶）。不传则保留已有。 */
  readonly endgameReserve?: unknown;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
  readonly generateText?: (input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
}

export interface OutlineVolumeResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly action: OutlineVolumeAction;
  readonly outline: VolumeOutline | null;
  readonly currentVolume: VolumeEntry | null;
  /** suggest 结果（未落盘） */
  readonly suggestion?: readonly VolumeEntry[];
  readonly writtenFiles: readonly string[];
  readonly summary: string;
  readonly error?: string;
  /** 透支两问的结果；get/set 都会给，便于写卷纲时立刻看到风险。 */
  readonly overdraft?: OverdraftReport;
}

const VOLUME_JSON = "volume_outline.json";
const VOLUME_MD = "volume_outline.md";

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseAction(value: unknown): OutlineVolumeAction {
  const action = trimText(value).toLowerCase();
  return action === "set" || action === "suggest" ? action : "get";
}

function parseStatus(value: unknown): VolumeStatus {
  const status = trimText(value).toLowerCase();
  return status === "active" || status === "done" ? status : "planned";
}

function positiveInt(value: unknown, fallback: number): number {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function optionalPositiveInt(value: unknown): number | undefined {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function parseMainlineBeatStatus(value: unknown): MainlineBeatStatus {
  const status = trimText(value).toLowerCase();
  return status === "active" || status === "done" ? status : "planned";
}

function normalizeMainlineBeats(value: unknown): VolumeMainlineBeat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = trimText(record.title ?? record.name);
    if (!title) return [];
    return [{
      id: trimText(record.id) || `beat-${index + 1}`,
      title,
      status: parseMainlineBeatStatus(record.status),
      ...(trimText(record.notes) ? { notes: trimText(record.notes) } : {}),
    }];
  });
}

/** 归一化外部传入的 volumes；非法条目被丢弃。 */
export function normalizeVolumes(input: readonly unknown[] | undefined): VolumeEntry[] {
  if (!Array.isArray(input)) return [];
  const out: VolumeEntry[] = [];
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = trimText(record.title);
    if (!title) continue;
    const range = (record.chapterRange ?? {}) as Record<string, unknown>;
    const from = positiveInt(range.from ?? record.startChapter, 1);
    const toRaw = positiveInt(range.to ?? record.endChapter, from);
    const targetChapters = optionalPositiveInt(record.targetChapters);
    const targetWords = optionalPositiveInt(record.targetWords);
    const mainlineBeats = normalizeMainlineBeats(record.mainlineBeats);
    out.push({
      id: trimText(record.id) || `vol-${index + 1}`,
      title,
      chapterRange: { from, to: Math.max(from, toRaw) },
      goal: trimText(record.goal),
      status: parseStatus(record.status),
      ...(targetChapters ? { targetChapters } : {}),
      ...(targetWords ? { targetWords } : {}),
      ...(mainlineBeats.length > 0 ? { mainlineBeats } : {}),
      ...(trimText(record.notes) ? { notes: trimText(record.notes) } : {}),
    });
  }
  return out.sort((left, right) => left.chapterRange.from - right.chapterRange.from);
}

/** 当前卷：优先 status=active；否则按最新已写章号落点；再否则第一卷。 */
export function pickCurrentVolume(
  volumes: readonly VolumeEntry[],
  latestChapter?: number,
): VolumeEntry | null {
  if (volumes.length === 0) return null;
  const active = volumes.find((volume) => volume.status === "active");
  if (active) return active;
  if (typeof latestChapter === "number" && latestChapter > 0) {
    const hit = volumes.find(
      (volume) => latestChapter >= volume.chapterRange.from && latestChapter <= volume.chapterRange.to,
    );
    if (hit) return hit;
  }
  return volumes[0] ?? null;
}

/**
 * 当前卷上下文。写作链路读取卷纲的唯一入口：
 * 此前 write-preflight 与 pipeline.write 各自实现一遍「当前卷」推导，
 * 结果卷目标只进了 preflight 结果、没进生成上下文。
 */
export interface CurrentVolumeContext {
  readonly volumes: readonly VolumeEntry[];
  readonly current: VolumeEntry | null;
  /** 当前卷在 volumes 中的序号（1 基）。无卷纲时为 0。 */
  readonly index: number;
  /** 目标章号是否落在当前卷区间内。无卷纲时为 null，表示不作判定。 */
  readonly inRange: boolean | null;
}

export function loadCurrentVolumeContext(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber?: number,
): CurrentVolumeContext {
  const outline = readOutlineFromLedger(storage, bookId);
  const volumes = outline?.volumes ?? [];
  if (volumes.length === 0) {
    return { volumes: [], current: null, index: 0, inRange: null };
  }
  const current = pickCurrentVolume(volumes, chapterNumber);
  if (!current) return { volumes, current: null, index: 0, inRange: null };
  const inRange = typeof chapterNumber === "number" && chapterNumber > 0
    ? chapterNumber >= current.chapterRange.from && chapterNumber <= current.chapterRange.to
    : null;
  return {
    volumes,
    current,
    index: volumes.findIndex((volume) => volume.id === current.id) + 1,
    inRange,
  };
}

/**
 * 渲染「本卷目标」这一层写作上下文。全书意图与近 1-3 章焦点之间原本是空的，
 * 卷目标缺位正是长篇章节与卷主线脱节的直接原因。
 */
export function renderCurrentVolumeFocus(
  context: CurrentVolumeContext,
  chapterNumber?: number,
): string {
  const volume = context.current;
  if (!volume) return "";
  const { from, to } = volume.chapterRange;
  const total = Math.max(0, to - from + 1);
  const lines = [
    `第 ${context.index} 卷《${volume.title}》（第 ${from}-${to} 章，共 ${total} 章，状态 ${volume.status}）`,
    volume.targetChapters ? `本卷目标章数：${volume.targetChapters}` : "",
    volume.targetWords ? `本卷目标字数：${volume.targetWords}` : "",
    volume.goal ? `本卷剧情目标：${volume.goal}` : "本卷剧情目标：未填写（卷纲缺目标，无法据此约束本章走向）",
    volume.mainlineBeats?.length
      ? `本卷主线节点：${volume.mainlineBeats.map((beat) => `${beat.status === "done" ? "✓" : beat.status === "active" ? "→" : "○"}${beat.title}`).join("；")}`
      : "本卷主线节点：未结构化填写（可在 outline.volume 中补充 mainlineBeats）",
  ].filter(Boolean);
  if (typeof chapterNumber === "number" && chapterNumber > 0 && total > 0) {
    const offset = chapterNumber - from + 1;
    if (offset >= 1 && offset <= total) {
      lines.push(`本章位置：本卷第 ${offset}/${total} 章，剩余 ${total - offset} 章收束本卷目标。`);
    }
  }
  if (context.inRange === false) {
    lines.push(`注意：第 ${chapterNumber} 章不在本卷区间内，卷纲与实际进度已脱节。`);
  }
  if (volume.notes) lines.push(`卷备注：${volume.notes}`);
  return lines.join("\n");
}

/**
 * 检查卷区间是否连续无重叠。volumes 已按 from 升序（normalizeVolumes 保证）。
 * 返回三段式说明；无问题返回 null。
 */
export function findVolumeRangeIssue(volumes: readonly VolumeEntry[]): string | null {
  for (let index = 1; index < volumes.length; index += 1) {
    const previous = volumes[index - 1];
    const current = volumes[index];
    if (!previous || !current) continue;
    if (current.chapterRange.from <= previous.chapterRange.to) {
      return [
        `发生了什么：《${previous.title}》（第 ${previous.chapterRange.from}-${previous.chapterRange.to} 章）与《${current.title}》（第 ${current.chapterRange.from}-${current.chapterRange.to} 章）的章号区间重叠。`,
        "为什么要看：重叠区间里的章会同时属于两卷，当前卷的推导结果取决于遍历顺序，写作时可能带着另一卷的目标走，卷末收束对不上。",
        `建议怎么做：把《${current.title}》的起始章改为 ${previous.chapterRange.to + 1}，或收窄《${previous.title}》的结束章。`,
      ].join("\n");
    }
    if (current.chapterRange.from > previous.chapterRange.to + 1) {
      const gapFrom = previous.chapterRange.to + 1;
      const gapTo = current.chapterRange.from - 1;
      return [
        `发生了什么：第 ${gapFrom}-${gapTo} 章不属于任何卷（《${previous.title}》与《${current.title}》之间有空洞）。`,
        "为什么要看：落在空洞里的章不受任何卷目标约束，写出来无法归属任何主线；写到那里时会被 volume-range-violation 直接拦下。",
        `建议怎么做：把《${previous.title}》的结束章延到 ${gapTo}，或把《${current.title}》的起始章提前到 ${gapFrom}，也可以在中间补一卷。`,
      ].join("\n");
    }
  }
  return null;
}

export function renderVolumeMarkdown(outline: VolumeOutline): string {
  const lines = ["# 卷纲", ""];
  for (const volume of outline.volumes) {
    const flag = volume.status === "active" ? "（当前）" : volume.status === "done" ? "（已完成）" : "";
    lines.push(`## ${volume.title}${flag}`);
    lines.push(`- 章节范围：第 ${volume.chapterRange.from}-${volume.chapterRange.to} 章`);
    if (volume.targetChapters) lines.push(`- 目标章数：${volume.targetChapters}`);
    if (volume.targetWords) lines.push(`- 目标字数：${volume.targetWords}`);
    if (volume.goal) lines.push(`- 本卷目标：${volume.goal}`);
    if (volume.mainlineBeats?.length) {
      lines.push("- 主线节点：");
      for (const beat of volume.mainlineBeats) {
        const status = beat.status === "done" ? "已完成" : beat.status === "active" ? "进行中" : "待推进";
        lines.push(`  - [${status}] ${beat.title}${beat.notes ? `：${beat.notes}` : ""}`);
      }
    }
    if (volume.notes) lines.push(`- 备注：${volume.notes}`);
    lines.push("");
  }
  lines.push(`<!-- updatedAt: ${outline.updatedAt} -->`);
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 从经纬账本读卷纲（权威源）。 */
function readOutlineFromLedger(
  storage: StorageDatabase,
  bookId: string,
): VolumeOutline | null {
  const entry = findLedgerEntryByTitle(storage, bookId, "outline", VOLUME_ENTRY_TITLE);
  if (!entry) return null;
  const volumes = normalizeVolumes(entry.fields.volumes as readonly unknown[] | undefined);
  if (volumes.length === 0) return null;
  return {
    bookId,
    volumes,
    updatedAt: new Date(entry.updatedAt || Date.now()).toISOString(),
    endgameReserve: parseEndgameReserve(entry.fields.endgameReserve),
  };
}

/**
 * 根据经纬 outline 的 chapterRange 解析章节所在的真实卷目录。
 * 没有卷纲时使用卷01；区间空洞与末尾越界使用下一个确定的卷序号，
 * 具体的越界写作拦截仍由写前硬门负责。
 */
export function resolveChapterVolumeDirectory(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
): string {
  const outline = readOutlineFromLedger(storage, bookId);
  if (!outline || outline.volumes.length === 0) return DEFAULT_VOLUME_DIRECTORY;

  const hit = outline.volumes.findIndex((volume) => (
    chapterNumber >= volume.chapterRange.from && chapterNumber <= volume.chapterRange.to
  ));
  if (hit >= 0) return volumeDirectoryName(hit + 1);

  const next = outline.volumes.findIndex((volume) => chapterNumber < volume.chapterRange.from);
  return volumeDirectoryName(next >= 0 ? next + 1 : outline.volumes.length + 1);
}

/**
 * 一次性迁移：把历史 story/volume_outline.json 读进经纬账本。
 * 迁移后 JSON 文件保留为备份，但不再作为读取来源。
 */
async function migrateLegacyVolumeJson(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
  now: () => Date,
): Promise<VolumeOutline | null> {
  try {
    const raw = await readFile(join(bookRoot, "story", VOLUME_JSON), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const volumes = normalizeVolumes(parsed.volumes as readonly unknown[] | undefined);
    if (volumes.length === 0) return null;
    const outline: VolumeOutline = {
      bookId,
      volumes,
      updatedAt: trimText(parsed.updatedAt) || now().toISOString(),
    };
    upsertLedgerEntry(storage, {
      bookId,
      category: "outline",
      title: VOLUME_ENTRY_TITLE,
      contentMd: renderVolumeMarkdown(outline),
      fields: { volumes, migratedFrom: `story/${VOLUME_JSON}` },
      status: "confirmed",
      now,
    });
    return outline;
  } catch {
    return null;
  }
}

/** 读卷纲：经纬优先；仅当经纬为空时尝试从历史 JSON 迁移一次。 */
async function readOutline(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
  now: () => Date,
): Promise<VolumeOutline | null> {
  return readOutlineFromLedger(storage, bookId)
    ?? await migrateLegacyVolumeJson(storage, bookId, bookRoot, now);
}

async function readLatestChapter(bookRoot: string): Promise<number | undefined> {
  try {
    const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const numbers = Array.isArray(parsed)
      ? parsed.map((entry) => Number((entry as { number?: unknown }).number)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    return numbers.length > 0 ? Math.max(...numbers) : undefined;
  } catch {
    return undefined;
  }
}

async function readTargetChapters(bookRoot: string): Promise<number> {
  try {
    const raw = await readFile(join(bookRoot, "book.json"), "utf8");
    const parsed = JSON.parse(raw) as { targetChapters?: unknown };
    return positiveInt(parsed.targetChapters, 200);
  } catch {
    return 200;
  }
}

/** 规则建议：把目标章数均分成 N 卷；有正文时把当前所在卷标 active。 */
export function buildRuleVolumeSuggestion(input: {
  readonly targetChapters: number;
  readonly volumeCount: number;
  readonly latestChapter?: number;
}): VolumeEntry[] {
  const volumeCount = Math.min(Math.max(1, input.volumeCount), 12);
  const target = Math.max(volumeCount, input.targetChapters);
  const perVolume = Math.ceil(target / volumeCount);
  const volumes: VolumeEntry[] = [];
  for (let index = 0; index < volumeCount; index += 1) {
    const from = index * perVolume + 1;
    const to = index === volumeCount - 1 ? target : Math.min(target, (index + 1) * perVolume);
    const inRange = typeof input.latestChapter === "number"
      && input.latestChapter >= from
      && input.latestChapter <= to;
    volumes.push({
      id: `vol-${index + 1}`,
      title: `第${index + 1}卷`,
      chapterRange: { from, to },
      goal: "",
      status: inRange ? "active" : (typeof input.latestChapter === "number" && input.latestChapter > to ? "done" : "planned"),
    });
  }
  return volumes;
}

function parseJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).match(/\[[\s\S]*\]/u)?.[0];
  if (!candidate) return [];
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function handleOutlineVolume(input: OutlineVolumeInput): Promise<OutlineVolumeResult> {
  const bookId = trimText(input.bookId);
  const action = parseAction(input.action);
  const base = { bookId, action, outline: null, currentVolume: null, writtenFiles: [] as string[] };

  if (!bookId) return { ...base, ok: false, summary: "缺少 bookId。", error: "missing-book-id" };
  if (!trimText(input.bookRoot)) {
    return { ...base, ok: false, summary: "缺少可信 bookRoot。", error: "missing-book-root" };
  }

  const bookRoot = input.bookRoot;
  const now = input.now ?? (() => new Date());
  const storage = input.storage ?? getStorageDatabase();
  const latestChapter = await readLatestChapter(bookRoot);
  const existing = await readOutline(storage, bookId, bookRoot, now);

  if (action === "get") {
    const currentVolume = existing ? pickCurrentVolume(existing.volumes, latestChapter) : null;
    const overdraft = checkOverdraft(
      existing?.endgameReserve ?? null,
      volumeIndexOf(existing?.volumes ?? [], currentVolume),
    );
    return {
      ok: true,
      bookId,
      action,
      outline: existing,
      currentVolume,
      writtenFiles: [],
      overdraft,
      summary: existing
        ? `共 ${existing.volumes.length} 卷；当前卷「${currentVolume?.title ?? "未确定"}」（权威源：经纬 outline）。${overdraft.summary}`
        : "尚未设置卷纲；可用 action=suggest 生成草案后 action=set 写入经纬。",
    };
  }

  if (action === "suggest") {
    const targetChapters = positiveInt(input.targetChapters, await readTargetChapters(bookRoot));
    const volumeCount = positiveInt(input.volumeCount, 3);
    let suggestion = buildRuleVolumeSuggestion({ targetChapters, volumeCount, latestChapter });

    if (input.generateText) {
      try {
        const generated = await input.generateText({
          messages: [
            {
              role: "system",
              content:
                "你按给定章数与卷数规划卷纲。只输出 JSON 数组，每项 {id,title,chapterRange:{from,to},goal,status}。goal 是本卷要达成的剧情结果，禁止写作理论。",
            },
            {
              role: "user",
              content: [
                `全书目标章数：${targetChapters}`,
                `期望卷数：${volumeCount}`,
                latestChapter ? `已写到第 ${latestChapter} 章` : "尚无正文",
                existing ? `已有卷纲：${JSON.stringify(existing.volumes)}` : "无既有卷纲",
                `规则草案（可修正）：${JSON.stringify(suggestion)}`,
              ].join("\n"),
            },
          ],
          temperature: 0.3,
          maxTokens: 1600,
        });
        const parsed = normalizeVolumes(parseJsonArray(generated.text));
        if (parsed.length > 0) suggestion = parsed;
      } catch {
        // 保留规则草案
      }
    }

    return {
      ok: true,
      bookId,
      action,
      outline: existing,
      currentVolume: existing ? pickCurrentVolume(existing.volumes, latestChapter) : null,
      suggestion,
      writtenFiles: [],
      summary: `已生成 ${suggestion.length} 卷草案（未落盘）；确认后用 action=set 提交 volumes。`,
    };
  }

  // action === "set"
  const volumes = normalizeVolumes(input.volumes);
  if (volumes.length === 0) {
    return { ...base, ok: false, summary: "action=set 需要至少 1 个有效 volume（含 title）。", error: "invalid-volumes" };
  }

  // 区间连续性是卷纲能当约束用的前提：重叠会让同一章同时属于两卷（当前卷推导
  // 结果取决于遍历顺序），空洞会让洞里的章不受任何卷目标约束，两者都会让
  // pipeline.write 的 volume-range-violation 拦在错误的位置上。
  const rangeIssue = findVolumeRangeIssue(volumes);
  if (rangeIssue) {
    return { ...base, ok: false, summary: rangeIssue, error: "volume-range-invalid" };
  }

  const updatedAt = now().toISOString();
  // 显式传入的储备优先；未传时保留已有的，避免每次 set 卷纲把储备账清掉。
  const endgameReserve = parseEndgameReserve(input.endgameReserve) ?? existing?.endgameReserve ?? null;
  const outline: VolumeOutline = { bookId, volumes, updatedAt, endgameReserve };

  // 权威写入：经纬 outline 账本条目。
  upsertLedgerEntry(storage, {
    bookId,
    category: "outline",
    title: VOLUME_ENTRY_TITLE,
    contentMd: renderVolumeMarkdown(outline),
    fields: { volumes, ...(endgameReserve ? { endgameReserve } : {}) },
    status: "confirmed",
    now,
  });

  // 导出物：作者可读 md（不再作为读取来源；不写 JSON）。
  const writtenFiles = ["jingwei:outline/卷纲"];
  try {
    const storyDir = join(bookRoot, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, VOLUME_MD), renderVolumeMarkdown(outline), "utf8");
    writtenFiles.push(`story/${VOLUME_MD}（导出）`);
  } catch {
    // 导出失败不影响权威写入
  }

  const currentVolume = pickCurrentVolume(volumes, latestChapter);
  const overdraft = checkOverdraft(endgameReserve, volumeIndexOf(volumes, currentVolume));
  return {
    ok: true,
    bookId,
    action,
    outline,
    currentVolume,
    writtenFiles,
    overdraft,
    summary: `已保存 ${volumes.length} 卷卷纲到经纬 outline；当前卷「${currentVolume?.title ?? "未确定"}」。${overdraft.summary}`,
  };
}

/** 当前卷在卷序列中的序号（1 起）；找不到时按第 1 卷处理。 */
function volumeIndexOf(
  volumes: readonly VolumeEntry[],
  current: VolumeEntry | null,
): number {
  if (!current) return 1;
  const index = volumes.findIndex((item) => item.id === current.id);
  return index >= 0 ? index + 1 : 1;
}
