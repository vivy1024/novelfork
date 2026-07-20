import { describe, expect, test } from "bun:test";
import {
	buildLegacySessionSummary,
	type LegacyMessageRow,
	type LegacySessionRow,
} from "./legacy-session-migration";

const session: LegacySessionRow = {
	id: "active-session",
	created_at: 1_700_000_000_000,
	updated_at: 1_700_000_100_000,
	message_count: 3,
	config_json: "{}",
	metadata_json: JSON.stringify({
		title: "活跃旧会话",
		status: "active",
		projectId: "旧书籍",
	}),
	deleted_at: null,
};

describe("legacy NovelFork session migration", () => {
	test("creates a deterministic summary and excludes Runtime progress noise", () => {
		const messages: LegacyMessageRow[] = [
			{
				seq: 1,
				role: "user",
				content: "请规划世界观",
				timestamp: 1_700_000_000_001,
				metadata_json: "{}",
			},
			{
				seq: 2,
				role: "assistant",
				content: "正在调用工具",
				timestamp: 1_700_000_000_002,
				metadata_json: JSON.stringify({ type: "tool_progress" }),
			},
			{
				seq: 3,
				role: "assistant",
				content: "已完成世界观规划，核心冲突是灵潮与秩序。",
				timestamp: 1_700_000_000_003,
				metadata_json: "{}",
			},
		];

		const summary = buildLegacySessionSummary(session, messages);
		expect(buildLegacySessionSummary(session, messages)).toBe(summary);
		expect(summary).toContain("# 旧 NovelFork 会话迁移摘要");
		expect(summary).toContain("标题：活跃旧会话");
		expect(summary).toContain("用户：请规划世界观");
		expect(summary).toContain("助手结论：已完成世界观规划，核心冲突是灵潮与秩序。");
		expect(summary).not.toContain("正在调用工具");
	});

	test("bounds oversized migrated summaries", () => {
		const messages: LegacyMessageRow[] = Array.from({ length: 20 }, (_, index) => ({
			seq: index + 1,
			role: index % 2 === 0 ? "user" : "assistant",
			content: `${index % 2 === 0 ? "用户目标" : "助手结论"}${index}:${"长文本".repeat(2_000)}`,
			timestamp: 1_700_000_200_000 + index,
			metadata_json: "{}",
		}));

		const summary = buildLegacySessionSummary({ ...session, id: "archived-session" }, messages);
		expect(summary.length).toBeLessThanOrEqual(48 * 1024);
		expect(summary).toContain("……中间迁移摘要已截断……");
	});
});
