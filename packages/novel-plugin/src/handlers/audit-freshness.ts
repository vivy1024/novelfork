/**
 * 审计新鲜度 —— 判断「这份检查结果是不是针对当前正文的」。
 *
 * 场景：第 5 章写完、审计通过，然后作者手动改了正文（删两段、改个人名）。
 * 此时数据库里那条 "continuityPassed: true" 依然存在，系统会以为这章没问题。
 * 实际上那份结论是对旧正文下的，已经失效。
 *
 * 判据很简单：正文最后修改时间晚于审计时间，则审计过期。
 * 不需要阈值、不需要作者配置，也不拦写作 —— 只是如实说明「这份结论不能算」。
 */

export type AuditFreshness = "fresh" | "stale" | "never-audited" | "unknown";

export interface AuditFreshnessInput {
  /** 正文最后修改时间（章节索引 updatedAt 或文件 mtime）。 */
  readonly chapterUpdatedAt?: string | number | Date | null;
  /** 审计写入时间（chapter_audit_log.auditedAt）。 */
  readonly auditedAt?: string | number | Date | null;
  /**
   * 容差毫秒。审计与保存几乎同时发生，时钟精度或写入顺序可能让
   * 正文时间比审计时间晚几毫秒，不该因此判过期。
   */
  readonly toleranceMs?: number;
}

export interface AuditFreshnessResult {
  readonly freshness: AuditFreshness;
  /** 正文比审计新了多少毫秒；仅 stale 时有意义。 */
  readonly driftMs: number;
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

/** 默认容差：保存与审计同批完成时的正常抖动。 */
const DEFAULT_TOLERANCE_MS = 5_000;

function toMillis(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function checkAuditFreshness(input: AuditFreshnessInput): AuditFreshnessResult {
  const chapterAt = toMillis(input.chapterUpdatedAt);
  const auditAt = toMillis(input.auditedAt);
  const tolerance = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;

  if (auditAt === null) {
    return {
      freshness: "never-audited",
      driftMs: 0,
      whatHappened: "这一章还没有审计记录。",
      whyItMatters: "没有审计就没有连续性与事实核查结论，问题要到读者或后续章节才暴露。",
      suggestedAction: "对这一章跑一次 chapter.audit。",
    };
  }

  if (chapterAt === null) {
    return {
      freshness: "unknown",
      driftMs: 0,
      whatHappened: "拿不到这一章正文的最后修改时间，无法判断审计是否仍然有效。",
      whyItMatters: "不能确认结论对应的是当前正文，只能当作未验证处理。",
      suggestedAction: "确认章节索引里有 updatedAt；必要时重跑一次审计以获得确定结论。",
    };
  }

  const drift = chapterAt - auditAt;
  if (drift > tolerance) {
    return {
      freshness: "stale",
      driftMs: drift,
      whatHappened: `正文在审计之后又被修改过（晚 ${formatDrift(drift)}）。`,
      whyItMatters: "现有审计结论是对修改前的正文得出的。它显示「通过」并不代表当前正文没问题。",
      suggestedAction: "重新跑 chapter.audit，再据新结论决定是否需要修订。",
    };
  }

  return {
    freshness: "fresh",
    driftMs: drift,
    whatHappened: "审计结论对应当前正文。",
    whyItMatters: "正文在审计之后没有再改动，结论仍然有效。",
    suggestedAction: "无需动作。",
  };
}

function formatDrift(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} 秒`;
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

/** 批量判定：返回需要重跑审计的章号。 */
export function listStaleChapters(
  entries: readonly {
    readonly chapterNumber: number;
    readonly chapterUpdatedAt?: string | number | Date | null;
    readonly auditedAt?: string | number | Date | null;
  }[],
  toleranceMs?: number,
): readonly { readonly chapterNumber: number; readonly result: AuditFreshnessResult }[] {
  return entries
    .map((entry) => ({
      chapterNumber: entry.chapterNumber,
      result: checkAuditFreshness({
        chapterUpdatedAt: entry.chapterUpdatedAt,
        auditedAt: entry.auditedAt,
        ...(toleranceMs === undefined ? {} : { toleranceMs }),
      }),
    }))
    .filter((item) => item.result.freshness === "stale");
}
