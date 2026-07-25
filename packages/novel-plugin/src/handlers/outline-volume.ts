/**
 * outline.volume — 卷级大纲（volume outline）读写与建议。
 *
 * 结构化真相存 story/volume_outline.json；同时维护 volume_outline.md 作者可读副本。
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

export type VolumeStatus = "planned" | "active" | "done";

/** 卷纲在经纬中的条目标题（唯一权威承载）。 */
const VOLUME_ENTRY_TITLE = "卷纲";

export interface VolumeEntry {
  readonly id: string;
  readonly title: string;
  readonly chapterRange: { readonly from: number; readonly to: number };
  readonly goal: string;
  readonly status: VolumeStatus;
  readonly notes?: string;
}

export interface VolumeOutline {
  readonly bookId: string;
  readonly volumes: readonly VolumeEntry[];
  readonly updatedAt: string;
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
    out.push({
      id: trimText(record.id) || `vol-${index + 1}`,
      title,
      chapterRange: { from, to: Math.max(from, toRaw) },
      goal: trimText(record.goal),
      status: parseStatus(record.status),
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

export function renderVolumeMarkdown(outline: VolumeOutline): string {
  const lines = ["# 卷纲", ""];
  for (const volume of outline.volumes) {
    const flag = volume.status === "active" ? "（当前）" : volume.status === "done" ? "（已完成）" : "";
    lines.push(`## ${volume.title}${flag}`);
    lines.push(`- 章节范围：第 ${volume.chapterRange.from}-${volume.chapterRange.to} 章`);
    if (volume.goal) lines.push(`- 本卷目标：${volume.goal}`);
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
  };
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
    return {
      ok: true,
      bookId,
      action,
      outline: existing,
      currentVolume,
      writtenFiles: [],
      summary: existing
        ? `共 ${existing.volumes.length} 卷；当前卷「${currentVolume?.title ?? "未确定"}」（权威源：经纬 outline）。`
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

  const updatedAt = now().toISOString();
  const outline: VolumeOutline = { bookId, volumes, updatedAt };

  // 权威写入：经纬 outline 账本条目。
  upsertLedgerEntry(storage, {
    bookId,
    category: "outline",
    title: VOLUME_ENTRY_TITLE,
    contentMd: renderVolumeMarkdown(outline),
    fields: { volumes },
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
  return {
    ok: true,
    bookId,
    action,
    outline,
    currentVolume,
    writtenFiles,
    summary: `已保存 ${volumes.length} 卷卷纲到经纬 outline；当前卷「${currentVolume?.title ?? "未确定"}」。`,
  };
}
