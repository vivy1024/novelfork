/**
 * 起点小说下载器 — 从移动端页面抓取章节正文，拼接为 TXT
 *
 * 用法: bun run scripts/qidian-download.ts <bookId> [outputPath]
 * 示例: bun run scripts/qidian-download.ts 1048811859 ./output/黑袍.txt
 */

const CATALOG_URL = (bookId: string) => `https://m.qidian.com/book/${bookId}/catalog/`;
const CHAPTER_URL = (bookId: string, chapterId: string) => `https://m.qidian.com/chapter/${bookId}/${chapterId}/`;

const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DELAY_MS = 1500; // 请求间隔，避免被封

interface ChapterInfo {
  id: string;
  title: string;
  isFree: boolean;
  wordCount: number;
  url: string;
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCatalog(bookId: string): Promise<ChapterInfo[]> {
  console.log(`[1/3] 抓取目录: ${CATALOG_URL(bookId)}`);
  const html = await fetchPage(CATALOG_URL(bookId));

  const chapters: ChapterInfo[] = [];
  // 匹配章节链接: href="//m.qidian.com/chapter/bookId/chapterId/"
  const chapterRegex = /href="\/\/m\.qidian\.com\/chapter\/\d+\/(\d+)\/"[^>]*title="[^"]*?([^"]+?)在线阅读"[^>]*alt="[^"]*?章节字数:\s*(\d+)"/g;
  let match;
  while ((match = chapterRegex.exec(html)) !== null) {
    const id = match[1]!;
    const title = match[2]!.trim();
    const wordCount = parseInt(match[3]!, 10);
    const isFree = html.includes(`href="//m.qidian.com/chapter/${bookId}/${id}/"`) &&
      html.substring(html.indexOf(`/chapter/${bookId}/${id}/`), html.indexOf(`/chapter/${bookId}/${id}/`) + 500).includes("免费");
    chapters.push({
      id,
      title,
      isFree,
      wordCount,
      url: CHAPTER_URL(bookId, id),
    });
  }

  // Fallback: 简单正则
  if (chapters.length === 0) {
    const simpleRegex = /\/chapter\/\d+\/(\d+)\//g;
    const titleRegex = /<h2>([^<]+)<\/h2>/g;
    const ids: string[] = [];
    let m;
    while ((m = simpleRegex.exec(html)) !== null) {
      if (!ids.includes(m[1]!)) ids.push(m[1]!);
    }
    const titles: string[] = [];
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push(m[1]!);
    }
    for (let i = 0; i < ids.length; i++) {
      chapters.push({
        id: ids[i]!,
        title: titles[i] ?? `第${i + 1}章`,
        isFree: true, // 假设免费
        wordCount: 0,
        url: CHAPTER_URL(bookId, ids[i]!),
      });
    }
  }

  console.log(`  找到 ${chapters.length} 章`);
  return chapters;
}

async function fetchChapterContent(url: string): Promise<string> {
  const html = await fetchPage(url);

  // 提取正文：起点移动端正文在 <p> 标签中
  // 方法1: 匹配 class 包含 "content" 的区域内的 <p> 标签
  const contentMatch = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    const paragraphs = contentMatch[1]!.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    if (paragraphs) {
      return paragraphs
        .map((p) => p.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean)
        .join("\n\n");
    }
  }

  // 方法2: 直接找所有 <p> 中的中文段落
  const allP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (allP) {
    const textParagraphs = allP
      .map((p) => p.replace(/<[^>]+>/g, "").trim())
      .filter((text) => text.length > 20 && /[\u4e00-\u9fff]/.test(text));
    if (textParagraphs.length > 3) {
      return textParagraphs.join("\n\n");
    }
  }

  // 方法3: 找 JSON 数据中的 content 字段
  const jsonMatch = html.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (jsonMatch) {
    try {
      const decoded = JSON.parse(`"${jsonMatch[1]}"`);
      return decoded.replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    } catch { /* ignore */ }
  }

  return "";
}

async function downloadBook(bookId: string, outputPath: string) {
  const chapters = await fetchCatalog(bookId);
  if (chapters.length === 0) {
    console.error("未找到任何章节！");
    process.exit(1);
  }

  const freeChapters = chapters.filter((ch) => ch.isFree);
  console.log(`[2/3] 开始下载 ${freeChapters.length} 个免费章节（共 ${chapters.length} 章）\n`);

  const contents: string[] = [];
  let totalWords = 0;

  for (let i = 0; i < freeChapters.length; i++) {
    const ch = freeChapters[i]!;
    process.stdout.write(`  [${i + 1}/${freeChapters.length}] ${ch.title}...`);

    try {
      const text = await fetchChapterContent(ch.url);
      if (text.length > 50) {
        contents.push(`# ${ch.title}\n\n${text}`);
        totalWords += text.length;
        console.log(` ✓ (${text.length}字)`);
      } else {
        contents.push(`# ${ch.title}\n\n[正文获取失败或为VIP章节]`);
        console.log(` ✗ (内容为空，可能是VIP)`);
      }
    } catch (err) {
      contents.push(`# ${ch.title}\n\n[下载失败: ${err}]`);
      console.log(` ✗ (${err})`);
    }

    if (i < freeChapters.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // 写入文件
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, contents.join("\n\n---\n\n"), "utf-8");

  console.log(`\n[3/3] 完成！`);
  console.log(`  输出: ${outputPath}`);
  console.log(`  章节: ${freeChapters.length}/${chapters.length}`);
  console.log(`  总字数: ~${totalWords}`);
}

// --- Main ---
const args = process.argv.slice(2);
const bookId = args[0] ?? "1048811859";
const outputPath = args[1] ?? `./output/qidian-${bookId}.txt`;

downloadBook(bookId, outputPath).catch((err) => {
  console.error("下载失败:", err);
  process.exit(1);
});
