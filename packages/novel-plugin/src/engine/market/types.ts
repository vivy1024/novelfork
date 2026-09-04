// ─── Publication / Market Record Types ─────────────────────────────────────

/**
 * The canonical snapshot snapshot of a single book at a single observation point.
 * Client/Writer collect these; Analysis modules consume them.
 */
export interface RankRecord {
  readonly platform: "qidian" | "fanqie";
  readonly book_id: string;
  readonly rank_type: string;
  readonly category: string;
  readonly rank: number;
  readonly title: string;
  readonly author: string;
  /** YYYY-MM-DD */
  readonly observed_at: string;
  readonly source_status: "ok" | "parse_fail" | "empty";
  /** bumped whenever the platform page structure changes; downstream parsers must record it */
  readonly parser_version: string;
  readonly font_decoded?: boolean;
  readonly word_count?: number;
  readonly intro?: string;
}

/**
 * One complete snapshot for a market: one platform × one rank type × one date.
 * Serialized to `.novelfork/market/snapshots/{platform}-{rank_type}-{date}.json`.
 */
export interface BookSnapshot {
  readonly snapshot_id: string;
  readonly platform: "qidian" | "fanqie";
  readonly rank_type: string;
  readonly observed_at: string;
  readonly parser_version: string;
  readonly records: ReadonlyArray<RankRecord>;
}

/** A snapshot's presence is drawn from cross-list aggregation. */
export interface RankAppearance {
  readonly rank_type: string;
  readonly rank: number;
}

export interface PublicChapterSample {
  readonly book_id: string;
  readonly chapter_id: string;
  readonly title: string;
  readonly chapter_word_count: number;
  readonly paragraph_count: number;
  readonly dialogue_ratio: number;
  readonly question_mark_count: number;
  readonly exclamation_mark_count: number;
  readonly system_word_hits: number;
  readonly conflict_word_hits: number;
  readonly golden_finger_hits: number;
  readonly structural_summary: string;
}

export interface AnalysisReport {
  readonly platform: string;
  readonly generated_at: string;
  readonly summary: {
    readonly total_books: number;
    readonly total_snapshots: number;
    readonly top_categories: readonly string[];
  };
  readonly markdown: string;
}

export interface MarketFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly delay?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  readonly maxPages?: number;
  readonly proxy?: string;
  /** 自定义番茄榜（非内置 4 榜）跳过 rank/category API 兜底，只依赖页面 __INITIAL_STATE__。 */
  readonly allowApiFallback?: boolean;
}
