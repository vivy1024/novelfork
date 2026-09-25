/**
 * 创作工作流对叙述者的结构性约束（产品侧，零 fork 改动）。
 *
 * Runtime 只给了两个带 narratorId 的钩子，约束就落在这两处：
 *   resolveContribution —— 每趟对话开始时调用：注入工序简报、收窄可见的小说工具（体验层）
 *   execute             —— 每次小说工具调用都经过：拦下本工序不允许的写入（权威约束，带解释）
 * Runtime 自带的 Write / Edit / Bash / task 不经过产品适配器，这里拦不住（见任务书 5.3 与 P1）。
 *
 * 写类 / 读类按工具权限策略的 risk 判定：read 为读类，恒放行；其余为写类。
 * workflow.* 三个工具恒放行——它们是叙述者与状态机对话的唯一通道。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import {
	buildWorkflowRunBrief,
	findApprovedProseMismatch,
	getActiveWorkflowRunForNarrator,
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

function currentStep(run: WorkflowRunRecord) {
	return run.state.steps.find((step) => step.stepId === run.state.currentStepId);
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
	if (run.state.status !== "running") return false;
	const step = currentStep(run);
	if (!step || step.executorKind === "subagent") return false;
	return step.tools.includes(canonicalName);
}

/** 拦截（每次调用生效）：返回 null 放行，否则返回给模型看的三段式说明。 */
export function explainWorkflowDenial(
	run: WorkflowRunRecord,
	canonicalName: string,
	risk: Risk,
	input: Readonly<Record<string, unknown>>,
): WorkflowExplanation | null {
	if (isWorkflowTool(canonicalName) || risk === "read") return null;
	const step = currentStep(run);
	const stepLabel = step ? `「${step.label}」` : "当前工序";
	if (run.state.status === "awaiting_approval") {
		return {
			what: `${canonicalName} 被拦下：${stepLabel}正在等作者确认`,
			why: "确认之前写入，会让作者审的内容与写进书里的对不上",
			action: "停止产出，等作者在「故事推进 › 执行」确认或打回",
		};
	}
	if (run.state.status === "blocked") {
		return {
			what: `${canonicalName} 被拦下：${stepLabel}受阻，等待作者处理`,
			why: "受阻期间继续写入会绕过作者对阻塞的决定",
			action: "等作者选择重试、跳过或取消",
		};
	}
	if (!step) {
		return { what: `${canonicalName} 被拦下：运行没有当前工序`, why: "状态异常", action: "调用 workflow_report_blocker 说明情况" };
	}
	if (step.executorKind === "subagent") {
		return {
			what: `${canonicalName} 被拦下：${stepLabel}要求委派子代理完成`,
			why: "方案把这道工序交给了指定子代理，由你直接写入等于跳过了它",
			action: `用 task 委派 ${step.agentId ?? "指定子代理"}，拿到结果后用 workflow_submit_step_output 提交`,
		};
	}
	if (!step.tools.includes(canonicalName)) {
		const allowed = step.tools.length > 0 ? step.tools.join("、") : "无";
		return {
			what: `${canonicalName} 被拦下：${stepLabel}不允许这个写入工具`,
			why: `方案规定本工序只能用 ${allowed}；本工序的产物应通过 workflow_submit_step_output 提交`,
			action: "改用本工序允许的工具，或把产物提交给工作流",
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
