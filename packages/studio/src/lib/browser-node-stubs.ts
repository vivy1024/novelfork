/**
 * 浏览器构建的 node 内置模块桩。
 *
 * 产品前端的模块图会经由 `@vivy1024/novelfork-core` 根入口（如 ai-gate）
 * 拖进少量 server 侧模块（storage/state）。这些模块对 `node:fs/promises`
 * 等的具名导入一旦在 rollup 渲染期幸存（摇树是边际性的，随模块图微涨而
 * 翻转），就会撞上 `__vite-browser-external` 空壳导致整个构建硬崩——
 * v0.0.3 期间已实际发生两次。
 *
 * 因此 vite.config 把这些说明符 alias 到本文件：具名导出一律是"浏览器
 * 不支持"的显式抛错函数。任何真实调用都会立刻得到可诊断的错误，而不是
 * 静默 undefined；同时让构建不再依赖摇树运气。
 */

function unavailable(name: string): () => never {
  return () => {
    throw new Error(`[browser-stub] node:${name} 在浏览器端不可用（该调用应只发生在 server 侧）`);
  };
}

// ── node:fs/promises ────────────────────────────────────────────────
export const access = unavailable("fs/promises.access");
export const copyFile = unavailable("fs/promises.copyFile");
export const mkdir = unavailable("fs/promises.mkdir");
export const open = unavailable("fs/promises.open");
export const readdir = unavailable("fs/promises.readdir");
export const readFile = unavailable("fs/promises.readFile");
export const rename = unavailable("fs/promises.rename");
export const rm = unavailable("fs/promises.rm");
export const stat = unavailable("fs/promises.stat");
export const unlink = unavailable("fs/promises.unlink");
export const writeFile = unavailable("fs/promises.writeFile");

// ── node:fs ─────────────────────────────────────────────────────────
export const existsSync = unavailable("fs.existsSync") as unknown as (path: string) => boolean;
export const mkdirSync = unavailable("fs.mkdirSync");
export const readFileSync = unavailable("fs.readFileSync") as unknown as (path: string) => string;
export const readdirSync = unavailable("fs.readdirSync");

// ── node:crypto ─────────────────────────────────────────────────────
export const createHash = unavailable("crypto.createHash");
export const createHmac = unavailable("crypto.createHmac");
export const randomUUID = unavailable("crypto.randomUUID") as unknown as () => string;

// ── node:module ─────────────────────────────────────────────────────
export const createRequire = unavailable("module.createRequire");

// ── node:os ─────────────────────────────────────────────────────────
export const homedir = unavailable("os.homedir") as unknown as () => string;
export const tmpdir = unavailable("os.tmpdir") as unknown as () => string;
