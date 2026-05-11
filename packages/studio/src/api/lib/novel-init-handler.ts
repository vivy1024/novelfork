/**
 * /novel:init Handler — create book directory structure on the filesystem.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface NovelInitInput {
  readonly bookName: string;
  readonly workDir: string;
  readonly genre?: string;
}

export interface NovelInitResult {
  readonly ok: boolean;
  readonly bookPath?: string;
  readonly error?: string;
}

const DEFAULT_CONFIG = (name: string, genre?: string) => JSON.stringify({
  name,
  version: "1.0.0",
  genre: genre ?? "玄幻",
  chapters: { planned: 10, format: "markdown" },
  createdAt: new Date().toISOString(),
}, null, 2);

const DEFAULT_BIBLE = (name: string) => `# ${name} 故事圣经

## 前提
（待填写）

## 世界观
（待填写）

## 主要角色
（待填写）

## 核心矛盾
（待填写）
`;

const DEFAULT_JINGWEI = JSON.stringify({ sections: [], entries: [], version: 1 }, null, 2);

export async function executeNovelInit(input: NovelInitInput): Promise<NovelInitResult> {
  const { bookName, workDir, genre } = input;
  const bookPath = join(workDir, bookName);

  try {
    await mkdir(join(bookPath, "chapters"), { recursive: true });
    await mkdir(join(bookPath, "candidates"), { recursive: true });

    // Create jingwei directory with category subdirectories
    const jingweiDir = join(bookPath, "jingwei");
    await mkdir(jingweiDir, { recursive: true });
    await mkdir(join(jingweiDir, "角色"), { recursive: true });
    await mkdir(join(jingweiDir, "势力"), { recursive: true });
    await mkdir(join(jingweiDir, "设定"), { recursive: true });
    await mkdir(join(jingweiDir, "伏笔"), { recursive: true });
    await mkdir(join(jingweiDir, "大纲"), { recursive: true });
    await mkdir(join(jingweiDir, "状态"), { recursive: true });
    await mkdir(join(jingweiDir, "规则"), { recursive: true });

    await writeFile(join(bookPath, "novelfork.json"), DEFAULT_CONFIG(bookName, genre), "utf-8");
    await writeFile(join(jingweiDir, "设定", "story_bible.md"), DEFAULT_BIBLE(bookName), "utf-8");
    await writeFile(join(jingweiDir, "jingwei.json"), DEFAULT_JINGWEI, "utf-8");

    return { ok: true, bookPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
