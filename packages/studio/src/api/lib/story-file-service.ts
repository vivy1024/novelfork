import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const TRUTH_FILES = [
  "story_bible.md", "volume_outline.md", "current_state.md",
  "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
  "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
  "style_guide.md", "setting_guide.md", "parent_canon.md", "fanfic_canon.md", "book_rules.md",
  "author_intent.md", "current_focus.md", "market_radar.md", "web_materials.md",
] as const;

export const TRUTH_FILE_LABELS: Record<string, string> = {
  "story_bible.md": "故事经纬",
  "volume_outline.md": "卷大纲",
  "current_state.md": "当前状态",
  "particle_ledger.md": "资源账本",
  "pending_hooks.md": "待处理伏笔",
  "chapter_summaries.md": "章节摘要",
  "subplot_board.md": "支线看板",
  "emotional_arcs.md": "情绪弧线",
  "character_matrix.md": "角色矩阵",
  "style_guide.md": "风格指南",
  "setting_guide.md": "设定指南",
  "parent_canon.md": "原著设定（同人）",
  "fanfic_canon.md": "二设记录（同人）",
  "book_rules.md": "书籍规则",
  "author_intent.md": "创作意图",
  "current_focus.md": "当前焦点",
  "market_radar.md": "市场雷达",
  "web_materials.md": "网络素材",
};

export interface StoryFileSummary {
  readonly name: string;
  readonly label: string;
  readonly size: number;
  readonly preview: string;
}

export interface StoryFileReadServiceOptions {
  readonly resolveBookDir: (bookId: string) => string;
}

export function isSafeStoryFileName(file: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(file) && /\.(md|json|txt)$/i.test(file);
}

export function isTruthFileName(file: string): boolean {
  return (TRUTH_FILES as readonly string[]).includes(file);
}

async function listFiles(storyDir: string, filter?: (file: string) => boolean): Promise<ReadonlyArray<StoryFileSummary>> {
  try {
    const files = await readdir(storyDir);
    const allowedFiles = files.filter((file) => isSafeStoryFileName(file) && (!filter || filter(file)));
    return await Promise.all(
      allowedFiles.map(async (file) => {
        const content = await readFile(join(storyDir, file), "utf-8");
        return { name: file, label: TRUTH_FILE_LABELS[file] ?? file.replace(/\.md$/, ""), size: content.length, preview: content.slice(0, 200) };
      }),
    );
  } catch {
    return [];
  }
}

async function readStoryFileContent(storyDir: string, file: string): Promise<{ readonly file: string; readonly content: string | null }> {
  try {
    const content = await readFile(join(storyDir, file), "utf-8");
    return { file, content };
  } catch {
    return { file, content: null };
  }
}

export function createStoryFileReadService(options: StoryFileReadServiceOptions) {
  const storyDir = (bookId: string) => join(options.resolveBookDir(bookId), "story");

  return {
    async listTruthFiles(bookId: string): Promise<{ readonly files: ReadonlyArray<StoryFileSummary> }> {
      return { files: await listFiles(storyDir(bookId), isTruthFileName) };
    },

    async listStoryFiles(bookId: string): Promise<{ readonly files: ReadonlyArray<StoryFileSummary> }> {
      return { files: await listFiles(storyDir(bookId)) };
    },

    async readTruthFile(bookId: string, file: string): Promise<{ readonly file: string; readonly content: string | null } | { readonly error: "Invalid truth file" }> {
      if (!isTruthFileName(file)) {
        return { error: "Invalid truth file" };
      }
      return readStoryFileContent(storyDir(bookId), file);
    },

    async readStoryFile(bookId: string, file: string): Promise<{ readonly file: string; readonly content: string | null } | { readonly error: "Invalid story file" }> {
      if (!isSafeStoryFileName(file)) {
        return { error: "Invalid story file" };
      }
      return readStoryFileContent(storyDir(bookId), file);
    },
  };
}
