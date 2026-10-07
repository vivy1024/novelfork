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
import {
	buildContextIndexCard,
	buildWorkflowRunBrief,
	findApprovedProseMismatch,
	getActiveWorkflowRunForNarrator,
	loadWritingInjectionPreserve,
	renderWritingInjectionPreserve,
	runningSteps,
	type WorkflowExplanation,
	type WorkflowRunRecord,
} from "@vivy1024/novelfork-novel-plugin/engine";

export const WORKFLOW_PROMPT_EXTENSION_ID = "novelfork.workflow-run";

type Risk = "read" | "draft-write" | "confirmed-write" | "destructive";

function isWorkflowTool(canonicalName: string): boolean {
	return canonicalName.startsWith("workflow.");
}

/**
 * 叙述者在这本书上进行中的运行。存储不可用（纯单元测试、Runtime 尚未初始化产品库）时
 * 视为没有运行——此时产品本身也无法工作，不应因此改变既有行为。
 */
export function findActiveWorkflowRun(narratorId: string, bookId: string | undefined): WorkflowRunRecord | null {
	if (!bookId) return null;
	try {
		const run = getActiveWorkflowRunForNarrator(getStorageDatabase(), narratorId);
		return run && run.bookId === bookId ? run : null;
	} catch {
		return null;
	}
}

/** 由叙述者本人执行的进行中工序（委派子代理的工序不允许叙述者直接写入）。 */
function directSteps(run: WorkflowRunRecord) {
	return runningSteps(run.state).filter((step) => step.executorKind !== "subagent");
}

/**
 * 可见性（每趟开始时生效）：运行中只露本工序允许的写类工具；等待确认 / 受阻时只露读类。
 *
 * 「高级」工具不参与收窄：它们要作者手动加载，Runtime 同步可见性时只保留「上一趟仍在清单里」
 * 的手动加载项——运行期间收掉，运行结束后作者加载过的状态就丢了。高级写入工具仍由
 * explainWorkflowDenial 在调用时拦下，可见性本来只是体验层。
 */
export function isToolVisibleDuringRun(
	run: WorkflowRunRecord,
	canonicalName: string,
	risk: Risk,
	visibility: "author" | "advanced" = "author",
): boolean {
	if (isWorkflowTool(canonicalName) || risk === "read" || visibility === "advanced") return true;
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
		return null;
	}
}

/** 进行中的运行对应的 system 级工序简报；运行已结束时为 null。 */
export function workflowPromptExtension(run: WorkflowRunRecord): { id: string; content: string } | null {
	const brief = buildWorkflowRunBrief(run);
	return brief ? { id: WORKFLOW_PROMPT_EXTENSION_ID, content: brief } : null;
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
