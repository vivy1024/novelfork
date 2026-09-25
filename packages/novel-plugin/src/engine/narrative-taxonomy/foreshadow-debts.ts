/**
     * 伏笔债务算法与定义（独立领域纯函数）。
     *
     * 从 UI 组件中剥离，成为全书叙事结构聚合读模型的一级产物。
     * 组件只负责渲染，计算逻辑与判定口径统一在此收口。
     */

    export type ForeshadowDebtStatus = "planted" | "triggered" | "paid_off" | "unknown";
    export type ForeshadowDebtUrgency = "ok" | "watch" | "overdue";

    export interface ForeshadowDebt {
      readonly id: string;
      readonly title: string;
      readonly entryId: string;
      readonly plantedChapter?: number;
      readonly payoffChapter?: number;
      readonly status: ForeshadowDebtStatus;
      /** 已悬置章数（仅未回收且有埋设章时给出）。 */
      readonly chaptersPending?: number;
      readonly urgency: ForeshadowDebtUrgency;
      /** 给作者看的一句话理由。 */
      readonly reason: string;
    }

    export interface ForeshadowJingweiEntryLike {
      readonly id: string;
      readonly title?: string;
      readonly fields?: Record<string, unknown> | null;
      readonly lifecycle?: string;
      readonly status?: string;
      readonly relatedChapterNumbers?: readonly unknown[];
    }

    /** 伏笔悬置警戒线（章）。作者未在书籍设置里改过时使用。 */
    export const DEBT_WATCH_CHAPTERS = 5;
    export const DEBT_OVERDUE_CHAPTERS = 12;

    /**
     * 伏笔债务阈值：悬置达到 watchChapters 进入「临近」，达到 overdueChapters 判「超期」。
     * 节奏快慢因书而异，由作者在书籍设置里决定，存于 book.json 的 foreshadowDebtThresholds。
     */
    export interface ForeshadowDebtThresholds {
      readonly watchChapters: number;
      readonly overdueChapters: number;
    }

    export const DEFAULT_FORESHADOW_DEBT_THRESHOLDS: ForeshadowDebtThresholds = {
      watchChapters: DEBT_WATCH_CHAPTERS,
      overdueChapters: DEBT_OVERDUE_CHAPTERS,
    };

    /** 阈值允许的章数上限；再大就等于关掉提醒，不如直接不看。 */
    export const FORESHADOW_THRESHOLD_MAX_CHAPTERS = 1000;

    export type ForeshadowThresholdCheck =
      | { readonly ok: true; readonly value: ForeshadowDebtThresholds }
      | { readonly ok: false; readonly explanation: string };

    function isChapterCount(value: unknown): value is number {
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= FORESHADOW_THRESHOLD_MAX_CHAPTERS;
    }

    /** 校验作者填写的阈值；书籍设置界面与保存接口共用这一条规则。 */
    export function checkForeshadowDebtThresholds(raw: unknown): ForeshadowThresholdCheck {
      const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const watch = value.watchChapters;
      const overdue = value.overdueChapters;
      if (!isChapterCount(watch) || !isChapterCount(overdue)) {
        return {
          ok: false,
          explanation: `两个阈值都要填 1～${FORESHADOW_THRESHOLD_MAX_CHAPTERS} 之间的整数章数。它们决定伏笔悬置多少章后开始提醒、多少章后判为超期。`,
        };
      }
      if (watch >= overdue) {
        return {
          ok: false,
          explanation: `「临近提醒」（${watch} 章）必须小于「超期」（${overdue} 章），否则伏笔会直接跳过临近提醒被判超期。请把临近提醒调小，或把超期调大。`,
        };
      }
      return { ok: true, value: { watchChapters: watch, overdueChapters: overdue } };
    }

    /** 把 book.json 里的原始值解析成可用阈值；缺省或不合法时回到默认值，不让坏配置关掉提醒。 */
    export function resolveForeshadowDebtThresholds(raw: unknown): ForeshadowDebtThresholds {
      const checked = checkForeshadowDebtThresholds(raw);
      return checked.ok ? checked.value : DEFAULT_FORESHADOW_DEBT_THRESHOLDS;
    }

    function text(value: unknown): string {
      return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    }

    function toChapter(value: unknown): number | undefined {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
      return parsed;
    }

    function chapterFromTitle(title: string | undefined): number | undefined {
      if (!title) return undefined;
      const match = /第\s*(\d+)\s*章/u.exec(title);
      return match ? toChapter(match[1]) : undefined;
    }

    function fields(entry: ForeshadowJingweiEntryLike): Record<string, unknown> {
      return entry.fields && typeof entry.fields === "object" ? entry.fields : {};
    }

    export function trimTitle(value: string | undefined, maxLength = 28): string {
      const normalized = text(value);
      if (!normalized) return "未命名";
      return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
    }

    /**
     * 伏笔状态：只认白名单枚举值。
     * 脏值/缺失 → 用 payoffChapter / plantedChapter 二次推断，推不出记 unknown。
     */
    export function resolveDebtStatus(entry: ForeshadowJingweiEntryLike): ForeshadowDebtStatus {
      const raw = text(fields(entry).status).toLowerCase();
      if (raw === "paid_off" || raw === "paid-off" || raw === "resolved") return "paid_off";
      if (raw === "triggered" || raw === "paying_off" || raw === "唤醒中") return "triggered";
      if (raw === "planted" || raw === "open" || raw === "pending" || raw === "reinforced") return "planted";
      const payoff = toChapter(fields(entry).payoffChapter);
      if (payoff !== undefined) return "paid_off";
      const planted = toChapter(fields(entry).plantedChapter);
      if (planted !== undefined) return "planted";
      return "unknown";
    }

    export function debtUrgency(
      status: ForeshadowDebtStatus,
      chaptersPending: number | undefined,
      thresholds: ForeshadowDebtThresholds = DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
    ): ForeshadowDebtUrgency {
      if (status === "paid_off") return "ok";
      if (status === "triggered") return "overdue";
      if (chaptersPending === undefined) return "watch";
      if (chaptersPending >= thresholds.overdueChapters) return "overdue";
      if (chaptersPending >= thresholds.watchChapters) return "watch";
      return "ok";
    }

    export function debtReason(
      status: ForeshadowDebtStatus,
      plantedChapter: number | undefined,
      payoffChapter: number | undefined,
      chaptersPending: number | undefined,
    ): string {
      if (status === "paid_off") {
        return payoffChapter !== undefined ? `已在第 ${payoffChapter} 章回收` : "已标记回收";
      }
      if (status === "triggered") {
        return "触发条件已满足，尚未兑现——本章应推进或回收";
      }
      if (status === "unknown") {
        return "状态未标注，无法判断是否已回收——建议补一次状态";
      }
      if (plantedChapter === undefined) return "已埋设，但没有记录埋在第几章";
      if (chaptersPending === undefined) return `埋于第 ${plantedChapter} 章`;
      if (chaptersPending <= 0) return `刚埋于第 ${plantedChapter} 章`;
      return `埋于第 ${plantedChapter} 章，已悬 ${chaptersPending} 章未回收`;
    }

    export function buildForeshadowDebts(
      entries: readonly ForeshadowJingweiEntryLike[],
      currentChapter: number,
      thresholds: ForeshadowDebtThresholds = DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
    ): ForeshadowDebt[] {
      const debts: ForeshadowDebt[] = [];
      for (const entry of entries) {
        if (entry.lifecycle === "archived" || entry.lifecycle === "retired") continue;
        const f = fields(entry);
        const plantedChapter = toChapter(f.plantedChapter) ?? chapterFromTitle(entry.title);
        const payoffChapter = toChapter(f.payoffChapter);
        const status = resolveDebtStatus(entry);
        const chaptersPending =
          status !== "paid_off" && plantedChapter !== undefined
            ? Math.max(0, currentChapter - plantedChapter)
            : undefined;
        debts.push({
          id: `debt:${entry.id}`,
          title: trimTitle(entry.title, 34),
          entryId: entry.id,
          ...(plantedChapter !== undefined ? { plantedChapter } : {}),
          ...(payoffChapter !== undefined ? { payoffChapter } : {}),
          status,
          ...(chaptersPending !== undefined ? { chaptersPending } : {}),
          urgency: debtUrgency(status, chaptersPending, thresholds),
          reason: debtReason(status, plantedChapter, payoffChapter, chaptersPending),
        });
      }
      const urgencyRank: Record<ForeshadowDebtUrgency, number> = { overdue: 0, watch: 1, ok: 2 };
      return debts.sort(
        (left, right) =>
          urgencyRank[left.urgency] - urgencyRank[right.urgency] ||
          (right.chaptersPending ?? -1) - (left.chaptersPending ?? -1) ||
          left.title.localeCompare(right.title),
      );
    }
