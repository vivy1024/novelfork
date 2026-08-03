import { invalidateNarratorCommands } from "../runtime/narrator-command-cache";
import {
	Bot,
	Boxes,
	Braces,
	ChevronDown,
	ChevronUp,
	Command,
	Eye,
	FileCode,
	FileText,
	FolderTree,
	Pencil,
	PenLine,
	Plus,
	RefreshCw,
	Settings2,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Trash2,
	Workflow,
	Wrench,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	createRuntimeProductClient,
	type RuntimeBookHook,
	type RuntimeBookSkill,
	type RuntimeBookSkillSummary,
} from "../runtime/product-contract";
import {
	type CustomSubagent,
	type CustomSubagentInput,
	type CustomSubagentToolAccess,
	createAccountProfileClient,
	createCustomSubagentsClient,
	createHooksClient,
	createRoutinesClient,
	createSkillsClient,
	type HookEvent,
	type HookProxyMode,
	type HookType,
	type ProjectRoutineAction,
	type ProjectRoutineStatus,
	type RoutineStatus,
	type RuntimeHook,
	type Skill,
	type SkillInput,
	type SkillSummary,
} from "../runtime-admin";
import { getPluginUISections } from "../plugin-ui/register-plugins";
import { getPluginSection } from "../plugin-ui/section-registry";
import { CommandsSection } from "./CommandsSection";
import { MCPServerPanel } from "./MCPServerPanel";
import { RulesSection } from "./RulesSection";
import { ToolPermissionsSection } from "./ToolPermissionsSection";

const routinesClient = createRoutinesClient();
const accountClient = createAccountProfileClient();
const skillsClient = createSkillsClient();
const subagentsClient = createCustomSubagentsClient();
const hooksClient = createHooksClient();
const productClient = createRuntimeProductClient();

export interface RoutinesNextPageProps {
	readonly bookId?: string;
	readonly bookTitle?: string;
}

type SectionId =
	| "builtIn"
	| "commands"
	| "optionalTools"
	| "permissions"
	| "globalSkills"
	| "projectSkills"
	| "subagents"
	| "mcp"
	| "rules"
	| "hooks"
	// 插件贡献的 section（如小说插件的「写作配置」）用 componentKey 作 id。
	| (string & {});

const BUILTIN_ROUTINE_TYPES = ["command", "skill"] as const;
const OPTIONAL_TOOL_TYPES = ["tool"] as const;

const SECTIONS: ReadonlyArray<{
	readonly id: SectionId;
	readonly label: string;
	readonly icon: typeof Workflow;
}> = [
	{ id: "builtIn", label: "内置套路", icon: Workflow },
	{ id: "commands", label: "自定义命令", icon: Command },
	{ id: "optionalTools", label: "可选工具", icon: Wrench },
	{ id: "permissions", label: "工具权限", icon: ShieldCheck },
	{ id: "globalSkills", label: "全局技能", icon: Sparkles },
	{ id: "projectSkills", label: "作品技能", icon: Boxes },
	{ id: "subagents", label: "自定义子代理", icon: Bot },
	{ id: "mcp", label: "MCP", icon: Braces },
	{ id: "rules", label: "规则与提示词", icon: FileText },
	{ id: "hooks", label: "Hooks", icon: Settings2 },
];

/**
 * 插件贡献的 section（`mountPoint: "routines"`）。
 *
 * 小说插件的「写作配置」就走这条路 —— 它在 manifest 里声明了 uiSections，
 * 但套路页此前只渲染上面那份硬编码列表，导致声明了却看不到。
 */
function usePluginRoutineSections() {
	return useMemo(() => getPluginUISections("routines"), []);
}

export function RoutinesNextPage({ bookId, bookTitle }: RoutinesNextPageProps) {
	// The current registry contains optional tools only. Start on the section that
	// can render available routines while retaining the built-in tab for future
	// command/skill routines.
	const [activeSection, setActiveSection] = useState<SectionId>("optionalTools");
	const [canManageGlobalRoutines, setCanManageGlobalRoutines] = useState(false);
	const [globalRoutineRoleResolved, setGlobalRoutineRoleResolved] = useState(false);
	const pluginSections = usePluginRoutineSections();

	useEffect(() => {
		let active = true;
		void accountClient.get().then(
			(profile) => {
				if (!active) return;
				setCanManageGlobalRoutines(profile.role === "admin");
				setGlobalRoutineRoleResolved(true);
			},
			() => {
				if (!active) return;
				// A failed role lookup must not leave a global mutator enabled.
				setCanManageGlobalRoutines(false);
				setGlobalRoutineRoleResolved(true);
			},
		);
		return () => {
			active = false;
		};
	}, []);

	return (
		<section aria-label="套路" className="flex h-full min-h-0 w-full flex-col">
			<header className="flex shrink-0 flex-col gap-4 border-b bg-background px-4 py-4">
				<div>
					<h1 className="text-xl font-semibold">套路</h1>
					<p className="text-sm text-muted-foreground">
						管理写作套路、自定义命令、技能、子代理、MCP 服务器、规则和钩子。
					</p>
				</div>
				<div
					role="tablist"
					aria-label="套路分区"
					className="flex flex-wrap gap-1"
				>
					{SECTIONS.map((section) => {
						const Icon = section.icon;
						const selected = section.id === activeSection;
						return (
							<Button
								key={section.id}
								type="button"
								role="tab"
								aria-selected={selected}
								variant={selected ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setActiveSection(section.id)}
							>
								<Icon data-icon="inline-start" />
								{section.label}
							</Button>
						);
					})}
					{pluginSections.map((section) => {
						const selected = section.componentKey === activeSection;
						return (
							<Button
								key={section.componentKey}
								type="button"
								role="tab"
								aria-selected={selected}
								variant={selected ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setActiveSection(section.componentKey)}
							>
								<PenLine data-icon="inline-start" />
								{section.label}
							</Button>
						);
					})}
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
				{pluginSections.map((section) => {
					if (section.componentKey !== activeSection) return null;
					const Component = getPluginSection(section.componentKey);
					if (!Component) {
						return (
							<p key={section.componentKey} className="text-sm text-muted-foreground">
								插件区块 {section.label} 未注册渲染组件。
							</p>
						);
					}
					if (section.requiresBook && !bookId) {
						return (
							<p key={section.componentKey} className="text-sm text-muted-foreground">
								请先在左侧选择一部作品，再打开「{section.label}」。
							</p>
						);
					}
					return (
						<Suspense
							key={section.componentKey}
							fallback={<p className="text-sm text-muted-foreground">加载中…</p>}
						>
							<Component bookId={bookId} />
						</Suspense>
					);
				})}
				{activeSection === "builtIn" && (
					<RoutineCatalogSection
						bookId={bookId}
						bookTitle={bookTitle}
						canManageGlobalRoutines={canManageGlobalRoutines}
						globalRoutineRoleResolved={globalRoutineRoleResolved}
						types={BUILTIN_ROUTINE_TYPES}
						title="内置套路"
						description="管理 Runtime 预置命令与技能套路，并为当前作品设置安全的书籍级 override。"
						emptyIcon={Workflow}
					/>
				)}
				{activeSection === "commands" && <CommandsSection />}
				{activeSection === "optionalTools" && (
					<RoutineCatalogSection
						bookId={bookId}
						bookTitle={bookTitle}
						canManageGlobalRoutines={canManageGlobalRoutines}
						globalRoutineRoleResolved={globalRoutineRoleResolved}
						types={OPTIONAL_TOOL_TYPES}
						title="可选工具"
						description="控制 Terminal、Browser 等可选工具的全局状态与当前作品 override。核心工具默认可用（会话详情可禁用）。改开关后请新开或重建叙述者会话；会话内也可用 /load、/unload。"
						emptyIcon={Wrench}
					/>
				)}
				{activeSection === "permissions" && <ToolPermissionsSection />}
				{activeSection === "globalSkills" && <SkillsSection scope="global" />}
				{activeSection === "projectSkills" && (
					<SkillsSection scope="book" bookId={bookId} bookTitle={bookTitle} />
				)}
				{activeSection === "subagents" && <CustomSubagentsSection />}
				{activeSection === "mcp" && (
					<MCPServerPanel bookId={bookId} bookTitle={bookTitle} />
				)}
				{activeSection === "rules" && (
					<RulesSection bookId={bookId} bookTitle={bookTitle} />
				)}
				{activeSection === "hooks" && (
					<HooksSection bookId={bookId} bookTitle={bookTitle} />
				)}
			</div>
		</section>
	);
}

function errorMessage(error: unknown, adminOnly = false): string {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? Number((error as { status?: unknown }).status)
			: undefined;
	const message = error instanceof Error ? error.message : String(error);
	if (adminOnly && status === 403) {
		return `403 禁止访问 — 钩子管理需要 Runtime 管理员权限。${message}`;
	}
	return status ? `${status} — ${message}` : message;
}

function requireBookId(bookId?: string): string {
	if (!bookId) throw new Error("请先选择作品。");
	return bookId;
}

function ErrorAlert({
	message,
	title = "Runtime 请求失败",
}: {
	readonly message: string;
	readonly title?: string;
}) {
	return (
		<Alert>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

function LoadingCards() {
	return (
		<div className="grid gap-3 md:grid-cols-2">
			{[0, 1, 2, 3].map((item) => (
				<Card key={item}>
					<CardHeader>
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-full" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-8 w-full" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function SectionHeading({
	title,
	description,
	action,
}: {
	readonly title: string;
	readonly description: string;
	readonly action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h2 className="text-lg font-semibold">{title}</h2>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{action}
		</div>
	);
}

function RoutineCatalogSection({
	bookId,
	bookTitle,
	canManageGlobalRoutines,
	globalRoutineRoleResolved,
	types,
	title,
	description,
	emptyIcon: EmptyIcon,
}: {
	readonly bookId?: string;
	readonly bookTitle?: string;
	readonly canManageGlobalRoutines: boolean;
	readonly globalRoutineRoleResolved: boolean;
	readonly types: readonly RoutineStatus["type"][];
	readonly title: string;
	readonly description: string;
	readonly emptyIcon: typeof Workflow;
}) {
	const [globalRoutines, setGlobalRoutines] = useState<
		readonly RoutineStatus[]
	>([]);
	const [projectRoutines, setProjectRoutines] = useState<
		readonly ProjectRoutineStatus[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [globalResult, bookResult] = await Promise.all([
				routinesClient.listGlobal(),
				bookId
					? productClient.listBookRoutines(bookId)
					: Promise.resolve({ routines: [] as const }),
			]);
			setGlobalRoutines(
				globalResult.routines.filter((routine) => types.includes(routine.type)),
			);
			setProjectRoutines(
				bookResult.routines.filter((routine) => types.includes(routine.type)),
			);
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId, types]);

	useEffect(() => {
		void load();
	}, [load]);

	const grouped = useMemo(() => {
		const result = new Map<string, RoutineStatus[]>();
		for (const routine of globalRoutines) {
			const items = result.get(routine.category) ?? [];
			items.push(routine);
			result.set(routine.category, items);
		}
		return [...result.entries()];
	}, [globalRoutines]);

	const projectById = useMemo(
		() => new Map(projectRoutines.map((routine) => [routine.id, routine])),
		[projectRoutines],
	);

	async function toggleGlobal(routine: RoutineStatus, enabled: boolean) {
		if (!canManageGlobalRoutines) return;
		setPendingId(`global:${routine.id}`);
		setError(null);
		try {
			await routinesClient.toggleGlobal(routine.id, enabled);
			await invalidateNarratorCommands();
			await load();
		} catch (toggleError) {
			setError(errorMessage(toggleError));
		} finally {
			setPendingId(null);
		}
	}

	async function toggleBook(
		routine: RoutineStatus,
		action: ProjectRoutineAction,
	) {
		if (!bookId) return;
		setPendingId(`book:${routine.id}`);
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
				title={title}
				description={description}
				action={
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void load()}
						disabled={loading}
					>
						<RefreshCw data-icon="inline-start" />
						刷新
					</Button>
				}
			/>
			{!bookId && (
				<Alert>
					<AlertTitle>未选择作品</AlertTitle>
					<AlertDescription>
						在左侧作品选择器中选择一本书后，可通过书籍绑定网关管理作品级
						override；前端不会接收 Runtime 内部项目标识。
					</AlertDescription>
				</Alert>
			)}
			{globalRoutineRoleResolved && !canManageGlobalRoutines && (
				<Alert>
					<AlertTitle>全局套路需要管理员权限</AlertTitle>
					<AlertDescription>
						你仍可查看全局状态；当前作品的覆盖设置遵循书籍访问权限单独处理。
					</AlertDescription>
				</Alert>
			)}
			{error && <ErrorAlert message={error} />}
			{loading ? (
				<LoadingCards />
			) : globalRoutines.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<EmptyIcon />
						</EmptyMedia>
						<EmptyTitle>暂无{title}</EmptyTitle>
						<EmptyDescription>Runtime 返回了空的套路注册表。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-5">
					{grouped.map(([category, routines]) => (
						<section
							key={category}
							aria-label={category}
							className="flex flex-col gap-2"
						>
							<div className="flex items-center gap-2">
								<h3 className="font-medium">{category}</h3>
								<Badge variant="outline">{routines.length}</Badge>
							</div>
							<div className="grid gap-3 md:grid-cols-2">
								{routines.map((routine) => {
									const projectRoutine = projectById.get(routine.id);
									return (
										<Card key={routine.id}>
											<CardHeader>
												<CardTitle className="flex flex-wrap items-center gap-2">
													{routine.name}
													{routine.type === "tool" && (
														<Badge variant="outline" className="font-mono text-[10px]">
															/load {routine.id}
														</Badge>
													)}
												</CardTitle>
												<CardDescription>
													{routine.descriptionZh || routine.descriptionEn}
												</CardDescription>
												<CardAction>
													<Switch
														aria-label={`切换全局状态：${routine.name}`}
														checked={routine.enabled}
														disabled={
															!canManageGlobalRoutines ||
															pendingId === `global:${routine.id}`
														}
														onCheckedChange={(enabled) =>
															void toggleGlobal(routine, enabled)
														}
													/>
												</CardAction>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<div className="flex flex-wrap items-center gap-2">
													<Badge variant="secondary">
														{routineTypeLabel(routine.type)}
													</Badge>
													<Badge variant="outline">
														全局{routine.enabled ? "已启用" : "已禁用"}
													</Badge>
												</div>
												{routine.type === "tool" && (
													<p className="text-xs text-muted-foreground">
														作品覆盖写入后，需新开或重建叙述者会话才会装入可选工具。
													</p>
												)}
												{bookId && projectRoutine && (
													<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
														<div>
															<div className="text-sm font-medium">
																作品覆盖
															</div>
															<div className="text-xs text-muted-foreground">
																{bookTitle || bookId} · 实际状态：
																{projectRoutine.enabled ? "已启用" : "已禁用"}
															</div>
														</div>
														<fieldset
															className="flex flex-wrap gap-1"
															aria-label={`作品覆盖：${routine.name}`}
														>
															<Button
																type="button"
																size="xs"
																variant={
																	projectRoutine.override === "global"
																		? "secondary"
																		: "outline"
																}
																disabled={pendingId === `book:${routine.id}`}
																aria-label={`使用全局设置：${routine.name}`}
																onClick={() =>
																	void toggleBook(routine, "reset")
																}
															>
																使用全局
															</Button>
															<Button
																type="button"
																size="xs"
																variant={
																	projectRoutine.override === "enabled"
																		? "secondary"
																		: "outline"
																}
																disabled={pendingId === `book:${routine.id}`}
																aria-label={`启用作品套路：${routine.name}`}
																onClick={() =>
																	void toggleBook(routine, "enable")
																}
															>
																已启用
															</Button>
															<Button
																type="button"
																size="xs"
																variant={
																	projectRoutine.override === "disabled"
																		? "secondary"
																		: "outline"
																}
																disabled={pendingId === `book:${routine.id}`}
																aria-label={`禁用作品套路：${routine.name}`}
																onClick={() =>
																	void toggleBook(routine, "disable")
																}
															>
																已禁用
															</Button>
														</fieldset>
													</div>
												)}
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

function routineTypeLabel(type: RoutineStatus["type"]): string {
	if (type === "command") return "命令";
	if (type === "skill") return "技能";
	return "工具";
}

function skillScopeLabel(scope: SkillScope): string {
	return scope === "global" ? "全局" : "作品";
}

function subagentToolAccessLabel(access: CustomSubagentToolAccess): string {
	if (access === "readOnly") return "只读";
	if (access === "general") return "通用";
	return "自定义";
}

function hookTypeLabel(type: HookType): string {
	return type === "command" ? "命令" : "HTTP";
}

function proxyModeLabel(mode: HookProxyMode): string {
	if (mode === "default") return "默认";
	if (mode === "direct") return "直连";
	if (mode === "system") return "系统代理";
	return "自定义";
}

type SkillScope = "global" | "book";

interface SkillFormState {
	name: string;
	description: string;
	content: string;
}

const EMPTY_SKILL_FORM: SkillFormState = {
	name: "",
	description: "",
	content: "",
};

function SkillsSection({
	scope,
	bookId,
	bookTitle,
}: {
	readonly scope: SkillScope;
	readonly bookId?: string;
	readonly bookTitle?: string;
}) {
	const [skills, setSkills] = useState<
		readonly (SkillSummary | RuntimeBookSkillSummary)[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingName, setPendingName] = useState<string | null>(null);
	const [editor, setEditor] = useState<
		{ mode: "create" } | { mode: "edit"; currentName: string } | null
	>(null);
	const [form, setForm] = useState<SkillFormState>(EMPTY_SKILL_FORM);
	const [deleteName, setDeleteName] = useState<string | null>(null);
	const [expandedSkillNames, setExpandedSkillNames] = useState<ReadonlySet<string>>(new Set());
	const [filePreview, setFilePreview] = useState<{
		skillName: string;
		fileName: string;
		content?: string;
		loading?: boolean;
	} | null>(null);

	const supported = scope === "global" || Boolean(bookId);
	const scopeKey = scope === "global" ? "global" : `book:${bookId ?? ""}`;

	const load = useCallback(async () => {
		if (!supported) {
			setSkills([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const result =
				scope === "global"
					? await skillsClient.listGlobal()
					: bookId
						? await productClient.listBookSkills(bookId)
						: [];
			setSkills(result);
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId, scope, supported]);

	useEffect(() => {
		void load();
	}, [load]);

	// A book switch changes the trusted Runtime scope. Never leave an editor,
	// delete confirmation, or in-flight label from the previous book visible.
	useEffect(() => {
		if (scopeKey === "") return;
		setEditor(null);
		setForm(EMPTY_SKILL_FORM);
		setDeleteName(null);
		setPendingName(null);
		setError(null);
	}, [scopeKey]);

	async function openFilePreview(skillName: string, fileName: string) {
		setFilePreview({ skillName, fileName, loading: true });
		try {
			const skill: Skill | RuntimeBookSkill =
				scope === "global"
					? await skillsClient.getGlobal(skillName)
					: await productClient.getBookSkill(requireBookId(bookId), skillName);
			setFilePreview({
				skillName,
				fileName,
				content: fileName === "SKILL.md" ? skill.content : `// 技能子文件：${fileName}\n// 位置：${"location" in skill ? skill.location : "作品绑定目录"}\n\n${skill.content}`,
				loading: false,
			});
		} catch (previewError) {
			setFilePreview({
				skillName,
				fileName,
				content: `加载文件内容失败：${errorMessage(previewError)}`,
				loading: false,
			});
		}
	}

	function toggleSkillFiles(name: string) {
		setExpandedSkillNames((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	async function openEdit(name: string) {
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingName(name);
		setError(null);
		try {
			const skill: Skill | RuntimeBookSkill =
				scope === "global"
					? await skillsClient.getGlobal(name)
					: await productClient.getBookSkill(requireBookId(bookId), name);
			setForm({
				name: skill.name,
				description: skill.description,
				content: skill.content,
			});
			setEditor({ mode: "edit", currentName: name });
		} catch (editError) {
			setError(errorMessage(editError));
		} finally {
			setPendingName(null);
		}
	}

	async function saveSkill() {
		if (!editor) return;
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingName(editor.mode === "edit" ? editor.currentName : form.name);
		setError(null);
		const input: SkillInput = {
			name: form.name.trim(),
			description: form.description.trim(),
			content: form.content,
		};
		try {
			if (scope === "global") {
				if (editor.mode === "create") await skillsClient.createGlobal(input);
				else await skillsClient.updateGlobal(editor.currentName, input);
			} else if (editor.mode === "create") {
				await productClient.createBookSkill(requireBookId(bookId), input);
			} else {
				await productClient.updateBookSkill(
					requireBookId(bookId),
					editor.currentName,
					input,
				);
			}
			setEditor(null);
			setForm(EMPTY_SKILL_FORM);
			await invalidateNarratorCommands();
			await load();
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setPendingName(null);
		}
	}

	async function deleteSkill() {
		if (!deleteName) return;
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingName(deleteName);
		setError(null);
		try {
			if (scope === "global") await skillsClient.deleteGlobal(deleteName);
			else
				await productClient.deleteBookSkill(requireBookId(bookId), deleteName);
			setDeleteName(null);
			await invalidateNarratorCommands();
			await load();
		} catch (deleteError) {
			setError(errorMessage(deleteError));
		} finally {
			setPendingName(null);
		}
	}

	async function toggleGlobalSkill(name: string, enabled: boolean) {
		setPendingName(name);
		setError(null);
		try {
			await skillsClient.toggleGlobal(name, enabled);
			await invalidateNarratorCommands();
			await load();
		} catch (toggleError) {
			setError(errorMessage(toggleError));
		} finally {
			setPendingName(null);
		}
	}

	if (!supported) {
		return (
			<div className="flex flex-col gap-4">
				<SectionHeading
					title="作品技能"
					description="作品技能通过可信书籍绑定解析 Runtime 项目，不接收文件系统路径或内部项目标识。"
				/>
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Boxes />
						</EmptyMedia>
						<EmptyTitle>未选择作品</EmptyTitle>
						<EmptyDescription>
							在侧栏选择作品后，可通过 Runtime 产品契约管理作品技能。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	const title = scope === "global" ? "全局技能" : "作品技能";
	const skillSourceLabel = (location?: string): string => {
		// 无路径或占位 location（如 mock 的 "book"）时，显示作用域本身：全局 / 作品
		if (!location || location === "book" || location === "global") {
			return skillScopeLabel(scope);
		}
		if (location.includes("/.narrafork/")) return ".narrafork";
		if (location.includes("/.claude/")) return ".claude";
		if (location.includes("/.agents/")) return ".agents";
		return location;
	};
	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title={title}
				description={
					scope === "global"
						? "先扫描发现家目录下 .narrafork/.claude/.agents 的技能，再按需创建或编辑。"
						: `扫描作品目录 .novelfork/skills 下的项目技能。注意：写作配置中启用的写作 Skills 存储在作品数据库而非此目录；要查看已启用的写作 Skills，请前往「写作配置 → 技能」。作品：${bookTitle || bookId}`
				}
				action={
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void load()}
							disabled={loading}
						>
							<RefreshCw data-icon="inline-start" />
							重新扫描
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={() => {
								setForm(EMPTY_SKILL_FORM);
								setEditor({ mode: "create" });
							}}
						>
							<Plus data-icon="inline-start" />
							创建技能
						</Button>
					</div>
				}
			/>
			<Alert>
				<AlertTitle>发现优先</AlertTitle>
				<AlertDescription>
					{scope === "global"
						? "列表来自 Runtime 扫描 ~/.narrafork、~/.claude、~/.agents 等技能目录；「重新扫描」会重新发现磁盘上的 SKILL.md。「创建」写入 .narrafork/skills。"
						: "列表来自 Runtime 扫描当前作品绑定目录下的技能路径；Studio 只传 bookId，不传项目路径。当前没有独立的作品技能启停接口。"}
				</AlertDescription>
			</Alert>
			{error && <ErrorAlert message={error} />}
			{loading ? (
				<LoadingCards />
			) : skills.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Sparkles />
						</EmptyMedia>
						<EmptyTitle>未发现{skillScopeLabel(scope)}技能</EmptyTitle>
						<EmptyDescription>
							先点「重新扫描」从磁盘发现已有技能；若目录为空，再创建新的 SKILL.md。
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => void load()}
							>
								<RefreshCw data-icon="inline-start" />
								重新扫描
							</Button>
							<Button type="button" onClick={() => setEditor({ mode: "create" })}>
								<Plus data-icon="inline-start" />
								创建技能
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{skills.map((skill) => (
						<Card key={skill.name}>
							<CardHeader>
								<CardTitle>{skill.name}</CardTitle>
								<CardDescription>{skill.description}</CardDescription>
								{scope === "global" && (
									<CardAction>
										<Switch
											aria-label={`切换全局技能：${skill.name}`}
											checked={!skill.disabled}
											disabled={pendingName === skill.name}
											onCheckedChange={(enabled) =>
												void toggleGlobalSkill(skill.name, enabled)
											}
										/>
									</CardAction>
								)}
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="outline">
										{skillSourceLabel(
											"location" in skill ? skill.location : undefined,
										)}
									</Badge>
									<Badge variant={skill.disabled ? "destructive" : "secondary"}>
										{skill.disabled ? "已禁用" : "已启用"}
									</Badge>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										className="h-6 text-xs"
										onClick={() => toggleSkillFiles(skill.name)}
									>
										<FolderTree className="mr-1 size-3" />
										{skill.files?.length ?? 0} 个文件
										{expandedSkillNames.has(skill.name) ? (
											<ChevronUp className="ml-1 size-3" />
										) : (
											<ChevronDown className="ml-1 size-3" />
										)}
									</Button>
								</div>
								{expandedSkillNames.has(skill.name) && (
									<div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 text-xs">
										<div className="text-[11px] font-medium text-muted-foreground">技能文件树：</div>
										{skill.files && skill.files.length > 0 ? (
											<div className="flex flex-col gap-1">
												{skill.files.map((file) => (
													<button
														key={file}
														type="button"
														className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted text-left"
														onClick={() => void openFilePreview(skill.name, file)}
													>
														<span className="flex items-center gap-1.5 font-mono text-muted-foreground">
															<FileCode className="size-3 text-primary" />
															{file}
														</span>
														<Eye className="size-3 text-muted-foreground hover:text-foreground" />
													</button>
												))}
											</div>
										) : (
											<div className="text-muted-foreground">（默认 SKILL.md）</div>
										)}
									</div>
								)}
								<div className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={pendingName === skill.name}
										onClick={() => void openEdit(skill.name)}
									>
										<Pencil data-icon="inline-start" />
										编辑
									</Button>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={pendingName === skill.name}
										onClick={() => setDeleteName(skill.name)}
									>
										<Trash2 data-icon="inline-start" />
										删除
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<SkillEditorDialog
				open={editor !== null}
				mode={editor?.mode ?? "create"}
				form={form}
				saving={pendingName !== null && editor !== null}
				onFormChange={setForm}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
						setForm(EMPTY_SKILL_FORM);
					}
				}}
				onSave={() => void saveSkill()}
			/>
			<DeleteConfirmDialog
				open={deleteName !== null}
				title="删除技能"
				description={`确定通过 Runtime ${skillScopeLabel(scope)}技能路由删除“${deleteName ?? "此技能"}”吗？`}
				deleting={deleteName !== null && pendingName === deleteName}
				onOpenChange={(open) => {
					if (!open) setDeleteName(null);
				}}
				onConfirm={() => void deleteSkill()}
			/>
			<SkillFilePreviewDialog
				preview={filePreview}
				onOpenChange={(open) => {
					if (!open) setFilePreview(null);
				}}
			/>
		</div>
	);
}

function SkillFilePreviewDialog({
	preview,
	onOpenChange,
}: {
	readonly preview: {
		skillName: string;
		fileName: string;
		content?: string;
		loading?: boolean;
	} | null;
	readonly onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={preview !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FileCode className="size-4 text-primary" />
						{preview?.skillName} · {preview?.fileName}
					</DialogTitle>
					<DialogDescription>
						在线查阅技能文件源码与格式化提示词结构。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					{preview?.loading ? (
						<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
							正在读取技能文件内容…
						</div>
					) : (
						<pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
							{preview?.content || "无内容"}
						</pre>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SkillEditorDialog({
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
	readonly form: SkillFormState;
	readonly saving: boolean;
	readonly onFormChange: (form: SkillFormState) => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onSave: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "创建技能" : "编辑技能"}
					</DialogTitle>
					<DialogDescription>
						技能内容将通过所选的原生 Runtime 技能路由保存。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="skill-name">名称</Label>
						<Input
							id="skill-name"
							value={form.name}
							onChange={(event) =>
								onFormChange({ ...form, name: event.target.value })
							}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="skill-description">描述</Label>
						<Input
							id="skill-description"
							value={form.description}
							onChange={(event) =>
								onFormChange({ ...form, description: event.target.value })
							}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="skill-content">内容</Label>
						<Textarea
							id="skill-content"
							className="min-h-64 font-mono"
							value={form.content}
							onChange={(event) =>
								onFormChange({ ...form, content: event.target.value })
							}
						/>
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
						disabled={saving || !form.name.trim() || !form.description.trim()}
						onClick={onSave}
					>
						{saving ? "保存中…" : mode === "create" ? "创建" : "保存修改"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface SubagentFormState {
	name: string;
	description: string;
	toolAccess: CustomSubagentToolAccess;
	customTools: string;
	defaultModel: string;
	prompt: string;
}

const EMPTY_SUBAGENT_FORM: SubagentFormState = {
	name: "",
	description: "",
	toolAccess: "readOnly",
	customTools: "",
	defaultModel: "",
	prompt: "",
};

function CustomSubagentsSection() {
	const [subagents, setSubagents] = useState<readonly CustomSubagent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingName, setPendingName] = useState<string | null>(null);
	const [editor, setEditor] = useState<
		{ mode: "create" } | { mode: "edit"; currentName: string } | null
	>(null);
	const [form, setForm] = useState<SubagentFormState>(EMPTY_SUBAGENT_FORM);
	const [deleteName, setDeleteName] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setSubagents(await subagentsClient.list());
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	function openEdit(subagent: CustomSubagent) {
		setForm({
			name: subagent.name,
			description: subagent.description,
			toolAccess: subagent.toolAccess,
			customTools: subagent.customTools.join(", "),
			defaultModel: subagent.defaultModel,
			prompt: subagent.prompt,
		});
		setEditor({ mode: "edit", currentName: subagent.name });
	}

	async function saveSubagent() {
		if (!editor) return;
		const input: CustomSubagentInput = {
			name: form.name.trim(),
			description: form.description.trim(),
			toolAccess: form.toolAccess,
			customTools: form.customTools
				.split(",")
				.map((tool) => tool.trim())
				.filter(Boolean),
			defaultModel: form.defaultModel.trim(),
			prompt: form.prompt,
		};
		setPendingName(editor.mode === "edit" ? editor.currentName : input.name);
		setError(null);
		try {
			if (editor.mode === "create") await subagentsClient.create(input);
			else await subagentsClient.update(editor.currentName, input);
			setEditor(null);
			setForm(EMPTY_SUBAGENT_FORM);
			await load();
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setPendingName(null);
		}
	}

	async function deleteSubagent() {
		if (!deleteName) return;
		setPendingName(deleteName);
		setError(null);
		try {
			await subagentsClient.delete(deleteName);
			setDeleteName(null);
			await load();
		} catch (deleteError) {
			setError(errorMessage(deleteError));
		} finally {
			setPendingName(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="自定义子代理"
				description="创建具有明确模型、提示词和工具访问设置的专用 Runtime 子代理。"
				action={
					<Button
						type="button"
						size="sm"
						onClick={() => {
							setForm(EMPTY_SUBAGENT_FORM);
							setEditor({ mode: "create" });
						}}
					>
						<Plus data-icon="inline-start" />
						创建子代理
					</Button>
				}
			/>
			{error && <ErrorAlert message={error} />}
			{loading ? (
				<LoadingCards />
			) : subagents.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Bot />
						</EmptyMedia>
						<EmptyTitle>暂无自定义子代理</EmptyTitle>
						<EmptyDescription>
							通过 Runtime 自定义子代理路由创建子代理。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{subagents.map((subagent) => (
						<Card key={subagent.name}>
							<CardHeader>
								<CardTitle>{subagent.name}</CardTitle>
								<CardDescription>{subagent.description}</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">
										{subagentToolAccessLabel(subagent.toolAccess)}
									</Badge>
									<Badge variant="outline">
										{subagent.defaultModel || "默认模型"}
									</Badge>
									{subagent.customTools.map((tool) => (
										<Badge key={tool} variant="outline">
											{tool}
										</Badge>
									))}
								</div>
								<p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
									{subagent.prompt}
								</p>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={pendingName === subagent.name}
										onClick={() => openEdit(subagent)}
									>
										<Pencil data-icon="inline-start" />
										编辑
									</Button>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={pendingName === subagent.name}
										onClick={() => setDeleteName(subagent.name)}
									>
										<Trash2 data-icon="inline-start" />
										删除
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<SubagentEditorDialog
				open={editor !== null}
				mode={editor?.mode ?? "create"}
				form={form}
				saving={editor !== null && pendingName !== null}
				onFormChange={setForm}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
						setForm(EMPTY_SUBAGENT_FORM);
					}
				}}
				onSave={() => void saveSubagent()}
			/>
			<DeleteConfirmDialog
				open={deleteName !== null}
				title="删除自定义子代理"
				description={`确定从 Runtime 中删除“${deleteName ?? "此子代理"}”吗？`}
				deleting={deleteName !== null && pendingName === deleteName}
				onOpenChange={(open) => {
					if (!open) setDeleteName(null);
				}}
				onConfirm={() => void deleteSubagent()}
			/>
		</div>
	);
}

function SubagentEditorDialog({
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
	readonly form: SubagentFormState;
	readonly saving: boolean;
	readonly onFormChange: (form: SubagentFormState) => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onSave: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "创建自定义子代理" : "编辑自定义子代理"}
					</DialogTitle>
					<DialogDescription>
						所有字段都直接映射到 Runtime 自定义子代理契约。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-2">
							<Label htmlFor="subagent-name">名称</Label>
							<Input
								id="subagent-name"
								value={form.name}
								onChange={(event) =>
									onFormChange({ ...form, name: event.target.value })
								}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="subagent-model">默认模型</Label>
							<Input
								id="subagent-model"
								value={form.defaultModel}
								onChange={(event) =>
									onFormChange({ ...form, defaultModel: event.target.value })
								}
								placeholder="留空时使用 Runtime 默认模型"
							/>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="subagent-description">描述</Label>
						<Input
							id="subagent-description"
							value={form.description}
							onChange={(event) =>
								onFormChange({ ...form, description: event.target.value })
							}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-2">
							<Label>工具访问</Label>
							<SimpleSelect
								aria-label="工具访问"
								value={form.toolAccess}
								onValueChange={(value) =>
									onFormChange({
										...form,
										toolAccess: value as CustomSubagentToolAccess,
									})
								}
								options={[
									{ value: "readOnly", label: "只读" },
									{ value: "general", label: "通用" },
									{ value: "custom", label: "自定义" },
								]}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="subagent-custom-tools">自定义工具</Label>
							<Input
								id="subagent-custom-tools"
								value={form.customTools}
								disabled={form.toolAccess !== "custom"}
								onChange={(event) =>
									onFormChange({ ...form, customTools: event.target.value })
								}
								placeholder="Read, Grep, WebFetch"
							/>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="subagent-prompt">提示词</Label>
						<Textarea
							id="subagent-prompt"
							className="min-h-64 font-mono"
							value={form.prompt}
							onChange={(event) =>
								onFormChange({ ...form, prompt: event.target.value })
							}
						/>
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
						disabled={
							saving ||
							!form.name.trim() ||
							!form.description.trim() ||
							!form.prompt.trim()
						}
						onClick={onSave}
					>
						{saving ? "保存中…" : mode === "create" ? "创建" : "保存修改"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

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

type HookScope = "global" | "book";
type DisplayHook = RuntimeHook | RuntimeBookHook;

function HooksSection({
	bookId,
	bookTitle,
}: {
	readonly bookId?: string;
	readonly bookTitle?: string;
}) {
	const [scope, setScope] = useState<HookScope>(() =>
		bookId ? "book" : "global",
	);
	const [hooks, setHooks] = useState<readonly DisplayHook[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [editor, setEditor] = useState<
		{ mode: "create" } | { mode: "edit"; id: string } | null
	>(null);
	const [form, setForm] = useState<HookFormState>(EMPTY_HOOK_FORM);
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (scope === "book" && !bookId) {
			setHooks([]);
			setError(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			setHooks(
				scope === "global"
					? await hooksClient.listGlobal()
					: bookId
						? await productClient.listBookHooks(bookId)
						: [],
			);
		} catch (loadError) {
			setError(errorMessage(loadError, true));
		} finally {
			setLoading(false);
		}
	}, [bookId, scope]);

	useEffect(() => {
		void load();
	}, [load]);

	// Keep the UI scope aligned with the selected book and discard stale
	// mutations when the trusted book binding changes or disappears.
	useEffect(() => {
		if (!bookId && scope === "book") setScope("global");
		setEditor(null);
		setForm(EMPTY_HOOK_FORM);
		setDeleteId(null);
		setPendingId(null);
		setError(null);
	}, [bookId, scope]);

	function openEdit(hook: DisplayHook) {
		setForm({
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
		});
		setEditor({ mode: "edit", id: hook.id });
	}

	async function saveHook() {
		if (!editor) return;
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingId(editor.mode === "edit" ? editor.id : "create");
		setError(null);
		try {
			const headers = parseRecord(form.headers);
			const common = {
				event: form.event,
				matcher: form.matcher,
				headers,
				proxyMode: form.proxyMode,
				proxyUrl:
					form.proxyMode === "custom" ? form.proxyUrl.trim() : undefined,
				timeout: Number(form.timeout) || 30,
				enabled: form.enabled,
				sortOrder: Number(form.sortOrder) || 0,
			};
			if (editor.mode === "create") {
				const input =
					form.type === "command"
						? {
								...common,
								type: "command" as const,
								command: form.command.trim(),
							}
						: { ...common, type: "http" as const, url: form.url.trim() };
				if (scope === "global") await hooksClient.create(input);
				else await productClient.createBookHook(requireBookId(bookId), input);
			} else {
				const input =
					form.type === "command"
						? {
								...common,
								type: "command" as const,
								command: form.command.trim(),
								url: null,
							}
						: {
								...common,
								type: "http" as const,
								url: form.url.trim(),
								command: null,
							};
				if (scope === "global") await hooksClient.update(editor.id, input);
				else
					await productClient.updateBookHook(
						requireBookId(bookId),
						editor.id,
						input,
					);
			}
			setEditor(null);
			setForm(EMPTY_HOOK_FORM);
			await load();
		} catch (saveError) {
			setError(errorMessage(saveError, true));
		} finally {
			setPendingId(null);
		}
	}

	async function toggleHook(hook: DisplayHook, enabled: boolean) {
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingId(hook.id);
		setError(null);
		try {
			if (scope === "global") await hooksClient.update(hook.id, { enabled });
			else
				await productClient.updateBookHook(requireBookId(bookId), hook.id, {
					enabled,
				});
			await load();
		} catch (toggleError) {
			setError(errorMessage(toggleError, true));
		} finally {
			setPendingId(null);
		}
	}

	async function deleteHook() {
		if (!deleteId) return;
		if (scope === "book" && !bookId) {
			setError("请先选择作品。");
			return;
		}
		setPendingId(deleteId);
		setError(null);
		try {
			if (scope === "global") await hooksClient.delete(deleteId);
			else await productClient.deleteBookHook(requireBookId(bookId), deleteId);
			setDeleteId(null);
			await load();
		} catch (deleteError) {
			setError(errorMessage(deleteError, true));
		} finally {
			setPendingId(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Hooks"
				description={
					scope === "global"
						? "由管理员管理的全局 Runtime Hooks。"
						: `由管理员通过书籍绑定网关管理当前作品 ${bookTitle || bookId} 的 Hooks。`
				}
				action={
					<div className="flex flex-wrap gap-2">
						<SimpleSelect
							aria-label="钩子作用域"
							value={scope}
							onValueChange={(value) => {
								setScope(value as HookScope);
								setEditor(null);
								setDeleteId(null);
							}}
							options={[
								{ value: "global", label: "全局" },
								{
									value: "book",
									label: bookId
										? `当前作品 · ${bookTitle || bookId}`
										: "当前作品（未选择）",
									disabled: !bookId,
								},
							]}
						/>
						<Button
							type="button"
							size="sm"
							disabled={scope === "book" && !bookId}
							onClick={() => {
								setForm(EMPTY_HOOK_FORM);
								setEditor({ mode: "create" });
							}}
						>
							<Plus data-icon="inline-start" />
							创建 Hook
						</Button>
					</div>
				}
			/>
			<Alert>
				<AlertTitle>需要 Runtime 管理员权限</AlertTitle>
				<AlertDescription>
					Hook
					路由仅限管理员使用。作品作用域只发送书籍标识，服务端验证绑定并注入内部项目标识。支持
					PreToolUse、PostToolUse、Stop、Attention、AttentionResolved 与
					command/http。
				</AlertDescription>
			</Alert>
			{error && <ErrorAlert title="钩子请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : hooks.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ShieldAlert />
						</EmptyMedia>
						<EmptyTitle>暂无钩子</EmptyTitle>
						<EmptyDescription>
							当前 Runtime 作用域未返回任何钩子。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{hooks.map((hook) => (
						<Card key={hook.id}>
							<CardHeader>
								<CardTitle>{hook.event}</CardTitle>
								<CardDescription>
									{hook.matcher || "匹配所有事件"}
								</CardDescription>
								<CardAction>
									<Switch
										aria-label={`切换钩子：${hook.id}`}
										checked={hook.enabled}
										disabled={pendingId === hook.id}
										onCheckedChange={(enabled) =>
											void toggleHook(hook, enabled)
										}
									/>
								</CardAction>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="flex flex-wrap gap-2">
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
										onClick={() => openEdit(hook)}
									>
										<Pencil data-icon="inline-start" />
										编辑
									</Button>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										onClick={() => setDeleteId(hook.id)}
									>
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
				title="删除钩子"
				description="确定通过 Runtime 管理员路由删除此钩子吗？"
				deleting={deleteId !== null && pendingId === deleteId}
				onOpenChange={(open) => {
					if (!open) setDeleteId(null);
				}}
				onConfirm={() => void deleteHook()}
			/>
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
								onValueChange={(value) =>
									onFormChange({ ...form, event: value as HookEvent })
								}
								options={HOOK_EVENTS.map((event) => ({
									value: event,
									label: event,
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
					<div className="flex flex-col gap-2">
						<Label htmlFor="hook-matcher">匹配器</Label>
						<Input
							id="hook-matcher"
							value={form.matcher}
							onChange={(event) =>
								onFormChange({ ...form, matcher: event.target.value })
							}
							placeholder="可选的工具或事件匹配器"
						/>
					</div>
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

function DeleteConfirmDialog({
	open,
	title,
	description,
	deleting,
	onOpenChange,
	onConfirm,
}: {
	readonly open: boolean;
	readonly title: string;
	readonly description: string;
	readonly deleting: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
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
						variant="destructive"
						disabled={deleting}
						onClick={onConfirm}
					>
						{deleting ? "删除中…" : "删除"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
