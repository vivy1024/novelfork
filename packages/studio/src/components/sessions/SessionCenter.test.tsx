import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import type {
	RuntimeNarratorClient,
	RuntimeNarratorRecord,
} from "@/app-next/runtime/runtime-narrator-client";
import { SessionCenter } from "./SessionCenter";

const active = narrator({
	id: "narrator-active",
	title: "世界观规划室",
	status: "working",
	working: true,
	pinned: true,
	substatus: ["unread", "planning"],
	activeTerminalCount: 2,
	containerCount: 3,
	runningContainerCount: 1,
	viewers: [
		{
			userId: "user-1",
			username: "作者",
			avatarColor: null,
			avatarImageId: null,
		},
	],
});
const archived = narrator({
	id: "narrator-archived",
	title: "旧会话摘要",
	status: "archived",
});

function narrator(
	overrides: Partial<RuntimeNarratorRecord> = {},
): RuntimeNarratorRecord {
	return {
		id: "narrator-1",
		chapterId: null,
		type: "primary",
		variant: "primary",
		title: "独立叙述者",
		model: "sub2api:gpt-5.6",
		reasoningEffort: "high",
		permissionMode: "acceptEdits",
		planMode: false,
		cwd: "D:\\novels\\demo",
		status: "idle",
		substatus: [],
		traits: ["standalone"],
		messageCount: 7,
		activeTerminalCount: 0,
		containerCount: 0,
		runningContainerCount: 0,
		viewers: [],
		createdAt: "2026-07-15T01:00:00.000Z",
		updatedAt: "2026-07-15T02:00:00.000Z",
		lastMessageAt: "2026-07-15T02:00:00.000Z",
		errorMessage: null,
		pinned: false,
		lastVisitedAt: null,
		working: false,
		unread: false,
		binding: { kind: "standalone" },
		...overrides,
	};
}

function createClient(): RuntimeNarratorClient {
	return {
		listNarrators: vi.fn(async (options) =>
			options?.status === "archived" ? [archived] : [active],
		),
		getNarrator: vi.fn(async () => active),
		getRecentTabs: vi.fn(async () => []),
		createNarrator: vi.fn(async () => active),
		renameNarrator: vi.fn(async () => undefined),
		forkLatestNarrator: vi.fn(async () =>
			narrator({ id: "narrator-fork", title: "世界观规划室 Fork" }),
		),
		archiveNarrator: vi.fn(async () => undefined),
		unarchiveNarrator: vi.fn(async () => undefined),
		deleteNarrator: vi.fn(async () => undefined),
		openNarrator: vi.fn(async () => undefined),
		setNarratorPinned: vi.fn(async () => undefined),
		continueLatestNarrator: vi.fn(async () => active),
	};
}

beforeAll(() => {
	(
		window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }
	).scrollIntoView = vi.fn();
	(
		window.HTMLElement.prototype as unknown as {
			hasPointerCapture: () => boolean;
		}
	).hasPointerCapture = vi.fn(() => false);
	(
		window.HTMLElement.prototype as unknown as {
			releasePointerCapture: () => void;
		}
	).releasePointerCapture = vi.fn();
});

let client: RuntimeNarratorClient;

beforeEach(() => {
	client = createClient();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("SessionCenter", () => {
	it("renders canonical Runtime narrator details and opens it", async () => {
		const onOpenNarrator = vi.fn();
		render(<SessionCenter client={client} onOpenNarrator={onOpenNarrator} />);

		const row = await screen.findByTestId("session-center-row-narrator-active");
		expect(row.textContent).toContain("世界观规划室");
		expect(row.textContent).toContain("工作中");
		expect(row.textContent).toContain("sub2api:gpt-5.6");
		expect(row.textContent).toContain("自动接受编辑");
		expect(row.textContent).toContain("已固定");
		expect(row.textContent).toContain("Unread");
		expect(row.textContent).toContain("Planning");
		expect(row.textContent).toContain("终端：2");
		expect(row.textContent).toContain("容器：1/3");
		expect(row.textContent).toContain("在线查看者：1");

		fireEvent.click(within(row).getByRole("button", { name: "打开" }));
		await waitFor(() =>
			expect(client.openNarrator).toHaveBeenCalledWith(active),
		);
		expect(onOpenNarrator).toHaveBeenCalledWith("narrator-active");
	});

	it("renames, pins, forks, and archives through Runtime lifecycle methods", async () => {
		const onOpenNarrator = vi.fn();
		render(<SessionCenter client={client} onOpenNarrator={onOpenNarrator} />);
		const row = await screen.findByTestId("session-center-row-narrator-active");

		fireEvent.click(within(row).getByRole("button", { name: "重命名" }));
		fireEvent.change(screen.getByLabelText("新标题"), {
			target: { value: "新标题" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(client.renameNarrator).toHaveBeenCalledWith(
				"narrator-active",
				"新标题",
			),
		);

		fireEvent.click(within(row).getByRole("button", { name: "取消固定" }));
		await waitFor(() =>
			expect(client.setNarratorPinned).toHaveBeenCalledWith(active, false),
		);

		fireEvent.click(within(row).getByRole("button", { name: "Fork" }));
		fireEvent.change(screen.getByLabelText("Fork 标题"), {
			target: { value: "支线叙述者" },
		});
		fireEvent.click(screen.getByRole("button", { name: "创建 Fork" }));
		await waitFor(() =>
			expect(client.forkLatestNarrator).toHaveBeenCalledWith(
				"narrator-active",
				{ title: "支线叙述者", inheritMode: "full" },
			),
		);
		expect(onOpenNarrator).toHaveBeenCalledWith("narrator-fork");

		fireEvent.click(within(row).getByRole("button", { name: "归档" }));
		expect(screen.getByRole("dialog").textContent).toContain("归档叙述者？");
		fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
		await waitFor(() =>
			expect(client.archiveNarrator).toHaveBeenCalledWith("narrator-active"),
		);
	});

	it("restores and permanently deletes archived narrators", async () => {
		render(<SessionCenter client={client} onOpenNarrator={vi.fn()} />);
		fireEvent.pointerDown(screen.getByLabelText("叙述者状态"), {
			button: 0,
			ctrlKey: false,
			pointerType: "mouse",
		});
		fireEvent.click(await screen.findByRole("option", { name: "已归档" }));

		const row = await screen.findByTestId(
			"session-center-row-narrator-archived",
		);
		fireEvent.click(within(row).getByRole("button", { name: "恢复" }));
		fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
		await waitFor(() =>
			expect(client.unarchiveNarrator).toHaveBeenCalledWith(
				"narrator-archived",
			),
		);

		fireEvent.click(within(row).getByRole("button", { name: "永久删除" }));
		fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
		await waitFor(() =>
			expect(client.deleteNarrator).toHaveBeenCalledWith("narrator-archived"),
		);
	});

	it("continues the most recently visited Runtime narrator", async () => {
		const onOpenNarrator = vi.fn();
		render(<SessionCenter client={client} onOpenNarrator={onOpenNarrator} />);

		fireEvent.click(await screen.findByRole("button", { name: "继续最近" }));

		await waitFor(() =>
			expect(client.continueLatestNarrator).toHaveBeenCalledOnce(),
		);
		expect(client.openNarrator).toHaveBeenCalledWith(active);
		expect(onOpenNarrator).toHaveBeenCalledWith("narrator-active");
	});

	it("protects server-marked book narrators from lifecycle controls", async () => {
		const book = narrator({
			id: "book-narrator",
			title: "书籍创作助手",
			binding: {
				kind: "novel.book",
				bookId: "book-owned",
				capabilities: {
					read: true,
					send: true,
					update: false,
					delete: false,
					create: false,
					interrupt: false,
				},
			},
		});
		const protectedClient = {
			...client,
			listNarrators: vi.fn(async () => [book]),
		};
		render(<SessionCenter client={protectedClient} onOpenNarrator={vi.fn()} />);

		const row = await screen.findByTestId("session-center-row-book-narrator");
		expect(row.textContent).toContain("书籍叙述者·受保护");
		expect(within(row).queryByRole("button", { name: "归档" })).toBeNull();
		expect(within(row).queryByRole("button", { name: "Fork" })).toBeNull();
		expect(within(row).queryByRole("button", { name: "重命名" })).toBeNull();
		expect(within(row).queryByRole("checkbox")).toBeNull();
	});

	it("confirms and executes an independent batch archive", async () => {
		render(<SessionCenter client={client} onOpenNarrator={vi.fn()} />);
		const row = await screen.findByTestId("session-center-row-narrator-active");
		fireEvent.click(
			within(row).getByRole("checkbox", { name: "选择 世界观规划室" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "归档选中项" }));
		expect(screen.getByRole("dialog").textContent).toContain(
			"批量归档叙述者？",
		);
		fireEvent.click(screen.getByRole("button", { name: "批量归档" }));
		await waitFor(() =>
			expect(client.archiveNarrator).toHaveBeenCalledWith("narrator-active"),
		);
	});

	it("offers both restore and delete batch actions for archived independent narrators", async () => {
		render(<SessionCenter client={client} onOpenNarrator={vi.fn()} />);
		fireEvent.pointerDown(screen.getByLabelText("叙述者状态"), {
			button: 0,
			ctrlKey: false,
			pointerType: "mouse",
		});
		fireEvent.click(await screen.findByRole("option", { name: "已归档" }));
		const row = await screen.findByTestId(
			"session-center-row-narrator-archived",
		);
		fireEvent.click(
			within(row).getByRole("checkbox", { name: "选择 旧会话摘要" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "恢复选中项" }));
		expect(screen.getByRole("dialog").textContent).toContain(
			"批量恢复叙述者？",
		);
		fireEvent.click(screen.getByRole("button", { name: "批量恢复" }));
		await waitFor(() =>
			expect(client.unarchiveNarrator).toHaveBeenCalledWith(
				"narrator-archived",
			),
		);
	});

	it("surfaces Runtime lifecycle failures", async () => {
		const errorClient = {
			...client,
			archiveNarrator: vi.fn(async () => {
				throw new Error("Runtime denied");
			}),
		};
		render(<SessionCenter client={errorClient} onOpenNarrator={vi.fn()} />);
		const row = await screen.findByTestId("session-center-row-narrator-active");
		fireEvent.click(within(row).getByRole("button", { name: "归档" }));
		fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
		expect(await screen.findByText(/归档失败/)).toBeTruthy();
	});
});
