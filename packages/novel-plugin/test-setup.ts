/**
 * novel-plugin 的 vitest 全局 setup（每个测试文件执行前运行）。
 *
 * 1. 数据目录隔离：任何测试都不得读写作者的真实 NOVELFORK_HOME。
 * 2. jsdom 缺口补齐：jsdom 不实现布局，Element.prototype.scrollIntoView 等 API 直接缺失。
 *    组件里做键盘导航时会调用它们，测试环境需要提供 no-op，否则渲染直接抛错。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { afterAll } from "vitest";

function isInsideTempDir(path: string): boolean {
  const fromTemp = relative(resolve(tmpdir()), resolve(path));
  return fromTemp !== "" && !fromTemp.startsWith("..") && !isAbsolute(fromTemp);
}

/**
 * 确保 NOVELFORK_HOME 指向系统临时目录内的测试专用目录。
 *
 * secret-box 等模块按 NOVELFORK_HOME（缺省 ~/.novelfork）懒计算路径，测试里一调用
 * encryptSecret 就会在那里生成 `.secret-key`。隔离运行器（scripts/run-workspace-tests.ts、
 * tmp 下的 pkgtest）会把它设到临时目录，保持不动；直接 `vitest run` 时进程可能没设，或者
 * 继承了作者指向真实数据的值——这两种情况都换成新的临时目录。返回新目录，未改动时返回 null。
 */
export function ensureIsolatedNovelforkHome(env: NodeJS.ProcessEnv, makeTempDir: () => string): string | null {
  const configured = env.NOVELFORK_HOME?.trim();
  if (configured && isInsideTempDir(configured)) return null;
  const dir = makeTempDir();
  env.NOVELFORK_HOME = dir;
  return dir;
}

const inheritedHome = process.env.NOVELFORK_HOME;
const isolatedHome = ensureIsolatedNovelforkHome(process.env, () => mkdtempSync(join(tmpdir(), "novelfork-plugin-test-home-")));
if (isolatedHome) {
  // 每个测试文件各用一个目录：结束时删掉并还原环境变量，下一个文件的 setup 会再建新的。
  afterAll(() => {
    if (inheritedHome === undefined) delete process.env.NOVELFORK_HOME;
    else process.env.NOVELFORK_HOME = inheritedHome;
    rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
}

if (typeof Element !== "undefined") {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {
      // jsdom 无布局，滚动无意义
    };
  }
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = function scrollTo(): void {
      // 同上
    };
  }
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// React Flow 读取视口变换时用 DOMMatrixReadOnly 解析 CSS transform，jsdom 未实现。
if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
  globalThis.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    readonly m22: number;
    constructor(transform?: string) {
      const scale = typeof transform === "string" ? /scale\(([\d.]+)\)/.exec(transform)?.[1] : undefined;
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  } as unknown as typeof globalThis.DOMMatrixReadOnly;
}
