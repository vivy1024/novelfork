/**
 * jsdom 缺口补齐。
 *
 * jsdom 不实现布局，Element.prototype.scrollIntoView 等 API 直接缺失。
 * 组件里做键盘导航时会调用它们，测试环境需要提供 no-op，否则渲染直接抛错。
 */

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
