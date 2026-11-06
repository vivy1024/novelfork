import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { novelForkProductIntegration } from "./index";

const RUNTIME_TOOL_ROUTINES_SPECIFIER = resolve(
	import.meta.dir,
	"../../narrafork-runtime-private/server/lib/product-host/tool-routines.ts",
);

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

	test("每个小说工具贡献一个套路，交给「套路 › 可选工具」逐个管理", () => {
		const routines = narrator?.toolRoutines?.() ?? [];
		const registered = narrator?.toolDefinitions().map((tool) => tool.name) ?? [];
		expect(routines).toHaveLength(registered.length);
		expect(routines.every((routine) => routine.toolNames.length === 1)).toBe(true);
		const byTool = new Map(routines.map((routine) => [routine.toolNames[0], routine]));
		expect(byTool.get("pipeline_write")).toMatchObject({ id: "novelfork.pipeline.write", defaultMode: "resident" });
		expect(byTool.get("workflow_submit_step_output")?.defaultMode).toBe("resident");
		expect(byTool.get("memory_bulk_delete")).toMatchObject({ id: "novelfork.memory.bulk-delete", defaultMode: "manual" });
		expect(byTool.get("market_scan")?.defaultMode).toBe("auto");
	});

	test("Runtime 的套路校验全部接受（id 合法、工具都已注册、互不抢占）", async () => {
		// 变量指示符：字面量 import 会把整棵 Runtime 源码树拉进本包的类型检查（见 book-project-owner.test.ts）。
		const { buildProductToolRoutines } = await import(RUNTIME_TOOL_ROUTINES_SPECIFIER);
		const { routines, rejected } = buildProductToolRoutines(novelForkProductIntegration, new Set<string>()) as {
			routines: readonly unknown[];
			rejected: readonly unknown[];
		};
		expect(rejected).toEqual([]);
		expect(routines).toHaveLength(narrator?.toolDefinitions().length ?? -1);
	});

	test("不再提供改写会话启用集合的 syncToolVisibility", () => {
		expect(narrator && "syncToolVisibility" in narrator).toBe(false);
	});
});
