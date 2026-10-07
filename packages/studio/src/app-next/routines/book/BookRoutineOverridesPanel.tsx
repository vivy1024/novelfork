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

import type { ProjectRoutineAction, ProjectRoutineStatus } from "../../runtime-admin";
import { invalidateNarratorCommands } from "../../runtime/narrator-command-cache";
import { createRuntimeProductClient } from "../../runtime/product-contract";
import { ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "../routines-shared";

const productClient = createRuntimeProductClient();

type ToolMode = "manual" | "auto" | "resident";

/** 0.7 起书籍套路接口对可选工具多返回三档模式；旧响应没有这些字段时按开关推断。 */
type BookRoutineStatus = ProjectRoutineStatus & {
	readonly mode?: ToolMode;
	readonly modeOverride?: ToolMode | "global";
	readonly globalMode?: ToolMode;
};

const TOOL_MODE_LABELS: Record<ToolMode, string> = {
	manual: "手动",
	auto: "自动",
	resident: "常驻",
};

/** 与 Runtime 的 routineCategory 文案一致；未知分类原样显示。 */
const CATEGORY_LABELS: Record<string, string> = {
	tools: "工具",
	workflow: "工作流",
	testing: "测试",
	"code-quality": "代码质量",
};

function globalStateLabel(routine: BookRoutineStatus): string {
	if (routine.type === "tool") {
		return TOOL_MODE_LABELS[routine.globalMode ?? (routine.globalEnabled ? "resident" : "manual")];
	}
	return routine.globalEnabled ? "启用" : "停用";
}

function effectiveStateLabel(routine: BookRoutineStatus): string {
	if (routine.type === "tool") {
		return TOOL_MODE_LABELS[routine.mode ?? (routine.enabled ? "resident" : "manual")];
	}
	return routine.enabled ? "启用" : "停用";
}

/**
 * 书籍套路覆盖：通过可信书籍绑定写 Runtime 项目的套路配置，不接收 Runtime 项目标识。
 * 书籍接口只有「跟随全局 / 启用 / 停用」三个动作，对可选工具分别是跟随全局 / 常驻 / 手动。
 */
export function BookRoutineOverridesPanel({
	bookId,
	bookTitle,
}: {
	readonly bookId: string;
	readonly bookTitle: string;
}) {
	const [routines, setRoutines] = useState<readonly BookRoutineStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await productClient.listBookRoutines(bookId);
			setRoutines(result.routines as readonly BookRoutineStatus[]);
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
		const result = new Map<string, BookRoutineStatus[]>();
		for (const routine of routines) {
			const items = result.get(routine.category) ?? [];
			items.push(routine);
			result.set(routine.category, items);
		}
		return [...result.entries()];
	}, [routines]);

	async function apply(routine: BookRoutineStatus, action: ProjectRoutineAction) {
		setPendingId(routine.id);
		setError(null);
		try {
			await productClient.toggleBookRoutine(bookId, routine.id, action);
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
				description={`为《${bookTitle}》单独决定 Terminal、Browser 等可选工具是否常驻。选「跟随全局」时沿用「通用套路 › 可选工具」的设置（包括自动档）。改动后新开或重建叙述者会话才会装入；会话内也可以用 /load、/unload。`}
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
						<section key={category} aria-label={category} className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<h3 className="font-medium">{CATEGORY_LABELS[category] ?? category}</h3>
								<Badge variant="outline">{items.length}</Badge>
							</div>
							<div className="grid gap-3 md:grid-cols-2">
								{items.map((routine) => {
									const isTool = routine.type === "tool";
									const toolOverride =
										routine.modeOverride ??
										(routine.override === "global" ? "global" : routine.override === "enabled" ? "resident" : "manual");
									const options: ReadonlyArray<{ action: ProjectRoutineAction; label: string; active: boolean }> = [
										{ action: "reset", label: "跟随全局", active: routine.override === "global" },
										{
											action: "enable",
											label: isTool ? "常驻" : "启用",
											active: isTool ? toolOverride === "resident" : routine.override === "enabled",
										},
										{
											action: "disable",
											label: isTool ? "手动" : "停用",
											active: isTool ? toolOverride === "manual" : routine.override === "disabled",
										},
									];
									return (
										<Card key={routine.id}>
											<CardHeader>
												<CardTitle className="flex flex-wrap items-center gap-2">
													{routine.name}
													{isTool && (
														<Badge variant="outline" className="font-mono text-2xs">
															/load {routine.id}
														</Badge>
													)}
												</CardTitle>
												<CardDescription>{routine.descriptionZh || routine.descriptionEn}</CardDescription>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
													<Badge variant="outline">全局：{globalStateLabel(routine)}</Badge>
													<Badge variant="secondary">本书实际：{effectiveStateLabel(routine)}</Badge>
													{isTool && toolOverride === "auto" && (
														<span>本书当前为自动档（在 Runtime 里设的），这里只能改为跟随全局、常驻或手动。</span>
													)}
												</div>
												<fieldset className="flex flex-wrap gap-1" aria-label={`本书覆盖：${routine.name}`}>
													{options.map((option) => (
														<Button
															key={option.action}
															type="button"
															size="xs"
															variant={option.active ? "default" : "outline"}
															aria-pressed={option.active}
															disabled={pendingId === routine.id}
															onClick={() => void apply(routine, option.action)}
														>
															{option.label}
														</Button>
													))}
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
