import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	applyOledPreferenceToDOM,
	initLocalPreferences,
	installLocalPreferenceBroadcast,
	useLocalAppearanceEffects,
	useScreenWakeLock,
} from "./use-local-preferences";

/**
 * D1 / D3 红测：本地外观偏好必须有执行者，且切换要即时生效。
 *
 * 背景（这是本测试存在的唯一理由）：开关在**嵌入的 Runtime 外观页**上（Runtime 自带的
 * OLED / 保持屏幕唤醒，写 `narrafork_oled` / `narrafork_wakelock`），但执行者原本都在
 * Runtime 自己的 `AuthenticatedAppLayout` / `StandaloneWindowLayout` 里。Studio 嵌入
 * Runtime 时 `__root` 走 `embeddedPage` 分支直接渲染页面、不挂那两个 Layout——开关能点，
 * 没人执行：屏幕常亮完全没效果（D1），纯黑模式只能在下次启动时靠 `initTheme` 生效，
 * 会话内切换不生效（D3）。
 *
 * 存储用 Map 替身（与 AppearancePanel.test.tsx 同一套路）：本仓库 jsdom 的
 * `localStorage` 是缺方法的最小实现，替身还能让「写入是否触发广播」被看清楚。
 */

const OLED_KEY = "narrafork_oled";
const WAKELOCK_KEY = "narrafork_wakelock";

let store: Map<string, string>;

function installStorageStub(): void {
	store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
	});
}

/** 让「包装 setItem 后广播」在替身上生效：每次重建替身都要重新装一次。 */
function installBroadcast(): void {
	installLocalPreferenceBroadcast();
}

function installWakeLockStub(): { request: ReturnType<typeof vi.fn>; released: number[] } {
	const released: number[] = [];
	let issued = 0;
	const request = vi.fn(async () => {
		issued += 1;
		const index = issued;
		return {
			release: () => {
				released.push(index);
			},
			addEventListener: () => undefined,
		};
	});
	Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
	return { request, released };
}

beforeEach(() => {
	installStorageStub();
	installBroadcast();
	document.documentElement.classList.remove("oled");
});

afterEach(() => {
	cleanup();
	Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "wakeLock");
	vi.unstubAllGlobals();
	document.documentElement.classList.remove("oled");
});

describe("OLED 纯黑（D3）", () => {
	it("偏好为 true 时挂上 oled 类，为 false 时摘掉", () => {
		applyOledPreferenceToDOM(true);
		expect(document.documentElement.classList.contains("oled")).toBe(true);

		applyOledPreferenceToDOM(false);
		expect(document.documentElement.classList.contains("oled")).toBe(false);
	});

	it("开关在别处被写入时本次会话立即生效，不需要重载页面", () => {
		renderHook(() => useLocalAppearanceEffects());
		expect(document.documentElement.classList.contains("oled")).toBe(false);

		// 关键：同标签页内 localStorage.setItem 不会触发原生 storage 事件，而 Runtime 的
		// useLocalPref 只通知它自己模块内的订阅者。跨包同步靠包装 setItem 广播——这里就走
		// 那条路径，不能改成手工派发自定义事件，否则测不到真正会失效的那一环。
		act(() => {
			localStorage.setItem(OLED_KEY, "true");
		});
		expect(document.documentElement.classList.contains("oled")).toBe(true);

		act(() => {
			localStorage.setItem(OLED_KEY, "false");
		});
		expect(document.documentElement.classList.contains("oled")).toBe(false);
	});

	it("入口初始化时按已存偏好挂上，重启后仍然生效", () => {
		localStorage.setItem(OLED_KEY, "true");
		initLocalPreferences();
		expect(document.documentElement.classList.contains("oled")).toBe(true);
	});

	it("没有存过偏好时不挂 oled 类", () => {
		initLocalPreferences();
		expect(document.documentElement.classList.contains("oled")).toBe(false);
	});

	/**
	 * 扫描器式的自证红测：证明上一条「即时生效」测的确实是广播那一环。
	 * 换一个**没有**被包装过的存储替身，同样的写入就不会传到订阅者——
	 * 若把广播去掉，上一条会以同样的方式失败，而不是碰巧通过。
	 */
	it("没有装上广播时，同样的写入不会传到订阅者（自证红测）", () => {
		renderHook(() => useLocalAppearanceEffects());
		expect(document.documentElement.classList.contains("oled")).toBe(false);

		installStorageStub(); // 换一个新的替身，且不重新包装 setItem
		act(() => {
			localStorage.setItem(OLED_KEY, "true");
		});
		expect(document.documentElement.classList.contains("oled")).toBe(false);
	});
});

describe("屏幕常亮（D1）", () => {
	it("偏好开启时申请 Wake Lock，关闭时释放", async () => {
		const { request, released } = installWakeLockStub();

		const { rerender } = renderHook(({ enabled }) => useScreenWakeLock(enabled), {
			initialProps: { enabled: true },
		});
		await act(async () => {});
		expect(request).toHaveBeenCalledWith("screen");

		rerender({ enabled: false });
		await act(async () => {});
		expect(released).toEqual([1]);
	});

	it("偏好开启时由常驻执行者申请，不需要打开外观设置页", async () => {
		const { request } = installWakeLockStub();
		localStorage.setItem(WAKELOCK_KEY, "true");

		renderHook(() => useLocalAppearanceEffects());
		await act(async () => {});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("偏好关闭时不申请", async () => {
		const { request } = installWakeLockStub();
		localStorage.setItem(WAKELOCK_KEY, "false");

		renderHook(() => useLocalAppearanceEffects());
		await act(async () => {});
		expect(request).not.toHaveBeenCalled();
	});

	it("运行期打开开关就立即申请（读编辑器时不会中途息屏）", async () => {
		const { request } = installWakeLockStub();
		renderHook(() => useLocalAppearanceEffects());
		await act(async () => {});
		expect(request).not.toHaveBeenCalled();

		act(() => {
			localStorage.setItem(WAKELOCK_KEY, "true");
		});
		await act(async () => {});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("浏览器不支持 Wake Lock 时静默降级，不抛错", async () => {
		Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "wakeLock");
		localStorage.setItem(WAKELOCK_KEY, "true");

		expect(() => renderHook(() => useLocalAppearanceEffects())).not.toThrow();
		await act(async () => {});
	});

	it("申请被拒时不抛出，界面保持原状", async () => {
		Object.defineProperty(navigator, "wakeLock", {
			configurable: true,
			value: {
				request: vi.fn(async () => {
					throw new Error("permission denied");
				}),
			},
		});
		localStorage.setItem(WAKELOCK_KEY, "true");

		expect(() => renderHook(() => useLocalAppearanceEffects())).not.toThrow();
		await act(async () => {});
	});
});
