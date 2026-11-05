import { resolve } from "node:path";

import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  listStyleDistillationJobs,
  loadStyleDistillationJob,
  saveStyleDistillationJob,
  settleStyleDistillationJobState,
  StyleDistillationError,
  StyleDistillationJobSchema,
  type StyleDistillationExplanation,
  type StyleDistillationJob,
} from "./style-distillation.js";
import { acquireStyleDistillationLock } from "./style-distillation-lock.js";
import { hasLiveStyleDistillationRunner, runStyleDistillationBatches } from "./style-distillation-runner.js";

/**
 * 进程重启后的自动续跑。
 *
 * 时机：本进程第一次访问某本书的蒸馏接口时（路由中间件调用，每本书每个进程只扫一次）。
 * 不在服务启动时扫：网页入口的模型按当前登录用户解析并计量（见 routes/style-distillations.ts），
 * 启动时没有用户身份，拿不到合规的生成器；与「后台批次沿用发起请求那位用户的生成器」口径一致。
 *
 * 候选：任务文件里 status=running（上次执行者写下的），且现在没有活着的执行者
 * （本进程无运行者、运行锁无人持有或已陈旧）。这类任务就是执行者中途消失留下的。
 *
 * 防重复：真正执行走 runStyleDistillationBatches，它先拿跨进程运行锁；两个进程同时扫到同一任务，
 * 只有一个拿到锁，另一个得到 BUSY 并跳过。
 *
 * 限次：自动续跑拿到锁后先把 autoResume.failures 加一并落盘，完整跑完才清零，所以执行中途
 * 进程再次退出也会被计数。达到 STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES 后不再续跑，
 * 任务转为 failed 并写明原因；作者手动「继续」会清掉记录重新开始。
 *
 * 没有模型：不续跑、不计失败，把原因写进 autoResume.explanation 后停下；本进程不再为这本书重试，
 * 作者配好模型后手动继续即可。
 *
 * 归属：只续跑 initiatorId 等于本次访问者的任务（模型用量计到访问者名下，与 narrator-team 口径一致：
 * 派出去的活归发起人）。别人的任务、没有发起人记录的旧任务都不碰，留给发起人来访或作者手动继续。
 */

export const STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES = 3;

const LOG = "[style-distillations]";

export interface AutoResumeGeneratorResult {
  readonly generateText?: RuntimeTextGenerator;
  /** 拿不到模型时的原因（展示给作者）。 */
  readonly unavailableMessage?: string;
}

export interface AutoResumeOptions {
  readonly bookRoot: string;
  /**
   * 本次访问的用户（宿主用户 id）。只续跑 initiatorId 等于他的任务：续跑会调模型、用量计到解析出的
   * 生成器所属用户名下，替别人的任务续跑就是让碰巧来访的人买单（与 narrator-team 口径一致：活归发起人）。
   * 缺省（没有登录身份）时不续跑任何任务。
   */
  readonly actorId?: string;
  /** 只在确有候选任务时才调用：解析模型是有成本的（宿主会读配置）。 */
  readonly resolveGenerator: () => Promise<AutoResumeGeneratorResult>;
  readonly maxFailures?: number;
}

export interface AutoResumeOutcome {
  /** 已在后台开始续跑的任务。 */
  readonly resumed: readonly string[];
  /** 达到失败上限、已转为 failed 的任务。 */
  readonly failed: readonly string[];
  /** 因没有模型而停下的任务。 */
  readonly noModel: readonly string[];
  /** 另有活着的执行者，跳过的任务。 */
  readonly skipped: readonly string[];
  /** 不是本次访问者发起的任务（或没有发起人记录）：不替别人续跑，等发起人来访或作者手动继续。 */
  readonly notOwned: readonly string[];
  /** 后台续跑的完成情况，测试与排查用；调用方不必等待。 */
  readonly settled: Promise<void>;
}

/** 在持有运行锁的前提下改写任务文件（不与另一个进程的执行者抢写）。 */
async function updateUnderLock(
  bookRoot: string,
  job: StyleDistillationJob,
  mutate: (job: StyleDistillationJob) => StyleDistillationJob,
  /** 只在任务仍处于该状态时写入；缺省不检查。 */
  requireStatus?: StyleDistillationJob["status"],
): Promise<boolean> {
  const acquired = await acquireStyleDistillationLock(bookRoot, job.jobId);
  if (!acquired.ok) return false;
  try {
    // 拿到锁后重新读一次：扫描到现在之间任务可能已被别的执行者推进（手动继续跑完、作者采纳）。
    // 扫描阶段的写入要求任务仍是 running：不再是 running 就不是孤儿了，放弃写入，
    // 免得把已完成的任务改成失败或盖掉新状态。续跑失败后的记账（任务已结算为 paused）不带这个条件。
    const current = await loadStyleDistillationJob(bookRoot, job.jobId);
    if (requireStatus && current.status !== requireStatus) return false;
    await saveStyleDistillationJob(bookRoot, StyleDistillationJobSchema.parse({ ...mutate(current), updatedAt: new Date().toISOString() }));
    return true;
  } finally {
    await acquired.handle.release();
  }
}

function limitExplanation(failures: number): StyleDistillationExplanation {
  return {
    what: `进程重启后自动续跑已连续 ${failures} 次没有跑完，任务已停止自动续跑并标为失败。`,
    why: "每次续跑都在中途中断（进程退出或任务文件写入失败），继续自动重试可能反复卡在同一处并重复消耗模型额度。",
    next: "查看服务日志中 [style-distillations] 的记录排除原因后，在审阅页点「继续未完成批次」手动继续；已完成的批次结果都保留着。",
  };
}

function noModelExplanation(message: string | undefined): StyleDistillationExplanation {
  return {
    what: `进程重启后发现任务未跑完，但${message ? `当前没有可用模型：${message}` : "当前没有可用的服务端模型"}，未自动续跑。`,
    why: "模型批次需要模型阅读原文；没有模型时反复重试只会失败，所以本次启动不再自动重试。",
    next: "配好默认模型后，在审阅页点「继续未完成批次」；也可以在叙述者对话中请叙述者调用 style.distill_start 并带上 jobId 继续。",
  };
}

// 本进程已扫过的书（按规范化书根）：每本书每个进程只在第一次访问时扫一次。
const scannedBooks = new Map<string, Promise<AutoResumeOutcome | null>>();

function bookKey(bookRoot: string): string {
  const absolute = resolve(bookRoot);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/**
 * 蒸馏入口（HTTP 路由、叙述者工具）在处理请求前调用：本进程里每位用户第一次访问这本书时扫描一次，
 * 只续跑他自己发起的孤儿任务；之后同一用户的调用直接复用第一次的结果。按「书 + 用户」记扫描，
 * 别人先来访不会把发起人的那次扫描吃掉。扫描本身出错只记日志，不影响当前请求。
 */
export function ensureStyleDistillationAutoResume(options: AutoResumeOptions): Promise<AutoResumeOutcome | null> {
  const key = `${bookKey(options.bookRoot)}::${options.actorId?.trim() ?? ""}`;
  const existing = scannedBooks.get(key);
  if (existing) return existing;
  const scan = resumeOrphanedStyleDistillations(options).catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`${LOG} 扫描待续跑的蒸馏任务失败（${options.bookRoot}）：${detail}`);
    return null;
  });
  scannedBooks.set(key, scan);
  return scan;
}

/** 测试用：模拟进程重启，清掉「已扫过」记录。 */
export function resetStyleDistillationAutoResumeForTests(): void {
  scannedBooks.clear();
}

export async function resumeOrphanedStyleDistillations(options: AutoResumeOptions): Promise<AutoResumeOutcome> {
  const { bookRoot } = options;
  const maxFailures = options.maxFailures ?? STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES;
  const resumed: string[] = [];
  const failed: string[] = [];
  const noModel: string[] = [];
  const skipped: string[] = [];
  const notOwned: string[] = [];
  const runs: Promise<unknown>[] = [];

  const { jobs } = await listStyleDistillationJobs(bookRoot);
  const orphans: StyleDistillationJob[] = [];
  for (const job of jobs) {
    if (job.status !== "running") continue;
    if (await hasLiveStyleDistillationRunner(bookRoot, job.jobId)) {
      skipped.push(job.jobId);
      continue;
    }
    orphans.push(job);
  }
  if (orphans.length === 0) return { resumed, failed, noModel, skipped, notOwned, settled: Promise.resolve() };
  console.info(`${LOG} 发现 ${orphans.length} 个上次未跑完且无执行者的蒸馏任务（${bookRoot}）：${orphans.map((job) => job.jobId).join("、")}`);

  // 先处理已达上限的任务，它们不需要模型。
  const pending: StyleDistillationJob[] = [];
  for (const job of orphans) {
    const failures = job.autoResume?.failures ?? 0;
    if (failures < maxFailures) {
      pending.push(job);
      continue;
    }
    const explanation = limitExplanation(failures);
    const written = await updateUnderLock(bookRoot, job, (current) => ({
      ...settleStyleDistillationJobState(current, false),
      status: "failed",
      autoResume: { failures, ...(current.autoResume?.lastAttemptAt ? { lastAttemptAt: current.autoResume.lastAttemptAt } : {}), explanation },
    }), "running");
    if (written) {
      failed.push(job.jobId);
      console.error(`${LOG} 任务 ${job.jobId} 自动续跑已连续 ${failures} 次未完成，达到上限 ${maxFailures}，已标为失败。`);
    } else {
      skipped.push(job.jobId);
    }
  }
  // 下面要调模型（或替发起人写下「没有模型」的说明），只处理本次访问者发起的任务。
  // 达到上限转 failed 不调模型、不替谁花钱，上面对所有孤儿任务都做。
  const actorId = options.actorId?.trim();
  const owned = pending.filter((job) => Boolean(actorId) && job.initiatorId === actorId);
  for (const job of pending) if (!owned.includes(job)) notOwned.push(job.jobId);
  if (notOwned.length > 0) {
    console.info(`${LOG} 任务 ${notOwned.join("、")} 不是本次访问者发起的（或没有发起人记录），不替别人续跑；等发起人打开蒸馏页，或在审阅页手动继续。`);
  }
  if (owned.length === 0) return { resumed, failed, noModel, skipped, notOwned, settled: Promise.resolve() };

  const generator = await options.resolveGenerator().catch((error: unknown): AutoResumeGeneratorResult => ({
    unavailableMessage: `读取模型配置失败：${error instanceof Error ? error.message : String(error)}`,
  }));
  const generateText = generator.generateText;
  if (!generateText) {
    const explanation = noModelExplanation(generator.unavailableMessage);
    for (const job of owned) {
      const written = await updateUnderLock(bookRoot, job, (current) => ({
        ...settleStyleDistillationJobState(current, false),
        autoResume: { failures: current.autoResume?.failures ?? 0, ...(current.autoResume?.lastAttemptAt ? { lastAttemptAt: current.autoResume.lastAttemptAt } : {}), explanation },
      }), "running");
      if (written) noModel.push(job.jobId);
      else skipped.push(job.jobId);
    }
    if (noModel.length > 0) {
      console.warn(`${LOG} 没有可用模型，未自动续跑任务 ${noModel.join("、")}：${generator.unavailableMessage ?? "未配置服务端模型"}。本进程不再重试。`);
    }
    return { resumed, failed, noModel, skipped, notOwned, settled: Promise.resolve() };
  }

  for (const job of owned) {
    const failures = job.autoResume?.failures ?? 0;
    let run: Promise<unknown>;
    try {
      run = runStyleDistillationBatches({ bookRoot, jobId: job.jobId, generateText, autoResume: true });
    } catch (error) {
      run = Promise.reject(error);
    }
    resumed.push(job.jobId);
    console.info(`${LOG} 自动续跑任务 ${job.jobId}（第 ${failures + 1} 次，上限 ${maxFailures}）。`);
    runs.push(run.then(
      () => console.info(`${LOG} 任务 ${job.jobId} 自动续跑结束。`),
      async (error: unknown) => {
        if (error instanceof StyleDistillationError && error.code === "STYLE_DISTILLATION_BUSY") {
          console.info(`${LOG} 任务 ${job.jobId} 已有别的执行者，跳过自动续跑。`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        const count = failures + 1;
        console.error(`${LOG} 任务 ${job.jobId} 自动续跑失败（连续第 ${count} 次，上限 ${maxFailures}）：${detail}`);
        // 执行中抛错：任务已结算为 paused，不会再被当成孤儿任务自动重试；把原因写进任务，达到上限时标失败。
        const reachedLimit = count >= maxFailures;
        const explanation: StyleDistillationExplanation = reachedLimit
          ? limitExplanation(count)
          : {
            what: `进程重启后自动续跑中断：${message.slice(0, 300)}`,
            why: "自动续跑只在进程重启后尝试；执行中出错时停下，避免在同一错误上反复消耗模型额度。",
            next: "按错误提示处理后，在审阅页点「继续未完成批次」手动继续；已完成的批次结果都保留着。",
          };
        await updateUnderLock(bookRoot, job, (current) => ({
          ...current,
          ...(reachedLimit ? { status: "failed" as const } : {}),
          autoResume: { failures: Math.max(count, current.autoResume?.failures ?? 0), lastAttemptAt: new Date().toISOString(), explanation },
        })).catch((writeError: unknown) => {
          console.error(`${LOG} 任务 ${job.jobId} 写入自动续跑失败原因时出错：${writeError instanceof Error ? writeError.message : String(writeError)}`);
        });
      },
    ));
  }
  return { resumed, failed, noModel, skipped, notOwned, settled: Promise.all(runs).then(() => undefined) };
}
