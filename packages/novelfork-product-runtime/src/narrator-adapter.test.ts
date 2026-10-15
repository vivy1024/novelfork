import { describe, expect, test } from "bun:test";
import { novelForkProductIntegration } from "./index";

/**
 * 书籍叙述者的工具按 NarraFork 的权限与套路体系管理：产品给 Runtime 的只有工具、权限策略、
 * 工具套路与本趟可见性；启用哪些工具由 Runtime 的「可选工具」套路、/load 与持久化加载决定。
 */
describe("产品注册给 Runtime 的书籍叙述者适配器", () => {
	const narrator = novelForkProductIntegration.narrator;

	test("转发小说工具的权限策略（Runtime 据此按会话权限模式过滤与审批）", () => {
		expect(narrator?.getToolPermissionPolicy?.("chapter_write")).toMatchObject({
			risk: "confirmed-write",
			visibility: "author",
		});
		expect(narrator?.getToolPermissionPolicy?.("memory_bulk_delete")?.visibility).toBe("advanced");
	});

	test("贡献四组工具套路，交给「套路 › 可选工具」管理", () => {
		const routines = narrator?.toolRoutines?.() ?? [];
		expect(routines.map((routine) => [routine.id, routine.defaultMode])).toEqual([
			["novelfork.writing", "resident"],
			["novelfork.market", "resident"],
			["novelfork.memory-inspect", "manual"],
			["novelfork.maintenance", "manual"],
		]);
	});

	test("不再提供改写会话启用集合的 syncToolVisibility", () => {
		expect(narrator && "syncToolVisibility" in narrator).toBe(false);
	});
});
