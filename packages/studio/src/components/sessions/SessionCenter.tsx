import {
	Box,
	MessageSquareText,
	Pin,
	PinOff,
	RefreshCw,
	ShieldCheck,
	Terminal,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	createRuntimeNarratorClient,
	type RuntimeForkInheritMode,
	type RuntimeNarratorClient,
	type RuntimeNarratorRecord,
	type RuntimePermissionMode,
} from "@/app-next/runtime/runtime-narrator-client";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "../ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { SimpleSelect } from "../ui/simple-select";
import { NewSessionDialog, type NewSessionPayload } from "./NewSessionDialog";

export type SessionCenterSortMode =
	| "recent"
	| "lastModified-desc"
	| "createdAt-desc"
	| "messageCount-desc"
	| "title";
type SessionCenterScope = "all" | "standalone" | "book";
type SessionCenterStatus = "active" | "archived";
type ConfirmAction =
	| {
			readonly kind: "archive" | "restore" | "delete";
			readonly narrator: RuntimeNarratorRecord;
	  }
	| {
			readonly kind: "batchArchive" | "batchRestore" | "batchDelete";
			readonly ids: readonly string[];
	  };

export interface SessionCenterProps {
	readonly className?: string;
	readonly client?: RuntimeNarratorClient;
	readonly initialCreateOpen?: boolean;
	readonly onOpenNarrator: (narratorId: string) => void;
	readonly onChanged?: () => void | Promise<void>;
}

const STATUS_OPTIONS = [
	{ value: "active", label: "活跃" },
	{ value: "archived", label: "已归档" },
] as const;
const SCOPE_OPTIONS = [
	{ value: "all", label: "全部来源" },
	{ value: "standalone", label: "独立叙述者" },
	{ value: "book", label: "书籍叙述者" },
] as const;
const SORT_OPTIONS: ReadonlyArray<{
	value: SessionCenterSortMode;
	label: string;
}> = [
	{ value: "recent", label: "最近活动" },
	{ value: "lastModified-desc", label: "最后消息" },
	{ value: "createdAt-desc", label: "创建时间" },
	{ value: "messageCount-desc", label: "消息数量" },
	{ value: "title", label: "标题" },
];
const FORK_OPTIONS: ReadonlyArray<{
	value: RuntimeForkInheritMode;
	label: string;
}> = [
	{ value: "full", label: "完整继承" },
	{ value: "compressed", label: "压缩继承" },
	{ value: "fresh", label: "全新上下文" },
];
const PERMISSION_LABELS: Record<RuntimePermissionMode, string> = {
	default: "按需询问",
	acceptEdits: "自动接受编辑",
	bypassPermissions: "全部允许",
	readOnly: "只读",
	dontAsk: "不再询问",
};

function formatDate(value: string | null | undefined): string {
	if (!value) return "暂无";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function runtimeStatusLabel(narrator: RuntimeNarratorRecord): string {
	if (narrator.status === "archived") return "已归档";
	if (narrator.status === "working") return "工作中";
	if (narrator.status === "waiting") return "等待中";
	return "空闲";
}

function substatusLabel(value: string): string {
	return value
		.split(/[_-]+/u)
		.filter(Boolean)
		.map((part) => part.charAt(0).toLocaleUpperCase("zh-CN") + part.slice(1))
		.join(" ");
}

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

function isProtected(narrator: RuntimeNarratorRecord): boolean {
	return narrator.binding?.kind === "novel.book";
}

function confirmationText(action: ConfirmAction): {
	title: string;
	description: string;
	confirm: string;
} {
	switch (action.kind) {
		case "archive":
			return {
				title: "归档叙述者？",
				description: `归档「${action.narrator.title}」后，它会从活跃列表移到已归档列表。`,
				confirm: "确认归档",
			};
		case "restore":
			return {
				title: "恢复叙述者？",
				description: `恢复「${action.narrator.title}」后，它会回到活跃列表。`,
				confirm: "确认恢复",
			};
		case "delete":
			return {
				title: "永久删除叙述者？",
				description: `「${action.narrator.title}」及其 Runtime 会话数据将永久删除，此操作不可撤销。`,
				confirm: "永久删除",
			};
		case "batchArchive":
			return {
				title: "批量归档叙述者？",
				description: `将归档选中的 ${action.ids.length} 个独立叙述者。`,
				confirm: "批量归档",
			};
		case "batchRestore":
			return {
				title: "批量恢复叙述者？",
				description: `将恢复选中的 ${action.ids.length} 个独立叙述者。`,
				confirm: "批量恢复",
			};
		case "batchDelete":
			return {
				title: "批量永久删除？",
				description: `将永久删除选中的 ${action.ids.length} 个已归档独立叙述者，此操作不可撤销。`,
				confirm: "批量删除",
			};
	}
}

export function SessionCenter({
	className,
	client: suppliedClient,
	initialCreateOpen = false,
	onOpenNarrator,
	onChanged,
}: SessionCenterProps) {
	const defaultClient = useMemo(() => createRuntimeNarratorClient(), []);
	const client = suppliedClient ?? defaultClient;
	const [status, setStatus] = useState<SessionCenterStatus>("active");
	const [scope, setScope] = useState<SessionCenterScope>("all");
	const [sort, setSort] = useState<SessionCenterSortMode>("recent");
	const [search, setSearch] = useState("");
	const [narrators, setNarrators] = useState<RuntimeNarratorRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [newDialogOpen, setNewDialogOpen] = useState(initialCreateOpen);
	const [renameTarget, setRenameTarget] =
		useState<RuntimeNarratorRecord | null>(null);
	const [renameTitle, setRenameTitle] = useState("");
	const [forkTarget, setForkTarget] = useState<RuntimeNarratorRecord | null>(
		null,
	);
	const [forkTitle, setForkTitle] = useState("");
	const [forkMode, setForkMode] = useState<RuntimeForkInheritMode>("full");
	const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
		null,
	);

	useEffect(() => {
		if (initialCreateOpen) setNewDialogOpen(true);
	}, [initialCreateOpen]);

	const notifyChanged = useCallback(async () => {
		await onChanged?.();
	}, [onChanged]);

	const loadNarrators = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await client.listNarrators({ status, scope, search, sort });
			setNarrators(next);
			setSelectedIds((current) => {
				const valid = new Set(
					next.filter((item) => !isProtected(item)).map((item) => item.id),
				);
				return new Set([...current].filter((id) => valid.has(id)));
			});
		} catch (cause) {
			setNarrators([]);
			setSelectedIds(new Set());
			setError(errorMessage(cause, "叙述者列表加载失败"));
		} finally {
			setLoading(false);
		}
	}, [client, scope, search, sort, status]);

	useEffect(() => {
		void loadNarrators();
	}, [loadNarrators]);

	const runMutation = async (
		action: () => Promise<void>,
		fallback: string,
		successText: string,
	) => {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			await action();
			await Promise.all([loadNarrators(), notifyChanged()]);
			setSuccess(successText);
			return true;
		} catch (cause) {
			await Promise.allSettled([loadNarrators(), notifyChanged()]);
			setError(errorMessage(cause, fallback));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const openNarrator = async (narrator: RuntimeNarratorRecord) => {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			await client.openNarrator(narrator);
			await notifyChanged();
			onOpenNarrator(narrator.id);
		} catch (cause) {
			setError(errorMessage(cause, "打开叙述者失败"));
		} finally {
			setBusy(false);
		}
	};

	const createNarrator = async (payload: NewSessionPayload) => {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const narrator = await client.createNarrator(payload);
			setNewDialogOpen(false);
			await notifyChanged();
			onOpenNarrator(narrator.id);
		} catch (cause) {
			setError(errorMessage(cause, "创建叙述者失败"));
		} finally {
			setBusy(false);
		}
	};

	const continueLatest = async () => {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const narrator = await client.continueLatestNarrator();
			if (!narrator) throw new Error("暂无可继续的独立叙述者");
			await client.openNarrator(narrator);
			await notifyChanged();
			onOpenNarrator(narrator.id);
		} catch (cause) {
			setError(errorMessage(cause, "继续最近叙述者失败"));
		} finally {
			setBusy(false);
		}
	};

	const manageable = useMemo(
		() => narrators.filter((item) => !isProtected(item)),
		[narrators],
	);
	const allSelected =
		manageable.length > 0 &&
		manageable.every((item) => selectedIds.has(item.id));

	const toggleSelected = (narratorId: string) => {
		const item = narrators.find((candidate) => candidate.id === narratorId);
		if (!item || isProtected(item)) return;
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(narratorId)) next.delete(narratorId);
			else next.add(narratorId);
			return next;
		});
	};

	const toggleAll = () => {
		setSelectedIds(
			allSelected ? new Set() : new Set(manageable.map((item) => item.id)),
		);
	};

	const confirmRename = async () => {
		if (!renameTarget || isProtected(renameTarget)) return;
		const title = renameTitle.trim();
		if (!title) return;
		const ok = await runMutation(
			() => client.renameNarrator(renameTarget.id, title),
			"修改标题失败",
			"标题已更新",
		);
		if (ok) setRenameTarget(null);
	};

	const confirmFork = async () => {
		if (!forkTarget || isProtected(forkTarget)) return;
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const narrator = await client.forkLatestNarrator(forkTarget.id, {
				...(forkTitle.trim() ? { title: forkTitle.trim() } : {}),
				inheritMode: forkMode,
			});
			setForkTarget(null);
			await Promise.all([notifyChanged(), loadNarrators()]);
			setSuccess("Fork 已创建");
			onOpenNarrator(narrator.id);
		} catch (cause) {
			setError(errorMessage(cause, "Fork 叙述者失败"));
		} finally {
			setBusy(false);
		}
	};

	const executeConfirmation = async () => {
		const action = confirmAction;
		if (!action) return;
		setConfirmAction(null);
		if ("narrator" in action && isProtected(action.narrator)) {
			setError("书籍叙述者由写作工作台管理，不能在会话中心执行此操作。");
			return;
		}
		const ids = "narrator" in action ? [action.narrator.id] : [...action.ids];
		const operation =
			action.kind === "archive" || action.kind === "batchArchive"
				? client.archiveNarrator
				: action.kind === "restore" || action.kind === "batchRestore"
					? client.unarchiveNarrator
					: client.deleteNarrator;
		const verb =
			action.kind.includes("Archive") || action.kind === "archive"
				? "归档"
				: action.kind.includes("Restore") || action.kind === "restore"
					? "恢复"
					: "删除";
		await runMutation(
			async () => {
				const results = await Promise.allSettled(
					ids.map((id) => operation(id)),
				);
				const failed = results.filter(
					(result) => result.status === "rejected",
				).length;
				if (failed > 0)
					throw new Error(`${failed} 个叙述者${verb}失败，其余操作已完成`);
				setSelectedIds(
					(current) => new Set([...current].filter((id) => !ids.includes(id))),
				);
			},
			`${verb}叙述者失败`,
			`${ids.length} 个叙述者已${verb}`,
		);
	};

	const selectedCount = selectedIds.size;

	return (
		<section
			className={cn(
				"flex h-full min-h-0 flex-1 flex-col gap-4 overflow-auto p-6",
				className,
			)}
			aria-label="叙述者中心"
		>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold">叙述者中心</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						管理 Runtime
						会话。书籍叙述者由服务端可信绑定保护，只能在写作工作台管理。
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => void loadNarrators()}
						disabled={busy || loading}
						aria-label="刷新叙述者列表"
					>
						<RefreshCw
							data-icon="inline-start"
							className={cn(loading && "animate-spin")}
						/>
						刷新
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => setNewDialogOpen(true)}
						disabled={busy}
					>
						新建叙述者
					</Button>
					<Button
						type="button"
						onClick={() => void continueLatest()}
						disabled={busy}
					>
						继续最近
					</Button>
				</div>
			</header>

			<div className="grid gap-3 rounded-xl border border-border bg-card p-3 md:grid-cols-[1fr_10rem_11rem_12rem]">
				<Field>
					<FieldLabel htmlFor="narrator-search">搜索</FieldLabel>
					<Input
						id="narrator-search"
						aria-label="搜索叙述者"
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						placeholder="标题、模型、目录或书籍"
					/>
				</Field>
				<Field>
					<FieldLabel>状态</FieldLabel>
					<SimpleSelect
						aria-label="叙述者状态"
						value={status}
						onValueChange={(value) => {
							setStatus(value as SessionCenterStatus);
							setSelectedIds(new Set());
						}}
						options={[...STATUS_OPTIONS]}
					/>
				</Field>
				<Field>
					<FieldLabel>来源</FieldLabel>
					<SimpleSelect
						aria-label="叙述者来源"
						value={scope}
						onValueChange={(value) => {
							setScope(value as SessionCenterScope);
							setSelectedIds(new Set());
						}}
						options={[...SCOPE_OPTIONS]}
					/>
				</Field>
				<Field>
					<FieldLabel>排序</FieldLabel>
					<SimpleSelect
						aria-label="叙述者排序"
						value={sort}
						onValueChange={(value) => setSort(value as SessionCenterSortMode)}
						options={[...SORT_OPTIONS]}
					/>
				</Field>
			</div>

			{error ? (
				<Alert className="border-destructive/30 bg-destructive/10">
					<AlertDescription className="text-destructive">
						{error}
					</AlertDescription>
				</Alert>
			) : null}
			{success ? (
				<Alert className="border-emerald-500/30 bg-emerald-500/10">
					<AlertDescription className="text-emerald-700">
						{success}
					</AlertDescription>
				</Alert>
			) : null}

			{manageable.length > 0 ? (
				<fieldset className="flex flex-wrap items-center gap-2">
					<legend className="sr-only">批量操作</legend>
					<Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
						{allSelected ? "取消全选" : "全选独立叙述者"}
					</Button>
					{selectedCount > 0 ? (
						<span className="text-sm text-muted-foreground">
							已选 {selectedCount} 项
						</span>
					) : null}
					{selectedCount > 0 && status === "active" ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() =>
								setConfirmAction({
									kind: "batchArchive",
									ids: [...selectedIds],
								})
							}
							disabled={busy}
						>
							归档选中项
						</Button>
					) : null}
					{selectedCount > 0 && status === "archived" ? (
						<>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() =>
									setConfirmAction({
										kind: "batchRestore",
										ids: [...selectedIds],
									})
								}
								disabled={busy}
							>
								恢复选中项
							</Button>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								onClick={() =>
									setConfirmAction({
										kind: "batchDelete",
										ids: [...selectedIds],
									})
								}
								disabled={busy}
							>
								删除选中项
							</Button>
						</>
					) : null}
				</fieldset>
			) : null}

			{loading ? (
				<p role="status" className="text-sm text-muted-foreground">
					正在加载 Runtime 叙述者…
				</p>
			) : narrators.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessageSquareText aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{status === "archived" ? "暂无已归档叙述者" : "暂无叙述者"}
						</EmptyTitle>
						<EmptyDescription>
							{status === "archived"
								? "归档后的独立叙述者会显示在这里。"
								: "创建一个独立叙述者开始长期对话。"}
						</EmptyDescription>
					</EmptyHeader>
					{status === "active" ? (
						<Button onClick={() => setNewDialogOpen(true)}>新建叙述者</Button>
					) : null}
				</Empty>
			) : (
				<div className="grid gap-3 xl:grid-cols-2">
					{narrators.map((narrator) => {
						const protectedNarrator = isProtected(narrator);
						return (
							<Card
								key={narrator.id}
								data-testid={`session-center-row-${narrator.id}`}
							>
								<CardHeader className="gap-2">
									<div className="flex items-start gap-2">
										{!protectedNarrator ? (
											<input
												type="checkbox"
												aria-label={`选择 ${narrator.title}`}
												className="mt-1 size-4 shrink-0"
												checked={selectedIds.has(narrator.id)}
												onChange={() => toggleSelected(narrator.id)}
											/>
										) : (
											<ShieldCheck
												className="mt-1 size-4 shrink-0 text-emerald-600"
												aria-label="书籍叙述者受保护"
											/>
										)}
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<CardTitle className="truncate text-base">
													{narrator.title}
												</CardTitle>
												<Badge
													variant={
														narrator.status === "archived"
															? "outline"
															: narrator.working
																? "default"
																: "secondary"
													}
												>
													{runtimeStatusLabel(narrator)}
												</Badge>
												{protectedNarrator ? (
													<Badge variant="outline">书籍叙述者·受保护</Badge>
												) : null}
												{narrator.planMode ? (
													<Badge variant="outline">Plan</Badge>
												) : null}
												{narrator.pinned ? (
													<Badge variant="outline">已固定</Badge>
												) : null}
												{narrator.substatus.map((value) => (
													<Badge key={value} variant="outline">
														{substatusLabel(value)}
													</Badge>
												))}
											</div>
										</div>
									</div>
								</CardHeader>
								<CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
									<div className="grid gap-1 sm:grid-cols-2">
										<span>模型：{narrator.model || "跟随默认"}</span>
										<span>推理：{narrator.reasoningEffort ?? "默认"}</span>
										<span>
											权限：{PERMISSION_LABELS[narrator.permissionMode]}
										</span>
										<span>消息：{narrator.messageCount}</span>
										<span className="inline-flex items-center gap-1">
											<Terminal aria-hidden="true" className="size-3" />
											终端：{narrator.activeTerminalCount}
										</span>
										<span className="inline-flex items-center gap-1">
											<Box aria-hidden="true" className="size-3" />
											容器：{narrator.runningContainerCount}/
											{narrator.containerCount}
										</span>
										<span className="inline-flex items-center gap-1">
											<Users aria-hidden="true" className="size-3" />
											在线查看者：{narrator.viewers.length}
										</span>
									</div>
									{narrator.binding?.kind === "novel.book" ? (
										<p className="truncate">
											绑定书籍：{narrator.binding.bookId}
										</p>
									) : null}
									<p className="truncate">工作目录：{narrator.cwd ?? "默认"}</p>
									<div className="flex flex-wrap gap-x-4 gap-y-1">
										<span>最后消息：{formatDate(narrator.lastMessageAt)}</span>
										<span>最近更新：{formatDate(narrator.updatedAt)}</span>
									</div>
									{narrator.errorMessage ? (
										<p className="text-destructive">
											最近错误：{narrator.errorMessage}
										</p>
									) : null}
								</CardContent>
								<CardFooter className="flex flex-wrap justify-end gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => void openNarrator(narrator)}
										disabled={busy}
									>
										打开
									</Button>
									{!protectedNarrator ? (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => {
												setRenameTarget(narrator);
												setRenameTitle(narrator.title);
											}}
											disabled={busy}
										>
											重命名
										</Button>
									) : null}
									{!protectedNarrator && status === "active" ? (
										<>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() =>
													void runMutation(
														() =>
															client.setNarratorPinned(
																narrator,
																!narrator.pinned,
															),
														narrator.pinned ? "取消固定失败" : "固定叙述者失败",
														narrator.pinned ? "已取消固定" : "叙述者已固定",
													)
												}
												disabled={busy}
											>
												{narrator.pinned ? (
													<PinOff data-icon="inline-start" />
												) : (
													<Pin data-icon="inline-start" />
												)}
												{narrator.pinned ? "取消固定" : "固定"}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => {
													setForkTarget(narrator);
													setForkTitle(`${narrator.title} Fork`);
													setForkMode("full");
												}}
												disabled={busy}
											>
												Fork
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													setConfirmAction({ kind: "archive", narrator })
												}
												disabled={busy}
											>
												归档
											</Button>
										</>
									) : null}
									{!protectedNarrator && status === "archived" ? (
										<>
											<Button
												type="button"
												size="sm"
												onClick={() =>
													setConfirmAction({ kind: "restore", narrator })
												}
												disabled={busy}
											>
												恢复
											</Button>
											<Button
												type="button"
												size="sm"
												variant="destructive"
												onClick={() =>
													setConfirmAction({ kind: "delete", narrator })
												}
												disabled={busy}
											>
												永久删除
											</Button>
										</>
									) : null}
								</CardFooter>
							</Card>
						);
					})}
				</div>
			)}

			<NewSessionDialog
				open={newDialogOpen}
				onOpenChange={setNewDialogOpen}
				onCreate={createNarrator}
				busy={busy}
			/>

			<Dialog
				open={renameTarget !== null}
				onOpenChange={(open) => {
					if (!open) setRenameTarget(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>重命名叙述者</DialogTitle>
						<DialogDescription>
							标题会同步到 Runtime 和最近叙述者列表。
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="rename-narrator-title">标题</FieldLabel>
							<Input
								id="rename-narrator-title"
								aria-label="新标题"
								value={renameTitle}
								onChange={(event) => setRenameTitle(event.currentTarget.value)}
							/>
						</Field>
					</FieldGroup>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setRenameTarget(null)}
							disabled={busy}
						>
							取消
						</Button>
						<Button
							onClick={() => void confirmRename()}
							disabled={busy || !renameTitle.trim()}
						>
							保存
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={forkTarget !== null}
				onOpenChange={(open) => {
					if (!open) setForkTarget(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Fork 叙述者</DialogTitle>
						<DialogDescription>
							从独立叙述者最新可分叉消息创建 Runtime 原生分支。
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="fork-narrator-title">新标题</FieldLabel>
							<Input
								id="fork-narrator-title"
								aria-label="Fork 标题"
								value={forkTitle}
								onChange={(event) => setForkTitle(event.currentTarget.value)}
							/>
						</Field>
						<Field>
							<FieldLabel>继承模式</FieldLabel>
							<SimpleSelect
								aria-label="Fork 继承模式"
								value={forkMode}
								onValueChange={(value) =>
									setForkMode(value as RuntimeForkInheritMode)
								}
								options={[...FORK_OPTIONS]}
							/>
						</Field>
					</FieldGroup>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setForkTarget(null)}
							disabled={busy}
						>
							取消
						</Button>
						<Button onClick={() => void confirmFork()} disabled={busy}>
							创建 Fork
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={confirmAction !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmAction(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{confirmAction
								? confirmationText(confirmAction).title
								: "确认操作"}
						</DialogTitle>
						<DialogDescription>
							{confirmAction ? confirmationText(confirmAction).description : ""}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmAction(null)}
							disabled={busy}
						>
							取消
						</Button>
						<Button
							variant={
								confirmAction?.kind.includes("delete") ||
								confirmAction?.kind === "delete"
									? "destructive"
									: "default"
							}
							onClick={() => void executeConfirmation()}
							disabled={busy}
						>
							{confirmAction ? confirmationText(confirmAction).confirm : "确认"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
