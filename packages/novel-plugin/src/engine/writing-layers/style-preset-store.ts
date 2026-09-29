import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  composeStyleGuide, createStylePreset, StyleFingerprintSchema, StylePresetSchema,
  type StyleFingerprint, type StylePreset,
} from "./style-preset.js";

export const STYLE_PRESET_RELATIVE_PATH = join("story", "style_preset.json");
export const LEGACY_STYLE_PROFILE_RELATIVE_PATH = join("story", "style_profile.json");

export class StylePresetError extends Error {
  constructor(message: string, readonly code: "STYLE_PRESET_CORRUPTED" | "STYLE_PRESET_CONFLICT" | "STYLE_PRESET_INVALID") {
    super(message);
    this.name = "StylePresetError";
  }
}

export interface LoadedStylePreset {
  readonly preset: StylePreset | null;
  readonly revision: string | null;
  readonly source: "preset" | "legacy" | "none";
  readonly guideText: string;
}

function revision(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadStylePreset(bookRoot: string): Promise<LoadedStylePreset> {
  const raw = await readOptional(join(bookRoot, STYLE_PRESET_RELATIVE_PATH));
  if (raw !== null) {
    try {
      const preset = StylePresetSchema.parse(JSON.parse(raw));
      return { preset, revision: revision(raw), source: "preset", guideText: composeStyleGuide(preset) };
    } catch {
      throw new StylePresetError("本书文风预设损坏，已保留原文件；请恢复有效版本后重试。", "STYLE_PRESET_CORRUPTED");
    }
  }
  const legacy = await readOptional(join(bookRoot, LEGACY_STYLE_PROFILE_RELATIVE_PATH));
  if (legacy === null) return { preset: null, revision: null, source: "none", guideText: "" };
  try {
    const fingerprint = StyleFingerprintSchema.parse(JSON.parse(legacy));
    return { preset: createStylePreset(fingerprint), revision: revision(legacy), source: "legacy", guideText: "" };
  } catch {
    throw new StylePresetError("旧文风指纹无法读取，已保留原文件；请检查或恢复后重试。", "STYLE_PRESET_CORRUPTED");
  }
}

// 同一服务进程内串行读改写，避免预设编辑与统计蒸馏互相覆盖。
const writes = new Map<string, Promise<void>>();
async function withStyleWrite<T>(bookRoot: string, operation: () => Promise<T>): Promise<T> {
  const absolute = resolve(bookRoot);
  // Windows 的目录大小写别名指向同一份预设，必须共用读改写队列。
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const previous = writes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const tail = previous.then(() => gate);
  writes.set(key, tail);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (writes.get(key) === tail) writes.delete(key);
  }
}

async function writePreset(bookRoot: string, preset: StylePreset): Promise<LoadedStylePreset> {
  const dir = join(bookRoot, "story");
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.style-preset-${randomUUID()}.tmp`);
  const raw = `${JSON.stringify(preset, null, 2)}\n`;
  try {
    await writeFile(temporary, raw, "utf8");
    await rename(temporary, join(bookRoot, STYLE_PRESET_RELATIVE_PATH));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { preset, revision: revision(raw), source: "preset", guideText: composeStyleGuide(preset) };
}

export async function saveStylePreset(bookRoot: string, value: unknown, expectedRevision: string | null): Promise<LoadedStylePreset> {
  const parsed = StylePresetSchema.safeParse(value);
  if (!parsed.success) throw new StylePresetError("文风预设格式无效，请检查字段、来源证据与审核状态。", "STYLE_PRESET_INVALID");
  return withStyleWrite(bookRoot, async () => {
    const current = await loadStylePreset(bookRoot);
    if (expectedRevision !== current.revision) {
      throw new StylePresetError("文风预设已被更新；请重新载入，再合并你的修改。", "STYLE_PRESET_CONFLICT");
    }
    return writePreset(bookRoot, parsed.data);
  });
}

/** 作者主动提取统计时只更新指纹，已确认的写法、来源与范文不丢。 */
export async function updateStyleFingerprint(bookRoot: string, value: unknown): Promise<LoadedStylePreset> {
  const fingerprint = StyleFingerprintSchema.parse(value);
  return withStyleWrite(bookRoot, async () => {
    const current = await loadStylePreset(bookRoot);
    return writePreset(bookRoot, { ...(current.preset ?? createStylePreset()), fingerprint });
  });
}

export async function readStyleFingerprint(bookRoot: string): Promise<StyleFingerprint | null> {
  return (await loadStylePreset(bookRoot)).preset?.fingerprint ?? null;
}
