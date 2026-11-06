/**
 * 创作工作流对叙述者的结构性约束（产品侧，零 fork 改动）。
 *
 * Runtime 只给了两个带 narratorId 的钩子，约束就落在这两处：
 *   resolveContribution —— 每趟对话开始时调用：注入工序简报、收窄可见的小说工具（体验层）
 *   execute             —— 每次小说工具调用都经过：拦下本工序不允许的写入（权威约束，带解释）
 * Runtime 自带的 Write / Edit / Bash / task 不经过产品适配器，这里拦不住（见任务书 5.3 与 P1）。
 *
 * 写类 / 读类按工具权限策略的 risk 判定：read 为读类，恒放行；其余为写类。
 * workflow.* 工具恒放行——它们是叙述者与状态机对话的唯一通道。
 * 工作流按图推进，可能有多道工序同时进行：放行范围是所有进行中工序允许的写入工具的并集。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { db as runtimeDb, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import {
	buildContextIndexCard,
	buildDelegatedStepBrief,
	buildWorkflowRunBrief,
	rosterTemplatesForStep,
	findApprovedProseMismatch,
	getActiveWorkflowRunForNarrator,
	isNovelSubagentTemplateId,
	listActiveWorkflowRunsForBook,
	loadWritingInjectionPreserve,
	renderWritingInjectionPreserve,
	runningSteps,
	WORKFLOW_WORKER_TRAIT,
	workflowTeamIdForBook,
	type WorkflowExplanation,
	type WorkflowRunRecord,
} from "@vivy1024/novelfork-novel-plugin/engine";

export const WORKFLOW_PROMPT_EXTENSION_ID = "novelfork.workflow-run";
export const WORKFLOW_WORKER_PROMPT_EXTENSION_ID = "novelfork.workflow-worker";

/**
 * 工作流工人叙述者的身份标记（建队时写在 traits 上，闸门据此认出本运行的工人）。
 *
 * 单一来源在插件的 workflow-team 模块：建队（产品路由）和闸门（适配器）必须同一个值。
 * 不靠标题前缀——插件 team.update_member 允许改成员标题，改完仍要认得出。
 */
export { WORKFLOW_WORKER_TRAIT };

type Risk = "read" | "draft-write" | "confirmed-write" | "destructive";

function isWorkflowTool(canonicalName: string): boolean {
	return canonicalName.startsWith("workflow.");
}

/**
 * 叙述者在这本书上进行中的运行。存储不可用（纯单元测试、Runtime 尚未初始化产品库）时
 * 视为没有运行——此时产品本身也无法工作，不应因此改变既有行为。
 */
export function findActiveWorkflowRun(narratorId: string, bookId: string | undefined): WorkflowRunRecord | null {
	const lookup = lookupActiveWorkflowRun(narratorId, bookId);
	return lookup.ok ? lookup.run : null;
}

export type ActiveWorkflowRunLookup =
	| { readonly ok: true; readonly run: WorkflowRunRecord | null }
	| { readonly ok: false; readonly error: unknown };

/**
 * 写侧用的查询：区分「确实没有运行」和「读不出来」。
 * - 产品库尚未初始化（纯单元测试、Runtime 尚未初始化产品库）：此时产品本身也无法工作，
 *   与 findActiveWorkflowRun 一致视为没有运行；
 * - 库已打开但查询抛错：返回失败，由 execute 闸门对写类 fail-closed。
 *   findActiveWorkflowRun 把它也当成没有运行，用于可见性（体验层）可以；execute 若照搬，
 *   存储一出错所有写工具都会放行——工序约束整个失效。
 */
export function lookupActiveWorkflowRun(narratorId: string, bookId: string | undefined): ActiveWorkflowRunLookup {
	if (!bookId) return { ok: true, run: null };
	let storage: ReturnType<typeof getStorageDatabase>;
	try {
		storage = getStorageDatabase();
	} catch {
		return { ok: true, run: null };
	}
	try {
		const run = getActiveWorkflowRunForNarrator(storage, narratorId);
		return { ok: true, run: run && run.bookId === bookId ? run : null };
	} catch (error) {
		return { ok: false, error };
	}
}

/** 运行状态读不出来时，对写类调用的拦截说明（读类与 workflow.* 不拦）。 */
export function explainWorkflowLookupFailure(canonicalName: string, risk: Risk): WorkflowExplanation | null {
	if (isWorkflowTool(canonicalName) || risk === "read") return null;
	return {
		what: `${canonicalName} 被拦下：无法读取本书的创作工作流状态`,
		why: "读不出是否有进行中的工作流，就无法判断这次写入是否越出当前工序；放行可能绕过作者设定的工序与批准",
		action: "稍后重试；若反复失败，重启产品、确认运行状态后再执行",
	};
}

export type WorkerWorkflowGate =
	/** 不是工人：走领导者那条原有路径。 */
	| { readonly kind: "not-worker" }
	/** 是工人，但这本书上没有进行中的运行：工作流没在管它，按普通叙述者处理。 */
	| { readonly kind: "idle" }
	/** 是工人，且这本书正在跑工作流：领导者在什么状态，它就待在什么状态。 */
	| { readonly kind: "controlled"; readonly run: WorkflowRunRecord }
	/** 是工人，但读不出这本书的运行状态：写类 fail-closed。 */
	| { readonly kind: "unreadable"; readonly error: unknown };

export interface WorkerWorkflowGateSeams {
	/** 这个叙述者是不是工作流工人（产品写在 traits 上的标记）。 */
	readonly isWorker?: (narratorId: string) => Promise<boolean>;
	/** 这本书上进行中的运行。 */
	readonly activeRunsForBook?: (bookId: string) => readonly WorkflowRunRecord[];
}

/** 叙述者 traits 里是否带工作流工人标记（traits 可能在库中是数组，也可能是 JSON 字符串）。 */
export function isWorkflowWorkerByTrait(traits: unknown): boolean {
	const list = Array.isArray(traits)
		? traits.filter((item): item is string => typeof item === "string")
		: typeof traits === "string"
			? (() => {
					try {
						const parsed: unknown = JSON.parse(traits);
						return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
					} catch {
						return [];
					}
				})()
			: [];
	return list.includes(WORKFLOW_WORKER_TRAIT);
}

async function isWorkflowWorkerNarrator(narratorId: string): Promise<boolean> {
	try {
		const row = await runtimeDb.query.narrators.findFirst({
			where: eq(narrators.id, narratorId),
			columns: { traits: true, type: true },
		});
		if (!row) return false;
		// Runtime 子代理（task 派出的）继承父叙述者的 contextProjectId，能解析到同一本书的绑定，
		// 但不继承 traits、也有自己的 narratorId：领导者侧查不到运行、工人标记也没有。
		// 不收口它，领导者按简报回退派出的通用子代理就能在运行期间直接写书。
		// 按 type 判断而不是 parentNarratorId：后者也记录 fork 来源，会误锁 fork 出来的主叙述者。
		return isWorkflowWorkerByTrait(row.traits) || row.type === "subagent";
	} catch {
		// 读不到叙述者行（Runtime 库还没初始化）就不是工人：不让 Runtime 的偶发读取失败
		// 把领导者也当成工人拦掉。
		return false;
	}
}

/**
 * 工人侧闸门判定。
 *
 * 工人是同一本书上的另一个产品叙述者，`workflow_runs.narrator_id` 记的是领导者，
 * 所以按叙述者查运行永远是 null——闸门对它们等于不存在，工人可以绕过工序直接写书。
 * 这里改成按书判定：本运行在跑，工人就只能在领导者的同一套约束下活动；
 * 运行状态读不出来时写类 fail-closed（与领导者侧同一条政策）。
 */
export async function resolveWorkerWorkflowGate(
	narratorId: string,
	bookId: string | undefined,
	seams: WorkerWorkflowGateSeams = {},
): Promise<WorkerWorkflowGate> {
	if (!bookId) return { kind: "not-worker" };
	let worker: boolean;
	try {
		worker = await (seams.isWorker ?? isWorkflowWorkerNarrator)(narratorId);
	} catch {
		return { kind: "not-worker" };
	}
	if (!worker) return { kind: "not-worker" };
	let storage: ReturnType<typeof getStorageDatabase>;
	try {
		storage = getStorageDatabase();
	} catch {
		// 产品库还没初始化：产品本身也做不了事，按「没在跑」处理（与领导者侧一致）。
		return { kind: "idle" };
	}
	try {
		// 自己是领导者的叙述者永远走领导者那条路：它有自己的运行行，按工序放行才是对的。
		// 一个叙述者可能既是某本书的工人、又在另一本书当领导者，不能让工人的收口把它锁死。
		const own = getActiveWorkflowRunForNarrator(storage, narratorId);
		if (own && own.bookId === bookId) return { kind: "not-worker" };
		const runs = seams.activeRunsForBook
			? seams.activeRunsForBook(bookId)
			: listActiveWorkflowRunsForBook(storage, bookId);
		// 一本书同时跑多条运行属反常：取最近启动的一条做说明，拦不拦只看有没有。
		const run = runs[0];
		return run ? { kind: "controlled", run } : { kind: "idle" };
	} catch (error) {
		return { kind: "unreadable", error };
	}
}

/**
 * 工人被拦下时给模型看的三段式说明。
 *
 * 不和领导者共用一套文案：工人被拦的原因不是「越出本工序」，而是「派发的活不在你身上」，
 * 让它去提交产物只会把权威写入从领导者那里旁路走，所以 action 明确指向汇报给领导者。
 */
export function explainWorkerWorkflowDenial(
	run: WorkflowRunRecord,
	canonicalName: string,
	risk: Risk,
): WorkflowExplanation | null {
	if (isWorkflowTool(canonicalName) || risk === "read") return null;
	const phase =
		run.state.status === "blocked"
			? "运行受阻"
			: run.state.status === "awaiting_approval"
				? "产物已提交，正在等作者确认"
				: "运行中";
	return {
		what: `${canonicalName} 被拦下：你是本运行的工作流工人，不能直接写这本书（方案「${run.recipe.name}」第 ${run.chapterNumber} 章）`,
		why: `${phase}；权威写入与工序产物只能由领导者的叙述者提交，工人直写会让作者审的内容和被写进书里的对不上`,
		action:
			"把结果整理成文字，用 team_report 汇报给领导者（大段产物按团队约定转交），由领导者统一提交；不要自己调用写入工具",
	};
}

/** Runtime 子代理的委派身份：来自 Runtime 自己的叙述者行，不来自模型输入。 */
export interface SubagentDelegationRecord {
	readonly parentNarratorId: string;
	readonly template: string;
}

/**
 * 读叙述者行里的委派身份（type=subagent 才有）。读不到 / 不是子代理时为 null。
 * 模板名取 `subagent_type`（Runtime 建子代理时写入、之后不变）。
 */
export async function readSubagentDelegation(narratorId: string): Promise<SubagentDelegationRecord | null> {
	try {
		const row = await runtimeDb.query.narrators.findFirst({
			where: eq(narrators.id, narratorId),
			columns: { type: true, subagentType: true, parentNarratorId: true },
		});
		if (!row || row.type !== "subagent") return null;
		const parent = typeof row.parentNarratorId === "string" ? row.parentNarratorId : "";
		const template = typeof row.subagentType === "string" ? row.subagentType : "";
		return parent && template ? { parentNarratorId: parent, template } : null;
	} catch {
		return null;
	}
}

export interface WorkflowDelegationSeams {
	readonly readDelegation?: (narratorId: string) => Promise<SubagentDelegationRecord | null>;
	readonly activeRunForNarrator?: (narratorId: string) => WorkflowRunRecord | null;
}

/**
 * 内置子代理委派判定：叙述者是本书运行领导者派出的子代理、且由名册模板创建时，
 * 返回交给工作流工具的委派身份（工具据此只放行与模板对应的当前工序）。
 *
 * 其它情况一律 null——包括模板不在名册里、父叙述者不是本书运行的领导者、
 * 读不出运行。null 时子代理仍按工人闸门处理（写类全拦，只能汇报）。
 * 当前工序是否真的分给它，由工作流工具在提交时按模板判定；这里只认身份。
 */
export async function resolveWorkflowDelegation(
	narratorId: string,
	bookId: string | undefined,
	seams: WorkflowDelegationSeams = {},
): Promise<{ readonly narratorId: string; readonly template: string; readonly run: WorkflowRunRecord } | null> {
	if (!bookId) return null;
	const delegation = await (seams.readDelegation ?? readSubagentDelegation)(narratorId);
	if (!delegation || !isNovelSubagentTemplateId(delegation.template)) return null;
	let run: WorkflowRunRecord | null;
	try {
		run = seams.activeRunForNarrator
			? seams.activeRunForNarrator(delegation.parentNarratorId)
			: getActiveWorkflowRunForNarrator(getStorageDatabase(), delegation.parentNarratorId);
	} catch {
		return null;
	}
	if (!run || run.bookId !== bookId) return null;
	return { narratorId: delegation.parentNarratorId, template: delegation.template, run };
}

/** 由叙述者本人执行的进行中工序（委派子代理的工序不允许叙述者直接写入）。 */
function directSteps(run: WorkflowRunRecord) {
	return runningSteps(run.state).filter((step) => step.executorKind !== "subagent");
}

/** 内置子代理与状态机对话用的三个运行工具（提交 / 报阻塞是草稿级写入，工人可见性默认不露）。 */
const DELEGATED_RUN_TOOLS = new Set(["workflow.get_current_step", "workflow.submit_step_output", "workflow.report_blocker"]);

export function isDelegatedRunTool(canonicalName: string): boolean {
	return DELEGATED_RUN_TOOLS.has(canonicalName);
}

/**
 * 工人可见性：运行没在进行时不受约束；在进行中时，读类、workflow.* 与团队编排工具照常可见，
 * 写类一律不露。收窄可见性只能减少误导，权威约束仍由 resolver 在 execute 时执行。
 */
export function isToolVisibleForWorker(gate: WorkerWorkflowGate, canonicalName: string, risk: Risk): boolean {
	if (gate.kind !== "controlled") return true;
	if (risk === "read") return true;
	// 汇报与团队编排靠插件工具完成，它们不经过这里（插件工具不是小说工具）。
	return false;
}

/**
 * 可见性（每趟开始时生效）：运行中只露本工序允许的写类工具；等待确认 / 受阻时只露读类。
 *
 * 这里只做可见性判定。会话启用了哪些小说工具（套路常驻、/load 手动加载）由 NarraFork 的套路体系
 * 决定，Runtime 把这里的结果当本趟的可见性过滤，不会改写启用集合——所以「高级」写类工具也照常
 * 收窄，运行结束后作者加载过的状态原样还在。调用时的权威约束仍是 explainWorkflowDenial。
 */
export function isToolVisibleDuringRun(
	run: WorkflowRunRecord,
	canonicalName: string,
	risk: Risk,
): boolean {
	if (isWorkflowTool(canonicalName) || risk === "read") return true;
	if (run.state.status === "blocked") return false;
	return directSteps(run).some((step) => step.tools.includes(canonicalName));
}

/** 拦截（每次调用生效）：返回 null 放行，否则返回给模型看的三段式说明。 */
export function explainWorkflowDenial(
	run: WorkflowRunRecord,
	canonicalName: string,
	risk: Risk,
	input: Readonly<Record<string, unknown>>,
): WorkflowExplanation | null {
	if (isWorkflowTool(canonicalName) || risk === "read") return null;
	if (run.state.status === "blocked") {
		const failed = run.state.steps.find((step) => step.status === "failed");
		return {
			what: `${canonicalName} 被拦下：${failed ? `「${failed.label}」` : "工序"}受阻，等待作者处理`,
			why: "受阻期间继续写入会绕过作者对阻塞的决定",
			action: "等作者选择重试、跳过或取消",
		};
	}
	const running = runningSteps(run.state);
	if (running.length === 0) {
		const awaiting = run.state.steps.filter((step) => step.status === "awaiting_approval").map((step) => `「${step.label}」`);
		return {
			what: `${canonicalName} 被拦下：${awaiting.join("、") || "工序"}正在等作者确认`,
			why: "确认之前写入，会让作者审的内容与写进书里的对不上",
			action: "停止产出，等作者在「写作 › 工作流」确认或打回",
		};
	}
	const direct = directSteps(run);
	if (direct.length === 0) {
		const step = running[0]!;
		return {
			what: `${canonicalName} 被拦下：「${step.label}」要求委派子代理完成`,
			why: "方案把这道工序交给了指定子代理，由你直接写入等于跳过了它",
			action: `优先用团队编排：team_status 看编排后用 team_dispatch 派给「工作流工人·」工人；没有团队工具时改用 task(general) 委派通用子代理（能力降级），拿到结果后用 workflow_submit_step_output 提交`,
		};
	}
	if (!direct.some((step) => step.tools.includes(canonicalName))) {
		const allowed = [...new Set(direct.flatMap((step) => step.tools))];
		const labels = direct.map((step) => `「${step.label}」`).join("、");
		return {
			what: `${canonicalName} 被拦下：${labels}不允许这个写入工具`,
			why: `进行中的工序只能用 ${allowed.length > 0 ? allowed.join("、") : "（无写入工具）"}；工序产物应通过 workflow_submit_step_output 提交`,
			action: "改用允许的工具，或把产物提交给工作流",
		};
	}
	try {
		return findApprovedProseMismatch(getStorageDatabase(), run, canonicalName, input);
	} catch {
		// 设计：这里与上方 findActiveWorkflowRun 的读侧 catch→null 相反，必须 fail-closed。
		// 读侧放行只是多露几个工具，写侧这一关却是「落盘正文必须与作者批准的版本一致」的
		// 唯一校验；存储不可用时静默 return null，等于把已批准正文换成未审内容也能落盘。
		// 因此一致性校验做不了时按闸门政策拦下本次写入，说明原因，待存储恢复后重试。
		return {
			what: `${canonicalName} 被拦下：无法校验写入正文与作者批准的版本是否一致`,
			why: "一致性校验要读取工作流存储中的已批准正文；存储当前不可用，放行可能把未经作者确认的内容写进书里",
			action: "稍后重试；若反复失败，重启产品、确认运行状态后重新执行本工序",
		};
	}
}

/** 进行中的运行对应的 system 级工序简报；运行已结束时为 null。 */
export function workflowPromptExtension(run: WorkflowRunRecord): { id: string; content: string } | null {
	const brief = buildWorkflowRunBrief(run);
	return brief ? { id: WORKFLOW_PROMPT_EXTENSION_ID, content: brief } : null;
}

/**
 * 工人侧的团队任务说明。
 *
 * 工人不跑状态机，简报里那些「提交工序产物 / 报告阻塞」对它没有意义，写了反而诱导它去调
 * workflow_submit_step_output。这里只留它真正要做的三件事：按派发做事、把结果汇报回去、
 * 以及明确它没有本工序的写入权（权威写入在领导者那边）。
 */
export function buildWorkflowWorkerBrief(run: WorkflowRunRecord): string {
	const roles = new Set<string>();
	for (const step of runningSteps(run.state)) {
		if (step.agentId) roles.add(step.agentId);
	}
	// 一本书一个团队：工人的汇报与上下文广播都要落在领导者那套 teamId 上，落错就等于没汇报。
	const teamId = run.bookId ? workflowTeamIdForBook(run.bookId) : "";
	return [
		"【创作工作流 · 你是本运行的工作流工人】",
		`方案「${run.recipe.name}」｜第 ${run.chapterNumber} 章｜运行 ${run.id}`,
		teamId ? `团队：${teamId}（team_report / team_context 都用这个 teamId，不要另建团队）` : "",
		`工序：${runningSteps(run.state).map((step) => `「${step.label}」${step.agentId ? `（角色 ${step.agentId}）` : ""}`).join("、") || "（当前没有进行中的工序）"}`,
		"做法：按领导者派发的任务产出结果，完成后用 team_report 汇报给领导者；结论、引用与必要片段都写清楚。",
		"边界：你没有这本书的写入权——chapter_write / pipeline_write / lore_write / memory_* 等写类工具在本运行期间会被拒绝。",
		"不要调用 workflow_submit_step_output / workflow_report_blocker：产物提交与阻塞报告由领导者负责。",
		"需要更多上下文时用 team_context_log 或读类工具，不要凭猜测补设定。",
	]
		.filter(Boolean)
		.join("\n");
}

export const WORKFLOW_DELEGATED_PROMPT_EXTENSION_ID = "novelfork.workflow-delegated";

/** 内置子代理的工序简报（只讲当前分给该模板的工序）。 */
export function workflowDelegatedExtension(run: WorkflowRunRecord, template: string): { id: string; content: string } {
	const stepIds = runningSteps(run.state)
		.filter((step) => rosterTemplatesForStep(step).includes(template))
		.map((step) => step.stepId);
	return { id: WORKFLOW_DELEGATED_PROMPT_EXTENSION_ID, content: buildDelegatedStepBrief(run, template, stepIds) };
}

/** 工人侧的简报扩展；不是工人时由调用方跳过。 */
export function workflowWorkerExtension(run: WorkflowRunRecord): { id: string; content: string } {
	return { id: WORKFLOW_WORKER_PROMPT_EXTENSION_ID, content: buildWorkflowWorkerBrief(run) };
}

export const CONTEXT_INDEX_CARD_EXTENSION_ID = "novelfork.context-index-card";

/**
 * 资料索引卡（T4.7）：随每趟 resolveContribution 重建注入，会话压缩动不了它。
 * 没有写作历史或存储不可用时为 null（不注入）。权威原文永远在库，卡片只钉
 * 「上次注入用了什么、按哪个通道重取」这几百 token 的指针。
 */
export function contextIndexCardExtension(bookId: string | undefined): { id: string; content: string } | null {
	if (!bookId) return null;
	try {
		const content = buildContextIndexCard(getStorageDatabase(), bookId);
		return content ? { id: CONTEXT_INDEX_CARD_EXTENSION_ID, content } : null;
	} catch {
		return null;
	}
}

export const WRITING_INJECTION_PRESERVE_EXTENSION_ID = "novelfork.writing-injection-preserve";

/**
 * 写作注入保留件（T4.7 尾巴）：最近一次写作注入的原文快照（memory.read write/revise、
 * pipeline.write 成功装配时落盘），随每趟 resolveContribution 重建注入，与索引卡同一条
 * 通道——会话压缩只折叠历史消息，动不了它。没有快照或读失败时为 null（不注入）。
 */
export async function writingInjectionPreserveExtension(
	bookRoot: string | undefined,
	bookId: string | undefined,
): Promise<{ id: string; content: string } | null> {
	if (!bookRoot || !bookId) return null;
	try {
		const snapshot = await loadWritingInjectionPreserve(bookRoot, bookId);
		return snapshot
			? { id: WRITING_INJECTION_PRESERVE_EXTENSION_ID, content: renderWritingInjectionPreserve(snapshot) }
			: null;
	} catch {
		return null;
	}
}
