import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * 当前设备上的本地外观偏好（OLED 纯黑、屏幕常亮）。
 *
 * 这些 key 的唯一权威写入方是嵌入的 Runtime 外观页（它自带的 OLED / 保持屏幕唤醒开关，
 * 见 Runtime 的 `hooks/useLocalPref`）。Studio 只负责**执行**它们：
 * - `narrafork_oled` → `<html class="oled">`，纯黑令牌见 novelfork-motifs.css；
 * - `narrafork_wakelock` → Screen Wake Lock 申请/释放。
 *
 * 为什么 Studio 必须自己执行：嵌入模式下 Runtime 的 `__root` 直接渲染页面（`embeddedPage`），
 * 不挂 `AuthenticatedAppLayout`，而 Runtime 的 `useWakeLock` 与 `useAuthenticatedAppearance`
 * 只在那两个 Layout 里运行。开关能点，但没人执行——开关亮着却没有任何效果。
 *
 * 为什么需要 setItem 广播：同标签页内的 `localStorage.setItem` **不会**触发 `storage` 事件
 * （Web 标准：storage 事件只发给其他文档）。Runtime 的 `useLocalPref` 又只通知它自己模块内的
 * 订阅者。跨包的同标签页偏好同步没有标准机制，所以这里包装一次 `setItem` 来补上这个缺口——
 * 这是本文件唯一"有魔法"的地方，且只旁听、不改写值、不拦截任何调用。
 */

export type LocalBooleanPreferenceKey = "narrafork_oled" | "narrafork_wakelock";

const WATCHED_KEYS: ReadonlySet<string> = new Set<LocalBooleanPreferenceKey>([
  "narrafork_oled",
  "narrafork_wakelock",
]);

/** 同标签页内的偏好变更通知（跨标签仍由原生 storage 事件覆盖）。 */
export const LOCAL_PREFERENCE_EVENT = "novelfork:local-preference-change";

const listeners = new Set<() => void>();
/** 已包装过的存储对象；换了对象（测试替身、受限环境重建）要重新包装。 */
let wrappedStorage: Storage | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/** 找到承载 `setItem` 的那一层：真 Storage 在原型上，测试替身可能挂在自身。 */
function setItemOwner(storage: Storage): { target: object; original: Storage["setItem"] } | null {
  for (let target: object | null = storage; target; target = Object.getPrototypeOf(target) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "setItem");
    if (descriptor && typeof descriptor.value === "function") {
      return { target, original: descriptor.value as Storage["setItem"] };
    }
  }
  return null;
}

/**
 * 包装 `setItem`：受关注的 key 被写入时广播一次。
 * 幂等（同一个存储对象只包一次）；受限环境下静默跳过，退回 storage 事件与重新挂载时读取。
 */
export function installLocalPreferenceBroadcast(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage || storage === wrappedStorage) return;
    const owner = setItemOwner(storage);
    if (!owner) return;
    const { target, original } = owner;
    const wrapper = function setItem(this: Storage, key: string, value: string): void {
      original.call(this, key, value);
      if (WATCHED_KEYS.has(key) && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(LOCAL_PREFERENCE_EVENT, { detail: { key } }));
      }
    };
    Object.defineProperty(target, "setItem", {
      configurable: true,
      writable: true,
      value: wrapper,
    });
    wrappedStorage = storage;
  } catch {
    /* 受限环境：退回 storage 事件（跨标签）与重新挂载时读取 */
  }
}

function readStoredBoolean(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "true";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !WATCHED_KEYS.has(event.key)) return;
    notify();
  };
  const onLocal = () => notify();
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_PREFERENCE_EVENT, onLocal);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_PREFERENCE_EVENT, onLocal);
  };
}

/**
 * 订阅一个本地布尔偏好。返回 `[value, setValue]`；写入会广播给所有订阅者
 * （包括嵌入的 Runtime 组件，如果它同时读同一个 key）。
 */
export function useLocalBooleanPreference(
  key: LocalBooleanPreferenceKey,
): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readStoredBoolean(key),
    () => false,
  );
  const update = useCallback((next: boolean) => {
    try {
      globalThis.localStorage?.setItem(key, String(next));
    } catch {
      /* 存不下时只影响本次会话；下面的 notify 仍让界面跟上 */
    }
    notify();
  }, [key]);
  return [value, update] as const;
}

/** OLED 纯黑只在深色下有用（CSS 是 `:root.dark.oled`）；浅色下挂类无害，保持恒等语义即可。 */
export function applyOledPreferenceToDOM(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("oled", enabled);
}

type WakeLockSentinelLike = {
  readonly released?: boolean;
  release: () => Promise<void> | void;
  addEventListener?: (type: string, listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * 按偏好申请 / 释放屏幕常亮。语义与 Runtime 的 `useWakeLock` 对齐：
 * 页面重新可见时补申请（切走标签页会被浏览器自动释放），不支持该 API 时静默降级。
 */
export function useScreenWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const wakeLock = (typeof navigator === "undefined" ? undefined : (navigator as WakeLockNavigator).wakeLock);
    if (!enabled || !wakeLock) return;
    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener?.("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        /* 权限被拒或环境不支持：保持界面不变 */
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    };
  }, [enabled]);
}

/**
 * 常驻执行者：把两个本地偏好转成实际效果。挂在产品外壳上（StudioNextApp），
 * 因为它必须一直活着，而不是只在打开外观设置页时才运行。
 */
export function useLocalAppearanceEffects(): void {
  const [oled] = useLocalBooleanPreference("narrafork_oled");
  const [wakeLock] = useLocalBooleanPreference("narrafork_wakelock");

  useEffect(() => {
    applyOledPreferenceToDOM(oled);
  }, [oled]);

  useScreenWakeLock(wakeLock);
}

/**
 * 入口处调用（`main.tsx`，渲染前）：装上同标签页广播，并按已存偏好先挂上纯黑，
 * 避免首屏先画一遍非纯黑再闪成纯黑。常亮不在这里申请——Wake Lock 需要页面可见，
 * 交给挂载后的 `useLocalAppearanceEffects`。
 */
export function initLocalPreferences(): void {
  installLocalPreferenceBroadcast();
  applyOledPreferenceToDOM(readStoredBoolean("narrafork_oled"));
}
