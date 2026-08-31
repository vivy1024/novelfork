import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  formatAuthorProfileForInjection,
  parseAuthorProfile,
  parseBookRules,
  type AuthorProfile,
  type BookConfig,
  type ParsedBookRules,
} from "@vivy1024/novelfork-core";

/** 相对 NovelFork 作者目录（生产为 `~/.novelfork`，隔离实例为 `NOVELFORK_PROJECT_ROOT`）。 */
export const AUTHOR_PROFILE_RELATIVE_PATH = "author-profile.json";
export const BOOK_RULES_RELATIVE_PATH = join("story", "book_rules.md");
export const BOOK_DESIGN_RELATIVE_PATHS = {
  authorIntent: join("story", "author_intent.md"),
  currentFocus: join("story", "current_focus.md"),
  volumeOutline: join("story", "volume_outline.md"),
  styleProfile: join("story", "style_profile.json"),
} as const;

export type WritingLayerKind = "author" | "book-design" | "book-rules";

export interface BookDesignDocuments {
  readonly authorIntent: string;
  readonly currentFocus: string;
  readonly volumeOutline: string;
  readonly styleProfileRaw: string;
}

export interface ResolvedWritingLayers {
  readonly authorProfile: AuthorProfile;
  readonly authorProfileEnabled: boolean;
  readonly authorHabitsText: string;
  readonly bookDesign: BookDesignDocuments;
  readonly bookDesignText: string;
  readonly bookRules: ParsedBookRules | null;
  readonly bookRulesRaw: string;
  readonly bookRulesText: string;
  readonly styleGuideText: string;
}

/**
 * 作者目录：显式传入 > 产品/隔离实例的 `NOVELFORK_PROJECT_ROOT` > `~/.novelfork`。
 * 禁止在隔离 Runtime 里回落到 os.homedir()，否则会写进真实用户目录。
 */
export function resolveAuthorHome(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const projectRoot = process.env.NOVELFORK_PROJECT_ROOT?.trim();
  if (projectRoot) return projectRoot;
  return join(homedir(), ".novelfork");
}

function authorProfilePath(home?: string): string {
  return join(resolveAuthorHome(home), AUTHOR_PROFILE_RELATIVE_PATH);
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

export function isAuthorProfileEnabled(book: Pick<BookConfig, "authorProfileEnabled"> | Record<string, unknown> | null | undefined): boolean {
  return book?.authorProfileEnabled === true;
}

export async function loadAuthorProfile(home?: string): Promise<AuthorProfile> {
  const raw = await tryReadFile(authorProfilePath(home));
  return parseAuthorProfile(raw || {});
}

export async function saveAuthorProfile(profile: AuthorProfile, home?: string): Promise<AuthorProfile> {
  const next: AuthorProfile = {
    ...parseAuthorProfile(profile),
    updatedAt: new Date().toISOString(),
  };
  const path = authorProfilePath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
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
  const [authorIntent, currentFocus, volumeOutline, styleProfileRaw] = await Promise.all([
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.authorIntent)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.currentFocus)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.volumeOutline)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.styleProfile)),
  ]);
  return { authorIntent, currentFocus, volumeOutline, styleProfileRaw };
}

export async function saveBookDesign(
  bookRoot: string,
  patch: Partial<Pick<BookDesignDocuments, "authorIntent" | "currentFocus" | "volumeOutline">>,
): Promise<BookDesignDocuments> {
  const current = await loadBookDesign(bookRoot);
  const next: BookDesignDocuments = {
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

export function formatStyleGuideForInjection(design: BookDesignDocuments): string {
  const fingerprint = nonEmpty(design.styleProfileRaw);
  return fingerprint;
}

/**
 * 组装写前三层。作者习惯只在本书显式开启时进入；书籍设计与书籍规则始终按本书目录读取。
 */
export async function resolveWritingLayers(input: {
  readonly bookRoot: string;
  readonly book?: Pick<BookConfig, "authorProfileEnabled"> | Record<string, unknown> | null;
  readonly home?: string;
}): Promise<ResolvedWritingLayers> {
  const authorProfileEnabled = isAuthorProfileEnabled(input.book);
  const [authorProfile, bookDesign, bookRulesRaw] = await Promise.all([
    loadAuthorProfile(input.home),
    loadBookDesign(input.bookRoot),
    loadBookRulesRaw(input.bookRoot),
  ]);
  const bookRules = bookRulesRaw.trim() ? parseBookRules(bookRulesRaw) : null;
  const authorHabitsText = authorProfileEnabled ? formatAuthorProfileForInjection(authorProfile) : "";
  return {
    authorProfile,
    authorProfileEnabled,
    authorHabitsText,
    bookDesign,
    bookDesignText: formatBookDesignForInjection(bookDesign),
    bookRules,
    bookRulesRaw,
    bookRulesText: formatBookRulesForInjection(bookRules),
    styleGuideText: formatStyleGuideForInjection(bookDesign),
  };
}
