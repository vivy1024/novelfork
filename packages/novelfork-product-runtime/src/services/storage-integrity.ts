import type { StorageDatabase } from "@vivy1024/novelfork-core";

/**
 * B2：启动完整性检查（T-23）的消费者。
 *
 * `core` 在建连时跑一次 `PRAGMA integrity_check` 并把结果挂在 `storage.startupIntegrity` 上
 * （健康为 `"ok"`，损坏为首条错误描述，检查本身失败为错误信息，内存库为 `undefined`）。
 * 在此之前**没有任何生产代码读它**——检查白做了：库已经损坏时产品照常启动、照常让作者写，
 * 作者只会看到零散的报错，不知道整库已经不可信、更不知道该先备份再修。
 *
 * 这里把「记录 + 告警」补齐，并且**刻意不阻断启动**（与 core 的取舍一致）：
 * 库损坏时最需要的是让作者进得来，把书导出去；直接拒绝启动会把唯一能救数据的界面关在门外。
 *
 * 所有告警都带三段式 explanation（发生了什么 / 为什么要看 / 建议怎么做），
 * 与产品层其余拦截、告警保持同一口径。
 */

export interface StorageIntegrityExplanation {
  /** 客观发生了什么（不带评价） */
  readonly whatHappened: string;
  /** 为什么值得关注（影响什么） */
  readonly whyItMatters: string;
  /** 建议的下一步动作 */
  readonly suggestedAction: string;
}

export interface StorageIntegrityAlert {
  readonly code: "STORAGE_INTEGRITY_DAMAGED";
  readonly kind: "persistent";
  readonly storagePath: string;
  /** SQLite 给出的原始报告，不加工、不截断成一句「数据库坏了」。 */
  readonly report: string;
  readonly explanation: StorageIntegrityExplanation;
}

/** 只有字符串且不是 "ok" 才算损坏；`undefined`（内存库）与 `"ok"` 都不告警。 */
export function isDamagedIntegrityReport(report: string | undefined): boolean {
  return typeof report === "string" && report.trim() !== "" && report !== "ok";
}

export function explainDamagedStorageIntegrity(
  storagePath: string,
  report: string,
): StorageIntegrityExplanation {
  return {
    whatHappened: `启动时对 ${storagePath} 做了完整性检查，SQLite 报告这份库已损坏：${report}`,
    whyItMatters:
      "这份库保存的是作品书目、章节索引、经纬设定与叙事记忆。库损坏时读到的内容可能缺行或整表读不出来，继续写作会把新内容写进一份已经不可信的库，越写越难恢复。",
    suggestedAction:
      "先停止写作并把「我的作品」里的书导出成档案（导出只读原文，不依赖库表完整）；再把整份数据目录复制一份留档，然后从备份目录恢复或重装后再导入。不要直接删除这份库——它是目前唯一的数据来源。",
  };
}

/**
 * 消费一次 startupIntegrity：损坏时返回告警，健康或内存库返回 null。
 * 只负责判断与措辞，不自己打日志，方便调用方决定往哪里报（也方便测试）。
 */
export function checkStartupStorageIntegrity(storage: StorageDatabase): StorageIntegrityAlert | null {
  const report = storage.startupIntegrity;
  if (!isDamagedIntegrityReport(report)) return null;
  return {
    code: "STORAGE_INTEGRITY_DAMAGED",
    kind: "persistent",
    storagePath: storage.databasePath,
    report: report as string,
    explanation: explainDamagedStorageIntegrity(storage.databasePath, report as string),
  };
}
