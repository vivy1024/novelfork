import { RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

import type {
	ProjectRoutineAction,
	ProjectRoutineStatus,
	ToolRoutineMode,
	ToolRoutineModeOverride,
} from "../../runtime-admin";
import { invalidateNarratorCommands } from "../../runtime/narrator-command-cache";
import { createRuntimeProductClient } from "../../runtime/product-contract";
import { ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "../routines-shared";

const productClient = createRuntimeProductClient();

const TOOL_MODE_LABELS: Record<ToolRoutineMode, string> = {
	manual: "手动",
	auto: "自动",
	resident: "常驻",
};

/** 与 Runtime 的 routineCategory 文案一致；产品贡献的套路以产品 id 为分类；未知分类原样显示。 */
const CATEGORY_LABELS: Record<string, string> = {
	tools: "工具",
	novelfork: "小说工具",
	workflow: "工作流",
	testing: "测试",
	"code-quality": "代码质量",
};

/** 可选工具的本书覆盖四档：按 NarraFork 套路三段式，加上「跟随全局」。 */
const TOOL_OVERRIDE_OPTIONS: ReadonlyArray<{ mode: ToolRoutineModeOverride; label: string }> = [
	{ mode: "global", label: "跟随全局" },
	{ mode: "resident", label: "常驻" },
	{ mode: "auto", label: "自动" },
	{ mode: "manual", label: "手动" },
];

const COMMAND_OPTIONS: ReadonlyArray<{ action: ProjectRoutineAction; label: string }> = [
	{ action: "reset", label: "跟随全局" },
	{ action: "enable", label: "启用" },
	{ action: "disable", label: "停用" },
];

function displayName(routine: ProjectRoutineStatus): string {
	return routine.nameZh || routine.name;
}

function globalStateLabel(routine: ProjectRoutineStatus): string {
	if (routine.type === "tool") {
		return TOOL_MODE_LABELS[routine.globalMode ?? (routine.globalEnabled ? "resident" : "manual")];
	}
	return routine.globalEnabled ? "启用" : "停用";
}

function effectiveStateLabel(routine: ProjectRoutineStatus): string {
	if (routine.type === "tool") {
		return TOOL_MODE_LABELS[routine.mode ?? (routine.enabled ? "resident" : "manual")];
	}
	return routine.enabled ? "启用" : "停用";
}

/** 旧响应没有 modeOverride 时按开关推断。 */
function toolOverrideOf(routine: ProjectRoutineStatus): ToolRoutineModeOverride {
	return (
		routine.modeOverride ??
		(routine.override === "global" ? "global" : routine.override === "enabled" ? "resident" : "manual")
	);
}

/**
 * 书籍套路覆盖：通过可信书籍绑定写 Runtime 项目的套路配置，不接收 Runtime 项目标识。
 * 可选工具（含小说工具套路）按 NarraFork 三段式写模式：跟随全局 / 常驻 / 自动 / 手动；
 * 命令、技能套路仍是跟随全局 / 启用 / 停用。
 */
export function BookRoutineOverridesPanel({
	bookId,
	bookTitle,
}: {
	readonly bookId: string;
	readonly bookTitle: string;
}) {
	const [routines, setRoutines] = useState<readonly ProjectRoutineStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await productClient.listBookRoutines(bookId);
			setRoutines(result.routines);
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	const grouped = useMemo(() => {
		const result = new Map<string, ProjectRoutineStatus[]>();
		for (const routine of routines) {
			const items = result.get(routine.category) ?? [];
			items.push(routine);
			result.set(routine.category, items);
		}
		return [...result.entries()];
	}, [routines]);

	async function mutate(routine: ProjectRoutineStatus, change: () => Promise<unknown>) {
		setPendingId(routine.id);
		setError(null);
		try {
			await change();
			await invalidateNarratorCommands();
			await load();
		} catch (toggleError) {
			setError(errorMessage(toggleError));
		} finally {
			setPendingId(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="可选工具覆盖"
				description={`为《${bookTitle}》单独决定可选工具（Terminal、Browser 等，以及小说创作、小说维护等小说工具组）的档位：常驻是每个新会话默认装载，手动是只在会话里用 /load 加载，自动目前与手动相同（等工具检索上线后按需加载）。选「跟随全局」时沿用「通用套路 › 可选工具」的设置。改动后新开或重建叙述者会话才会装入；会话内也可以用 /load、/unload。`}
				action={
					<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
						<RefreshCw data-icon="inline-start" />
						刷新
					</Button>
				}
			/>
			{error && <ErrorAlert title="书籍套路请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : routines.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Wrench />
						</EmptyMedia>
						<EmptyTitle>没有可覆盖的套路</EmptyTitle>
						<EmptyDescription>Runtime 返回的套路注册表为空。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-5">
					{grouped.map(([category, items]) => (
						<section key={category} aria-label={CATEGORY_LABELS[category] ?? category} className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<h3 className="font-medium">{CATEGORY_LABELS[category] ?? category}</h3>
								<Badge variant="outline">{items.length}</Badge>
							</div>
							<div className="grid gap-3 md:grid-cols-2">
								{items.map((routine) => {
									const name = displayName(routine);
									const isTool = routine.type === "tool";
									const toolOverride = toolOverrideOf(routine);
									const toolCount = routine.toolNames?.length ?? 0;
									return (
										<Card key={routine.id}>
											<CardHeader>
												<CardTitle className="flex flex-wrap items-center gap-2">
													{name}
													{isTool && (
														<Badge variant="outline" className="font-mono text-2xs">
															/load {routine.id}
														</Badge>
													)}
													{toolCount > 1 && <Badge variant="secondary">{toolCount} 个工具</Badge>}
												</CardTitle>
												<CardDescription>{routine.descriptionZh || routine.descriptionEn}</CardDescription>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
													<Badge variant="outline">全局：{globalStateLabel(routine)}</Badge>
													<Badge variant="secondary">本书实际：{effectiveStateLabel(routine)}</Badge>
													{isTool && routine.mode === "auto" && <span>自动档目前与手动相同，需要时用 /load 加载。</span>}
												</div>
												<fieldset className="flex flex-wrap gap-1" aria-label={`本书覆盖：${name}`}>
													{isTool
														? TOOL_OVERRIDE_OPTIONS.map((option) => (
															<Button
																key={option.mode}
																type="button"
																size="xs"
																variant={toolOverride === option.mode ? "default" : "outline"}
																aria-pressed={toolOverride === option.mode}
																disabled={pendingId === routine.id}
																onClick={() =>
																	void mutate(routine, () =>
																		productClient.setBookRoutineMode(bookId, routine.id, option.mode),
																	)
																}
															>
																{option.label}
															</Button>
														))
														: COMMAND_OPTIONS.map((option) => {
															const active =
																(option.action === "reset" && routine.override === "global") ||
																(option.action === "enable" && routine.override === "enabled") ||
																(option.action === "disable" && routine.override === "disabled");
															return (
																<Button
																	key={option.action}
																	type="button"
																	size="xs"
																	variant={active ? "default" : "outline"}
																	aria-pressed={active}
																	disabled={pendingId === routine.id}
																	onClick={() =>
																		void mutate(routine, () =>
																			productClient.toggleBookRoutine(bookId, routine.id, option.action),
																		)
																	}
																>
																	{option.label}
																</Button>
															);
														})}
												</fieldset>
											</CardContent>
										</Card>
									);
								})}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
