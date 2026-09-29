import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadStylePreset } from "./style-preset-store.js";
import type { StylePreset } from "./style-preset.js";

import {
  parseBookRules,
  type ParsedBookRules,
} from "@vivy1024/novelfork-core";

export const BOOK_RULES_RELATIVE_PATH = join("story", "book_rules.md");
export const BOOK_DESIGN_RELATIVE_PATHS = {
  authorIntent: join("story", "author_intent.md"),
  currentFocus: join("story", "current_focus.md"),
  volumeOutline: join("story", "volume_outline.md"),
} as const;

export type WritingLayerKind = "book-design" | "book-rules";

export interface BookDesignDocuments {
  readonly authorIntent: string;
  readonly currentFocus: string;
  readonly volumeOutline: string;
  readonly styleProfileRaw: string;
  readonly styleGuideText?: string;
  readonly stylePresetSource?: "preset" | "legacy" | "none";
}

export interface ResolvedWritingLayers {
  readonly bookDesign: BookDesignDocuments;
  readonly bookDesignText: string;
  readonly bookRules: ParsedBookRules | null;
  readonly bookRulesRaw: string;
  readonly bookRulesText: string;
  readonly styleGuideText: string;
  /** 新预设（source=preset）才有；范文检索只读它。不进书籍设计接口的返回体。 */
  readonly stylePreset: StylePreset | null;
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function nonEmpty(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

export async function loadBookRulesRaw(bookRoot: string): Promise<string> {
  return tryReadFile(join(bookRoot, BOOK_RULES_RELATIVE_PATH));
}

export async function loadBookRules(bookRoot: string): Promise<ParsedBookRules | null> {
  const raw = await loadBookRulesRaw(bookRoot);
  if (!raw.trim()) return null;
  return parseBookRules(raw);
}

export async function saveBookRules(bookRoot: string, content: string): Promise<void> {
  const path = join(bookRoot, BOOK_RULES_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function loadBookDesign(bookRoot: string): Promise<BookDesignDocuments> {
  return (await loadBookDesignWithPreset(bookRoot)).design;
}

async function loadBookDesignWithPreset(bookRoot: string): Promise<{ design: BookDesignDocuments; preset: StylePreset | null }> {
  const [authorIntent, currentFocus, volumeOutline, style] = await Promise.all([
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.authorIntent)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.currentFocus)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.volumeOutline)),
    loadStylePreset(bookRoot),
  ]);
  const design: BookDesignDocuments = { authorIntent, currentFocus, volumeOutline,
    styleProfileRaw: style.preset?.fingerprint ? JSON.stringify(style.preset.fingerprint) : "",
    styleGuideText: style.guideText, stylePresetSource: style.source,
  };
  return { design, preset: style.source === "preset" ? style.preset : null };
}

export async function saveBookDesign(
  bookRoot: string,
  patch: Partial<Pick<BookDesignDocuments, "authorIntent" | "currentFocus" | "volumeOutline">>,
): Promise<BookDesignDocuments> {
  const current = await loadBookDesign(bookRoot);
  const next: BookDesignDocuments = {
    ...current,
    authorIntent: patch.authorIntent ?? current.authorIntent,
    currentFocus: patch.currentFocus ?? current.currentFocus,
    volumeOutline: patch.volumeOutline ?? current.volumeOutline,
    styleProfileRaw: current.styleProfileRaw,
  };
  await mkdir(join(bookRoot, "story"), { recursive: true });
  if (patch.authorIntent !== undefined) {
    await writeFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.authorIntent), next.authorIntent.endsWith("\n") ? next.authorIntent : `${next.authorIntent}\n`, "utf8");
  }
  if (patch.currentFocus !== undefined) {
    await writeFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.currentFocus), next.currentFocus.endsWith("\n") ? next.currentFocus : `${next.currentFocus}\n`, "utf8");
  }
  if (patch.volumeOutline !== undefined) {
    await writeFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.volumeOutline), next.volumeOutline.endsWith("\n") ? next.volumeOutline : `${next.volumeOutline}\n`, "utf8");
  }
  return next;
}

export function formatBookDesignForInjection(design: BookDesignDocuments): string {
  const sections: string[] = [];
  const intent = nonEmpty(design.authorIntent);
  const focus = nonEmpty(design.currentFocus);
  const outline = nonEmpty(design.volumeOutline);
  if (intent) sections.push(`### 作者意图\n${intent}`);
  if (focus) sections.push(`### 当前聚焦\n${focus}`);
  if (outline) sections.push(`### 分卷大纲\n${outline}`);
  return sections.join("\n\n").trim();
}

export function formatBookRulesForInjection(parsed: ParsedBookRules | null): string {
  if (!parsed) return "";
  const parts: string[] = [];
  const protagonist = parsed.rules.protagonist;
  if (protagonist?.name) parts.push(`主角：${protagonist.name}`);
  if (protagonist?.personalityLock?.length) parts.push(`性格锁定：${protagonist.personalityLock.join("、")}`);
  if (protagonist?.behavioralConstraints?.length) parts.push(`行为约束：${protagonist.behavioralConstraints.join("、")}`);
  if (parsed.rules.prohibitions.length > 0) {
    parts.push("禁忌：");
    for (const item of parsed.rules.prohibitions) parts.push(`- ${item}`);
  }
  if (parsed.rules.genreLock?.forbidden?.length) {
    parts.push(`风格禁区：${parsed.rules.genreLock.forbidden.join("、")}`);
  }
  const body = nonEmpty(parsed.body);
  if (body) parts.push(body);
  return parts.join("\n").trim();
}

/** 只注入作者确认的写法指南；统计指纹（含旧 style_profile.json）只作写后对照，不再当写作指令。 */
export function formatStyleGuideForInjection(design: BookDesignDocuments): string {
  if (design.stylePresetSource === "preset") return nonEmpty(design.styleGuideText);
  return "";
}

/** 组装本书设计与规则。文风只走书内导入/拆书，不再注入跨书作者习惯。 */
export async function resolveWritingLayers(input: {
  readonly bookRoot: string;
}): Promise<ResolvedWritingLayers> {
  const [{ design: bookDesign, preset: stylePreset }, bookRulesRaw] = await Promise.all([
    loadBookDesignWithPreset(input.bookRoot),
    loadBookRulesRaw(input.bookRoot),
  ]);
  const bookRules = bookRulesRaw.trim() ? parseBookRules(bookRulesRaw) : null;
  return {
    bookDesign,
    bookDesignText: formatBookDesignForInjection(bookDesign),
    bookRules,
    bookRulesRaw,
    bookRulesText: formatBookRulesForInjection(bookRules),
    styleGuideText: formatStyleGuideForInjection(bookDesign),
    stylePreset,
  };
}
