import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * 章节文件路径守卫（S1.1）。
 *
 * `chapters/index.json` 的 `fileName` 不可信：它可能来自档案导入、外部目录复制、
 * 绑定外部工作区，或被提示注入的叙述者改写。凡是把它拼进路径去读、写、删的地方，
 * 都必须先经过这里。
 *
 * 两道检查：
 * 1. 字符串层：拒绝空值、绝对路径、盘符、`:`（含备用数据流）、任何 `.` / `..` 段、
 *    Windows 保留设备名（CON、NUL、COM1 等，带不带扩展名都拒），以及段末尾的点或空格。
 *    Windows 会静默去掉末尾的点和空格，所以 `卷01./x.md` 与 `卷01/x.md` 会落到同一个文件。
 * 2. 真实落点层：对已存在的最近祖先目录做 realpath，确认仍在章节目录的真实路径之下。
 *    这一层挡住目录联接（junction）与符号链接：它们在字符串上合法，真身却在书外。
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/iu;

export function resolveChapterFile(chaptersDir: string, fileName: string): string | null {
  // 不做 trim：首尾空白会造成“看似同一文件、实际不同”的歧义，直接拒绝。
  if (typeof fileName !== "string" || fileName.length === 0) return null;
  if (fileName !== fileName.trim()) return null;
  const trimmed = fileName;
  if (isAbsolute(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;
  if (/^[A-Za-z]:/u.test(trimmed)) return null;
  if (trimmed.includes(":")) return null;

  const segments = trimmed.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  if (segments.some((segment) => WINDOWS_RESERVED_NAME.test(segment))) return null;
  if (segments.some((segment) => /[. ]$/u.test(segment))) return null;

  const root = resolve(chaptersDir);
  const candidate = resolve(root, normalize(segments.join(sep)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  if (!realpathStaysInside(root, candidate)) return null;
  return join(root, ...segments);
}

/**
 * 对候选路径向上找到第一个已存在的祖先，取其 realpath，判断它是否仍在章节目录的
 * realpath 之下。文件本身可以不存在（新建章节），所以只校验祖先。
 */
function realpathStaysInside(root: string, candidate: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // 章节目录本身不存在：字符串检查已足够，之后的写入会先创建它。
    return true;
  }
  let probe = candidate;
  for (;;) {
    try {
      const real = realpathSync(probe);
      return real === realRoot || real.startsWith(realRoot + sep);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/** 解析失败时抛错，供写入路径使用：绝不静默落到章节目录之外。 */
export function requireChapterFile(chaptersDir: string, fileName: string): string {
  const resolved = resolveChapterFile(chaptersDir, fileName);
  if (!resolved) throw new Error(`章节文件路径不在章节目录内：${JSON.stringify(fileName)}`);
  return resolved;
}
