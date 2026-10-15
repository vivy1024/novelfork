// 命名空间导入而非具名导入：Studio 会经 core 根入口把本模块打进浏览器包，
// node:fs 在那里被 alias 到 browser-node-stubs.ts（只导出少数几个具名函数）。
// 具名导入 realpathSync/lstatSync 会在浏览器端模块链接期直接失败；命名空间导入只在
// 真正调用时才取属性，而这些函数只会在服务端被调用。顶层也不得调用任何 node 内置。
import * as fs from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * 章节文件路径守卫（S1.1；T-01 起下沉到 core，是全仓唯一实现）。
 *
 * `chapters/index.json` 的 `fileName` 不可信：它可能来自档案导入、外部目录复制、
 * 绑定外部工作区，或被提示注入的叙述者改写。凡是把它拼进路径去读、写、删的地方，
 * 都必须先经过这里（novel-plugin 的 chapter-path-guard.ts 与 core 的 state-bootstrap 都调用本模块）。
 *
 * 两道检查：
 * 1. 字符串层：拒绝空值、首尾空白、绝对路径、盘符、`:`（含备用数据流）、任何 `.` / `..` / 空段、
 *    Windows 保留设备名（CON、NUL、COM1、CONIN$、COM¹ 等，带不带扩展名都拒），以及段末尾的点或空格。
 *    Windows 会静默去掉末尾的点和空格，所以 `卷01./x.md` 与 `卷01/x.md` 会落到同一个文件。
 * 2. 真实落点层：对已存在的最近祖先做 realpath，确认仍在章节目录的真实路径之下。
 *    这一层挡住目录联接（junction）与符号链接：它们在字符串上合法，真身却在书外。
 *    悬空链接（链接本身存在、目标不存在）一律拒绝，不再上溯到父目录放行——
 *    写入会沿着链接在书外把目标建出来。
 */

// COM¹²³ / LPT¹²³（上标数字）在 Windows 上同样是设备名；`CON .md` 这类名字后带空格的形式也会被当成设备。
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/iu;

/** 字符串层检查，通过时返回按 `/` 切好的路径段。 */
function safeSegments(fileName: unknown): string[] | null {
  // 不做 trim：首尾空白会造成“看似同一文件、实际不同”的歧义，直接拒绝。
  if (typeof fileName !== "string" || fileName.length === 0) return null;
  if (fileName !== fileName.trim()) return null;
  if (isAbsolute(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) return null;
  if (/^[A-Za-z]:/u.test(fileName)) return null;
  if (fileName.includes(":") || fileName.includes("\0")) return null;

  const segments = fileName.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  if (segments.some((segment) => WINDOWS_RESERVED_NAME.test(segment))) return null;
  if (segments.some((segment) => /[. ]$/u.test(segment))) return null;
  return segments;
}

type RealRoot =
  /** 章节目录还不存在（新书第一次写章）：字符串层已足够，之后的写入会先创建它。 */
  | { readonly kind: "missing" }
  /** 章节目录本身是悬空链接或无法解析：一律拒绝。 */
  | { readonly kind: "broken" }
  | { readonly kind: "ok"; readonly path: string };

function errorCode(error: unknown): unknown {
  return error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
}

/** 目录项本身是否存在（不跟随链接）。无法确认时按“存在”处理，交给调用方拒绝。 */
function entryExists(path: string): boolean {
  try {
    fs.lstatSync(path);
    return true;
  } catch (error) {
    const code = errorCode(error);
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

function resolveRealRoot(root: string): RealRoot {
  try {
    return { kind: "ok", path: fs.realpathSync(root) };
  } catch (error) {
    if (errorCode(error) === "ENOENT" && !entryExists(root)) return { kind: "missing" };
    return { kind: "broken" };
  }
}

/**
 * 对候选路径向上找到第一个已存在的祖先，取其 realpath，判断它是否仍在章节目录的
 * realpath 之下。文件本身可以不存在（新建章节），所以只校验祖先。
 */
function realpathStaysInside(root: string, realRoot: RealRoot, candidate: string): boolean {
  if (realRoot.kind === "missing") return true;
  if (realRoot.kind === "broken") return false;
  let probe = candidate;
  for (;;) {
    // 走到章节目录本身：它的真实路径已经算过，直接视为在内。
    if (probe === root) return true;
    try {
      const real = fs.realpathSync(probe);
      return real === realRoot.path || real.startsWith(realRoot.path + sep);
    } catch (error) {
      // ELOOP、EACCES、ENOTDIR 等：无法确认真实落点，拒绝。
      if (errorCode(error) !== "ENOENT") return false;
      // ENOENT 但目录项存在：这是悬空链接，拒绝（不上溯放行）。
      if (entryExists(probe)) return false;
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/**
 * 为一个章节目录创建解析器。章节目录的 realpath 只在第一次判定时算一次并缓存，
 * 适合一次读索引逐条过滤的热路径（readChapterIndex）；不要跨请求长期持有。
 */
export function createChapterFileResolver(chaptersDir: string): (fileName: string) => string | null {
  const root = resolve(chaptersDir);
  let realRoot: RealRoot | undefined;
  return (fileName) => {
    const segments = safeSegments(fileName);
    if (!segments) return null;
    const candidate = resolve(root, normalize(segments.join(sep)));
    if (candidate !== root && !candidate.startsWith(root + sep)) return null;
    realRoot ??= resolveRealRoot(root);
    if (!realpathStaysInside(root, realRoot, candidate)) return null;
    return join(root, ...segments);
  };
}

/** 单次判定：fileName 落在章节目录内时返回绝对路径，否则返回 null。 */
export function resolveChapterFile(chaptersDir: string, fileName: string): string | null {
  return createChapterFileResolver(chaptersDir)(fileName);
}

/** 解析失败时抛错，供写入路径使用：绝不静默落到章节目录之外。 */
export function requireChapterFile(chaptersDir: string, fileName: string): string {
  const resolved = resolveChapterFile(chaptersDir, fileName);
  if (!resolved) throw new Error(`章节文件路径不在章节目录内：${JSON.stringify(fileName)}`);
  return resolved;
}
