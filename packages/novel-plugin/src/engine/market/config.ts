export const PARSER_VERSION = "0.1.0";

export const REQUEST_DELAY_MS = { min: 2_000, max: 5_000 } as const;
export const DETAIL_DELAY_MS = { min: 3_000, max: 6_000 } as const;
export const BACKOFF_DELAY_MS = { initial: 10_000, max: 20_000 } as const;
export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_PAGES_PER_RANK = 5;
export const CONSECUTIVE_403_THRESHOLD = 3;
export const MAX_RANKS_PER_PLATFORM_SCAN = 2;
export const MAX_BOOKS_PER_RANK_SCAN = 200;
export const MAX_PUBLIC_CHAPTER_SAMPLES = 3;
export const SNAPSHOT_RETENTION_DAYS = 30;
/** 超过这个天数的快照不再当「最新榜」用，只能当历史参考。 */
export const SNAPSHOT_FRESH_DAYS = 2;

export const PLATFORM_LABEL: Record<"qidian" | "fanqie", string> = {
  qidian: "起点",
  fanqie: "番茄",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform as "qidian" | "fanqie"] ?? platform;
}

export function rankLabel(rankType: string, lookup?: ReadonlyMap<string, RankSourceConfig>): string {
  return lookup?.get(rankType)?.name
    ?? [...QIDIAN_RANKS, ...FANQIE_RANKS].find((rank) => rank.key === rankType)?.name
    ?? rankType;
}

export function sourceLabel(platform: string, rankType: string, rankNames?: ReadonlyMap<string, string>): string {
  return `${platformLabel(platform)} · ${rankNames?.get(rankType) ?? rankLabel(rankType)}`;
}

export const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
] as const;

export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

export const FANQIE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const FANQIE_RANK_API_UA =
  "Dalvik/2.1.0 (Linux; U; Android 10; SM-G975F Build/QP1A.190711.020) com.ss.android.article.news/831";

export const QIDIAN_BASE = "https://www.qidian.com";
export const QIDIAN_MOBILE = "https://m.qidian.com";
export const FANQIE_BASE = "https://fanqienovel.com";

export interface RankSourceConfig {
  readonly key: string;
  readonly url: string;
  readonly mobileUrl: string;
  readonly name: string;
}

export const QIDIAN_RANKS: ReadonlyArray<RankSourceConfig> = [
  {
    key: "sanjiang",
    name: "三江推荐",
    url: "https://www.qidian.com/rank/sanjiang/",
    mobileUrl: "https://m.qidian.com/sanjiang/",
  },
  {
    key: "strong",
    name: "强推榜",
    url: "https://www.qidian.com/rank/strong/",
    mobileUrl: "https://m.qidian.com/strongrec/",
  },
  {
    key: "newbook",
    name: "新书榜",
    url: "https://www.qidian.com/rank/newbook/",
    mobileUrl: "https://m.qidian.com/rank/newbook/",
  },
  {
    key: "hotsales",
    name: "畅销榜",
    url: "https://www.qidian.com/rank/hotsales/",
    mobileUrl: "https://m.qidian.com/rank/hotsales/",
  },
];

export const FANQIE_RANKS: ReadonlyArray<RankSourceConfig> = [
  {
    key: "male_read",
    name: "男频阅读榜",
    url: "https://fanqienovel.com/rank/1_2",
    mobileUrl: "https://fanqienovel.com/rank/1_2",
  },
  {
    key: "male_new",
    name: "男频新书榜",
    url: "https://fanqienovel.com/rank/1_1",
    mobileUrl: "https://fanqienovel.com/rank/1_1",
  },
  {
    key: "female_read",
    name: "女频阅读榜",
    url: "https://fanqienovel.com/rank/0_2",
    mobileUrl: "https://fanqienovel.com/rank/0_2",
  },
  {
    key: "female_new",
    name: "女频新书榜",
    url: "https://fanqienovel.com/rank/0_1",
    mobileUrl: "https://fanqienovel.com/rank/0_1",
  },
];

export const ALL_RANKS: ReadonlyMap<string, RankSourceConfig> = new Map(
  [...QIDIAN_RANKS, ...FANQIE_RANKS].map((r) => [r.key, r]),
);

export function lookupRank(key: string): RankSourceConfig | undefined {
  return ALL_RANKS.get(key);
}
