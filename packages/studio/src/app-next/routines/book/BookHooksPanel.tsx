import { ChevronDown, ChevronUp, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { normalizeUrlProtocol } from "../../lib/url-protocol";
import type { HookEvent, HookProxyMode, HookType } from "../../runtime-admin";
import { createRuntimeProductClient, type RuntimeBookHook } from "../../runtime/product-contract";
import { DeleteConfirmDialog, ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "../routines-shared";

const productClient = createRuntimeProductClient();

interface HookFormState {
	event: HookEvent;
	matcher: string;
	type: HookType;
	command: string;
	url: string;
	headers: string;
	proxyMode: HookProxyMode;
	proxyUrl: string;
	timeout: string;
	enabled: boolean;
	sortOrder: string;
}

const EMPTY_HOOK_FORM: HookFormState = {
	event: "PreToolUse",
	matcher: "",
	type: "command",
	command: "",
	url: "",
	headers: "",
	proxyMode: "default",
	proxyUrl: "",
	timeout: "30",
	enabled: true,
	sortOrder: "0",
};

const HOOK_EVENTS: readonly HookEvent[] = [
	"PreToolUse",
	"PostToolUse",
	"Stop",
	"Attention",
	"AttentionResolved",
];

/**
 * Attention 系事件的 matcher 不是工具名，而是固定的 reason 枚举。
 * 与 Runtime `server/services/hook-service.ts` 的 `AttentionReason` 对齐。
 */
const ATTENTION_EVENTS: ReadonlySet<HookEvent> = new Set(["Attention", "AttentionResolved"]);
const ATTENTION_REASONS_BY_EVENT: Record<string, readonly string[]> = {
	// Attention 三种原因都可能触发。
	Attention: ["waiting_permission", "done", "error"],
	// 当前 scope：AttentionResolved 只在权限请求被解除时触发。
	AttentionResolved: ["waiting_permission"],
};

const ATTENTION_REASON_LABELS: Record<string, string> = {
	waiting_permission: "等待授权",
	done: "应答完成",
	error: "出错",
};

const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
	PreToolUse: "工具执行前",
	PostToolUse: "工具执行后",
	Stop: "应答结束时",
	Attention: "需要关注时",
	AttentionResolved: "关注解除时",
};

/** 所有事件通用的载荷字段。与原生 `HOOK_COMMON_FIELDS` 逐字对齐。 */
const HOOK_COMMON_FIELDS: ReadonlyArray<readonly [string, string]> = [
	["hook_event_name", "事件名称（PreToolUse / PostToolUse / Stop / Attention / AttentionResolved）"],
	["narrator_id", "叙述者 ID"],
	["narrator_title", "叙述者标题（标题生成前可能为空）"],
	["chapter_id", "章节 ID（独立叙述者可能为空）"],
	["project_id", "项目 ID（全局叙述者可能为空）"],
	["cwd", "工作目录"],
];

/** 各事件的额外载荷字段。与原生 `HOOK_EVENT_FIELDS` 逐字对齐。 */
const HOOK_EVENT_FIELDS: Record<string, ReadonlyArray<readonly [string, string]>> = {
	PreToolUse: [
		["tool_name", "工具名称"],
		["tool_input", "工具入参（可能被截断）"],
		["tool_use_id", "工具调用 ID"],
	],
	PostToolUse: [
		["tool_name", "工具名称"],
		["tool_input", "工具入参（可能被截断）"],
		["tool_use_id", "工具调用 ID"],
		["tool_output", "工具输出（截断至 2000 字符）"],
		["tool_is_error", "工具是否出错"],
	],
	Stop: [
		["stop_reason", "结束原因（done / error / aborted / max_turns）"],
		["stop_error", "是否以错误结束"],
		["last_assistant_text", "最后一条助手消息文本（截断）"],
		["duration_ms", "本轮总耗时（毫秒）"],
		["total_tokens", "本轮消耗 token 量（非缓存输入 + 输出）"],
	],
	Attention: [
		["attention_reason", "关注原因（waiting_permission / done / error）"],
		["attention_detail", "附加上下文"],
	],
	AttentionResolved: [
		["attention_reason", "关注原因（waiting_permission / done / error）"],
		["attention_detail", '附加上下文（如权限解除时用户的决定 "allow" / "deny"）'],
	],
};

/** 与原生 `buildHookExample` 逐字对齐的示例载荷。 */
function buildHookExample(event: HookEvent): string {
	const base: Record<string, unknown> = {
		hook_event_name: event,
		narrator_id: "n_abc123",
		narrator_title: "Refactor auth flow",
		chapter_id: "c_def456",
		project_id: "p_ghi789",
		cwd: "/home/user/project/.worktrees/feature",
	};
	if (event === "PreToolUse") {
		base.tool_name = "Bash";
		base.tool_input = { command: "ls -la", description: "List files" };
		base.tool_use_id = "toolu_xyz";
	} else if (event === "PostToolUse") {
		base.tool_name = "Bash";
		base.tool_input = { command: "ls -la" };
		base.tool_use_id = "toolu_xyz";
		base.tool_output = "total 24\ndrwxr-xr-x ...";
		base.tool_is_error = false;
	} else if (event === "Stop") {
		base.stop_reason = "done";
		base.stop_error = false;
		base.last_assistant_text = "Done. I've updated the file.";
		base.duration_ms = 12345;
		base.total_tokens = 8192;
	} else if (event === "Attention") {
		base.attention_reason = "waiting_permission";
	} else if (event === "AttentionResolved") {
		base.attention_reason = "waiting_permission";
		base.attention_detail = "allow";
	}
	return JSON.stringify(base, null, 2);
}

function parseRecord(
	value: string,
): Readonly<Record<string, string>> | undefined {
	if (!value.trim()) return undefined;
	const parsed = JSON.parse(value) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("请求头必须是 JSON 对象。");
	}
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(parsed)) {
		if (typeof item !== "string") throw new Error("请求头的值必须是字符串。");
		result[key] = item;
	}
	return result;
}

function hookTypeLabel(type: HookType): string {
	return type === "command" ? "命令" : "HTTP";
}

/** Attention 系事件的 matcher 是原因枚举，直接显示英文 key 作者看不懂；其余事件的 matcher 是工具名。 */
function hookMatcherLabel(hook: { readonly event: HookEvent; readonly matcher: string }): string {
	if (!hook.matcher) return "匹配所有事件";
	if (ATTENTION_EVENTS.has(hook.event)) return `原因：${ATTENTION_REASON_LABELS[hook.matcher] ?? hook.matcher}`;
	return hook.matcher;
}

function proxyModeLabel(mode: HookProxyMode): string {
	if (mode === "default") return "默认";
	if (mode === "direct") return "直连";
	if (mode === "system") return "系统代理";
	return "自定义";
}

function hookToForm(hook: RuntimeBookHook): HookFormState {
	return {
		event: hook.event,
		matcher: hook.matcher,
		type: hook.type,
		command: hook.command ?? "",
		url: hook.url ?? "",
		headers: hook.headers ? JSON.stringify(hook.headers, null, 2) : "",
		proxyMode: hook.proxyMode ?? "default",
		proxyUrl: hook.proxyUrl ?? "",
		timeout: String(hook.timeout),
		enabled: hook.enabled,
		sortOrder: String(hook.sortOrder),
	};
}

/**
 * 本书钩子：只在这本书的叙述者里触发。只发送书籍标识，服务端校验绑定后注入 Runtime 项目标识。
 * 全局钩子在 Runtime 原页（通用套路 › 钩子）。
 */
export function BookHooksPanel({ bookId, bookTitle }: { readonly bookId: string; readonly bookTitle: string }) {
	const [hooks, setHooks] = useState<readonly RuntimeBookHook[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; id: string } | null>(null);
	const [form, setForm] = useState<HookFormState>(EMPTY_HOOK_FORM);
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setHooks(await productClient.listBookHooks(bookId));
		} catch (loadError) {
			setError(errorMessage(loadError, "钩子管理"));
		} finally {
			setLoading(false);
		}
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	// 换书即换可信作用域：丢掉上一本书的编辑框与删除确认。
	useEffect(() => {
		setEditor(null);
		setForm(EMPTY_HOOK_FORM);
		setDeleteId(null);
		setPendingId(null);
	}, [bookId]);

	async function saveHook() {
		if (!editor) return;
		setPendingId(editor.mode === "edit" ? editor.id : "create");
		setError(null);
		try {
			const headers = parseRecord(form.headers);
			// Runtime 的 zod 校验是 z.string().url()，裸主机名（example.com/hook）会被 400；提交前补全协议。
			const normalizedUrl = normalizeUrlProtocol(form.url) ?? form.url.trim();
			const common = {
				event: form.event,
				matcher: form.matcher,
				headers,
				proxyMode: form.proxyMode,
				proxyUrl: form.proxyMode === "custom" ? form.proxyUrl.trim() : undefined,
				timeout: Number(form.timeout) || 30,
				enabled: form.enabled,
				sortOrder: Number(form.sortOrder) || 0,
			};
			if (editor.mode === "create") {
				await productClient.createBookHook(
					bookId,
					form.type === "command"
						? { ...common, type: "command" as const, command: form.command.trim() }
						: { ...common, type: "http" as const, url: normalizedUrl },
				);
			} else {
				await productClient.updateBookHook(
					bookId,
					editor.id,
					form.type === "command"
						? { ...common, type: "command" as const, command: form.command.trim(), url: null }
						: { ...common, type: "http" as const, url: normalizedUrl, command: null },
				);
			}
			setEditor(null);
			setForm(EMPTY_HOOK_FORM);
			await load();
		} catch (saveError) {
			setError(errorMessage(saveError, "钩子管理"));
		} finally {
			setPendingId(null);
		}
	}

	async function toggleHook(hook: RuntimeBookHook, enabled: boolean) {
		setPendingId(hook.id);
		setError(null);
		try {
			await productClient.updateBookHook(bookId, hook.id, { enabled });
			await load();
		} catch (toggleError) {
			setError(errorMessage(toggleError, "钩子管理"));
		} finally {
			setPendingId(null);
		}
	}

	async function deleteHook() {
		if (!deleteId) return;
		setPendingId(deleteId);
		setError(null);
		try {
			await productClient.deleteBookHook(bookId, deleteId);
			setDeleteId(null);
			await load();
		} catch (deleteError) {
			setError(errorMessage(deleteError, "钩子管理"));
		} finally {
			setPendingId(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="本书钩子"
				description={`只在《${bookTitle}》的叙述者里触发，与「通用套路 › 钩子」里的全局钩子一起生效。钩子管理需要 Runtime 管理员权限。`}
				action={
					<Button
						type="button"
						size="sm"
						onClick={() => {
							setForm(EMPTY_HOOK_FORM);
							setEditor({ mode: "create" });
						}}
					>
						<Plus data-icon="inline-start" />
						创建钩子
					</Button>
				}
			/>
			{error && <ErrorAlert title="本书钩子请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : hooks.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ShieldAlert />
						</EmptyMedia>
						<EmptyTitle>这本书还没有钩子</EmptyTitle>
						<EmptyDescription>例如：工具执行后跑一遍校对脚本，或应答结束时发通知。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{hooks.map((hook) => (
						<Card key={hook.id}>
							<CardHeader>
								<CardTitle>{HOOK_EVENT_LABELS[hook.event] ?? hook.event}</CardTitle>
								<CardDescription>{hookMatcherLabel(hook)}</CardDescription>
								<CardAction>
									<Switch
										aria-label={`启用钩子：${hook.id}`}
										checked={hook.enabled}
										disabled={pendingId === hook.id}
										onCheckedChange={(enabled) => void toggleHook(hook, enabled)}
									/>
								</CardAction>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="flex flex-wrap gap-2">
									<Badge variant="outline" className="font-mono">
										{hook.event}
									</Badge>
									<Badge variant="secondary">{hookTypeLabel(hook.type)}</Badge>
									<Badge variant="outline">超时 {hook.timeout}s</Badge>
									<Badge variant="outline">顺序 {hook.sortOrder}</Badge>
								</div>
								<code className="break-all rounded-lg bg-muted p-3 text-xs">
									{hook.type === "command" ? hook.command : hook.url}
								</code>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => {
											setForm(hookToForm(hook));
											setEditor({ mode: "edit", id: hook.id });
										}}
									>
										<Pencil data-icon="inline-start" />
										编辑
									</Button>
									<Button type="button" variant="destructive" size="sm" onClick={() => setDeleteId(hook.id)}>
										<Trash2 data-icon="inline-start" />
										删除
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<HookEditorDialog
				open={editor !== null}
				mode={editor?.mode ?? "create"}
				form={form}
				saving={editor !== null && pendingId !== null}
				onFormChange={setForm}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
						setForm(EMPTY_HOOK_FORM);
					}
				}}
				onSave={() => void saveHook()}
			/>
			<DeleteConfirmDialog
				open={deleteId !== null}
				title="删除本书钩子"
				description={`确定从《${bookTitle}》删除这个钩子吗？`}
				deleting={deleteId !== null && pendingId === deleteId}
				onOpenChange={(open) => {
					if (!open) setDeleteId(null);
				}}
				onConfirm={() => void deleteHook()}
			/>
		</div>
	);
}

function HookPayloadReference({
	event,
	type,
}: {
	readonly event: HookEvent;
	readonly type: HookType;
}) {
	const [opened, setOpened] = useState(false);
	const eventFields = HOOK_EVENT_FIELDS[event] ?? [];
	return (
		<div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
			<p className="text-muted-foreground">
				{type === "http"
					? `钩子触发时，会向该 URL 发送 POST 请求，请求体为下方 JSON，Content-Type 为 application/json。返回 2xx 即放行；工具执行前事件可返回 {"decision": "block", "reason": "..."} 阻断工具执行。`
					: "钩子触发时，会以 JSON 形式通过标准输入 (stdin) 把下方数据传给命令。命令工作目录为叙述者的 cwd。退出码 0 = 放行；工具执行前事件可用退出码 2 阻断工具执行，并把 stderr（或 stdout）作为阻断原因。"}
			</p>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className="w-fit"
				onClick={() => setOpened((value) => !value)}
			>
				{opened ? (
					<ChevronUp className="mr-1 size-3" />
				) : (
					<ChevronDown className="mr-1 size-3" />
				)}
				查看传入字段与示例
			</Button>
			{opened && (
				<div className="flex flex-col gap-3 border-t pt-3">
					<div className="flex flex-col gap-1">
						<div className="font-medium text-muted-foreground">
							通用字段（所有事件）
						</div>
						{HOOK_COMMON_FIELDS.map(([field, description]) => (
							<div key={field} className="flex flex-col gap-0.5">
								<code className="font-mono text-2xs">{field}</code>
								<span className="text-muted-foreground">{description}</span>
							</div>
						))}
					</div>
					{eventFields.length > 0 && (
						<div className="flex flex-col gap-1">
							<div className="font-medium text-muted-foreground">
								本事件额外字段
							</div>
							{eventFields.map(([field, description]) => (
								<div key={field} className="flex flex-col gap-0.5">
									<code className="font-mono text-2xs">{field}</code>
									<span className="text-muted-foreground">{description}</span>
								</div>
							))}
						</div>
					)}
					<div className="flex flex-col gap-1">
						<div className="font-medium text-muted-foreground">示例载荷</div>
						<pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-2xs">
							{buildHookExample(event)}
						</pre>
					</div>
				</div>
			)}
		</div>
	);
}

function HookEditorDialog({
	open,
	mode,
	form,
	saving,
	onFormChange,
	onOpenChange,
	onSave,
}: {
	readonly open: boolean;
	readonly mode: "create" | "edit";
	readonly form: HookFormState;
	readonly saving: boolean;
	readonly onFormChange: (form: HookFormState) => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onSave: () => void;
}) {
	const validTarget =
		form.type === "command" ? form.command.trim() : form.url.trim();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "创建钩子" : "编辑钩子"}
					</DialogTitle>
					<DialogDescription>
						配置准确的 Runtime 钩子事件以及命令或 HTTP 目标。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-2">
							<Label>事件</Label>
							<SimpleSelect
								aria-label="钩子事件"
								value={form.event}
								onValueChange={(value) => {
									// 切换事件时 matcher 语义会变：Attention 系是 reason 枚举，
									// Stop 不绑定工具。沿用旧值会让作者以为匹配仍然生效。
									const nextEvent = value as HookEvent;
									let matcher = form.matcher;
									if (nextEvent === "Stop") {
										matcher = "";
									} else if (ATTENTION_EVENTS.has(nextEvent)) {
										const valid = ATTENTION_REASONS_BY_EVENT[nextEvent] ?? [];
										if (matcher && !valid.includes(matcher)) matcher = "";
									} else if (ATTENTION_EVENTS.has(form.event)) {
										matcher = "";
									}
									onFormChange({ ...form, event: nextEvent, matcher });
								}}
								options={HOOK_EVENTS.map((event) => ({
									value: event,
									label: `${HOOK_EVENT_LABELS[event]} · ${event}`,
								}))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>类型</Label>
							<SimpleSelect
								aria-label="钩子类型"
								value={form.type}
								onValueChange={(value) =>
									onFormChange({ ...form, type: value as HookType })
								}
								options={[
									{ value: "command", label: "命令" },
									{ value: "http", label: "HTTP" },
								]}
							/>
						</div>
					</div>
					{ATTENTION_EVENTS.has(form.event) ? (
						<div className="flex flex-col gap-2">
							<Label>关注原因</Label>
							<SimpleSelect
								aria-label="钩子关注原因"
								value={form.matcher || "__all__"}
								onValueChange={(value) =>
									onFormChange({
										...form,
										matcher: value === "__all__" ? "" : value,
									})
								}
								options={[
									{ value: "__all__", label: "全部原因" },
									...(ATTENTION_REASONS_BY_EVENT[form.event] ?? []).map(
										(reason) => ({
											value: reason,
											label: ATTENTION_REASON_LABELS[reason] ?? reason,
										}),
									),
								]}
							/>
						</div>
					) : (
						form.event !== "Stop" && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="hook-matcher">匹配器</Label>
								<Input
									id="hook-matcher"
									value={form.matcher}
									onChange={(event) =>
										onFormChange({ ...form, matcher: event.target.value })
									}
									placeholder="例如 Bash（留空 = 匹配全部）"
								/>
							</div>
						)
					)}
					<HookPayloadReference event={form.event} type={form.type} />
					{form.type === "command" ? (
						<div className="flex flex-col gap-2">
							<Label htmlFor="hook-command">命令</Label>
							<Textarea
								id="hook-command"
								className="min-h-28 font-mono"
								value={form.command}
								onChange={(event) =>
									onFormChange({ ...form, command: event.target.value })
								}
							/>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<Label htmlFor="hook-url">URL</Label>
							<Input
								id="hook-url"
								value={form.url}
								onChange={(event) =>
									onFormChange({ ...form, url: event.target.value })
								}
								placeholder="https://example.com/hook"
							/>
						</div>
					)}
					{form.type === "http" && (
						<>
							<div className="flex flex-col gap-2">
								<Label htmlFor="hook-headers">请求头 JSON</Label>
								<Textarea
									id="hook-headers"
									className="min-h-24 font-mono"
									value={form.headers}
									onChange={(event) =>
										onFormChange({ ...form, headers: event.target.value })
									}
									placeholder='{"Authorization":"Bearer …"}'
								/>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="flex flex-col gap-2">
									<Label>代理模式</Label>
									<SimpleSelect
										aria-label="代理模式"
										value={form.proxyMode}
										onValueChange={(value) =>
											onFormChange({
												...form,
												proxyMode: value as HookProxyMode,
											})
										}
										options={["default", "direct", "system", "custom"].map(
											(value) => ({
												value,
												label: proxyModeLabel(value as HookProxyMode),
											}),
										)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="hook-proxy-url">自定义代理 URL</Label>
									<Input
										id="hook-proxy-url"
										disabled={form.proxyMode !== "custom"}
										value={form.proxyUrl}
										onChange={(event) =>
											onFormChange({ ...form, proxyUrl: event.target.value })
										}
									/>
								</div>
							</div>
						</>
					)}
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="flex flex-col gap-2">
							<Label htmlFor="hook-timeout">超时秒数</Label>
							<Input
								id="hook-timeout"
								type="number"
								min="1"
								max="600"
								value={form.timeout}
								onChange={(event) =>
									onFormChange({ ...form, timeout: event.target.value })
								}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="hook-order">排序顺序</Label>
							<Input
								id="hook-order"
								type="number"
								value={form.sortOrder}
								onChange={(event) =>
									onFormChange({ ...form, sortOrder: event.target.value })
								}
							/>
						</div>
						<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
							<Label>已启用</Label>
							<Switch
								aria-label="钩子已启用"
								checked={form.enabled}
								onCheckedChange={(enabled) =>
									onFormChange({ ...form, enabled })
								}
							/>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						取消
					</Button>
					<Button
						type="button"
						disabled={saving || !validTarget}
						onClick={onSave}
					>
						{saving ? "保存中…" : mode === "create" ? "创建" : "保存修改"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
