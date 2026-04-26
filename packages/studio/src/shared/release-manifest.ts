import studioPackageJson from "../../package.json";

export interface ReleaseChannelOption {
  readonly id: "stable" | "beta";
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly current?: boolean;
}

export interface AuthorFacingChangelogItem {
  readonly title: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

export interface StudioReleaseSnapshot {
  readonly appName: string;
  readonly version: string;
  readonly runtime: string;
  readonly runtimeLabel: string;
  readonly buildSource: string;
  readonly buildLabel: string;
  readonly commit: string | null;
  readonly changelogUrl: string;
  readonly summary: string;
  readonly channels: readonly ReleaseChannelOption[];
  readonly changelog: readonly AuthorFacingChangelogItem[];
}

export const STUDIO_PACKAGE_VERSION = studioPackageJson.version;
export const STUDIO_CHANGELOG_URL = "https://github.com/vivy1024/novelfork/releases";

const BASE_CHANNELS: readonly ReleaseChannelOption[] = [
  {
    id: "stable",
    label: "稳定通道",
    description: "默认推荐，适合长期连载、日更与正式写作项目，更新节奏更稳。",
    available: true,
    current: true,
  },
  {
    id: "beta",
    label: "Beta 通道",
    description: "预留给抢先体验桌面更新与平台升级的作者，当前先展示入口与说明，后续再接入可切换通道。",
    available: false,
  },
] as const;

const BASE_CHANGELOG: readonly AuthorFacingChangelogItem[] = [
  {
    title: "版本信息终于说人话了",
    summary: "设置中心现在会直接告诉你这台工作台是谁、跑在什么运行时、来自哪次构建，方便作者和维护者一起排查。",
    highlights: [
      "显示当前版本、运行时、构建来源与可用 commit 摘要。",
      "把稳定 / Beta 通道的节奏先讲清楚，避免升级预期混乱。",
    ],
  },
  {
    title: "更新日志改成作者能读的口径",
    summary: "不是只看技术字段，而是先说明这版会影响什么写作体验、哪些能力已经准备好、哪些入口还在铺路。",
    highlights: [
      "重点解释对写作路径的影响，而不是只罗列底层组件变化。",
      "保留 changelog 入口，方便后续桌面更新接上正式发布说明。",
    ],
  },
] as const;

function normalizeCommit(commit: string | null | undefined): string | null {
  if (!commit) return null;
  const trimmed = commit.trim();
  return trimmed ? trimmed : null;
}

export function createStudioReleaseSnapshot(input: {
  readonly runtime: string;
  readonly runtimeLabel: string;
  readonly buildSource: string;
  readonly buildLabel: string;
  readonly commit?: string | null;
  readonly version?: string;
}): StudioReleaseSnapshot {
  return {
    appName: "NovelFork Studio",
    version: input.version ?? STUDIO_PACKAGE_VERSION,
    runtime: input.runtime,
    runtimeLabel: input.runtimeLabel,
    buildSource: input.buildSource,
    buildLabel: input.buildLabel,
    commit: normalizeCommit(input.commit),
    changelogUrl: STUDIO_CHANGELOG_URL,
    summary: "这一版先把“我现在跑的到底是哪一套工作台”说清楚：作者能一眼看到版本、运行时、构建来源与升级节奏，减少排障和升级时的信息断层。",
    channels: BASE_CHANNELS,
    changelog: BASE_CHANGELOG,
  };
}
