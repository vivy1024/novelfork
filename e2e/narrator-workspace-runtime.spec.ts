import { expect, type Page, test } from "@playwright/test";

function uniqueUsername(): string {
	return `workspace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createStandaloneNarrator(
	page: Page,
	title: string,
): Promise<string> {
	return page.evaluate(async (input) => {
		const response = await fetch("/api/narrators", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chapterId: null, type: "primary" }),
		});
		const narrator = (await response.json()) as { id: string; status?: string };
		if (!response.ok || !narrator.id)
			throw new Error(`创建叙述者失败：${response.status}`);
		const rename = await fetch(
			`/api/narrators/${encodeURIComponent(narrator.id)}/title`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: input }),
			},
		);
		if (!rename.ok) throw new Error(`重命名叙述者失败：${rename.status}`);
		return narrator.id;
	}, title);
}

async function createBookNarrator(
	page: Page,
	title: string,
): Promise<{ bookId: string; narratorId: string }> {
	return page.evaluate(async (input) => {
		const response = await fetch("/api/novelfork/books", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": `workspace-book-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			},
			body: JSON.stringify({ title: input }),
		});
		const operation = (await response.json()) as {
			state?: string;
			bookId?: string;
			narratorId?: string;
		};
		if (
			!response.ok ||
			operation.state !== "ready" ||
			!operation.bookId ||
			!operation.narratorId
		) {
			throw new Error(
				`创建书籍叙述者失败：${response.status} ${operation.state}`,
			);
		}
		return { bookId: operation.bookId, narratorId: operation.narratorId };
	}, title);
}

async function upsertRecent(
	page: Page,
	input: {
		type: "narrator" | "chapter";
		id: string;
		narratorId: string;
		title: string;
		lastVisitedAt: number;
	},
) {
	await page.evaluate(async (tab) => {
		const response = await fetch("/api/user-preferences/recent-tabs", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(tab),
		});
		if (!response.ok)
			throw new Error(`写入 recent tab 失败：${response.status}`);
	}, input);
}

async function recentTabKeys(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const response = await fetch("/api/user-preferences");
		if (!response.ok)
			throw new Error(`读取 recent tabs 失败：${response.status}`);
		const preferences = (await response.json()) as {
			recentTabs?: Array<{ type: string; id: string }>;
		};
		return (preferences.recentTabs ?? []).map((tab) => `${tab.type}:${tab.id}`);
	});
}

async function waitForNarrator(page: Page, narratorId: string) {
	const panel = page.getByTestId("native-runtime-narrator-panel");
	await expect(panel).toHaveAttribute("data-narrator-id", narratorId, {
		timeout: 30_000,
	});
	await expect(panel.locator("textarea").first()).toBeVisible({
		timeout: 30_000,
	});
}

async function verifyChapterToolEntrypoints(page: Page): Promise<void> {
	const panel = page.getByTestId("native-runtime-narrator-panel");
	const containerButton = panel
		.locator("button:visible")
		.filter({ has: page.locator("svg.tabler-icon-package") })
		.first();
	await expect(containerButton).toBeVisible();
	const health = await page.evaluate(async () => {
		const response = await fetch("/api/health");
		return (await response.json()) as {
			runtimeEnvironment?: { containerSupport?: boolean };
		};
	});
	const containersSupported =
		health.runtimeEnvironment?.containerSupport === true;
	if (containersSupported) {
		await containerButton.click();
		await expect(page.getByRole("dialog")).toContainText(/容器|Container/);
		await page.keyboard.press("Escape");
	} else {
		await expect(containerButton).toBeDisabled();
	}

	const browserButton = panel
		.locator("button:visible")
		.filter({ has: page.locator("svg.tabler-icon-world-www") })
		.first();
	await expect(browserButton).toBeVisible();
	await browserButton.click();
	await expect(
		panel
			.locator("p")
			.filter({ hasText: /^(浏览器|Browser)$/ })
			.last(),
	).toBeVisible();
	await browserButton.click();
}

async function clickVisibleIconButton(
	page: Page,
	iconClass: string,
): Promise<void> {
	const panel = page.getByTestId("native-runtime-narrator-panel");
	const button = panel
		.locator("button:visible")
		.filter({ has: page.locator(`svg.${iconClass}`) })
		.first();
	await expect(button).toBeVisible();
	await button.click();
}

test("隔离 Runtime narrator 真实挂载原生 Dock 并打开终端面板", async ({
	page,
}) => {
	await page.goto("/login");
	const createAccountButton = page.getByRole("button", {
		name: "没有账户？创建账户",
	});
	if (await createAccountButton.count()) await createAccountButton.click();
	await expect(page.getByRole("heading", { name: "创建账户" })).toBeVisible();
	await page.getByLabel("用户名").fill(uniqueUsername());
	await page.getByLabel("密码").fill("Narrator-tools-password-123!");
	await page.getByRole("button", { name: "创建并登录" }).click();
	await expect(page.getByTestId("agent-shell-route")).toBeVisible({
		timeout: 30_000,
	});

	const narratorId = await createStandaloneNarrator(
		page,
		`终端 Dock 验证-${Date.now()}`,
	);
	try {
		await page.goto(`/next/narrators/${encodeURIComponent(narratorId)}`);
		await waitForNarrator(page, narratorId);
		await expect(
			page.locator(".dockview-theme-narrafork:visible").first(),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("textbox", { name: "Send a message..." }),
		).toBeVisible({ timeout: 30_000 });
		await clickVisibleIconButton(page, "tabler-icon-terminal");
		const emptyTerminalState = page.getByText("No terminals");
		await expect(emptyTerminalState).toBeVisible({ timeout: 10_000 });
		const newTerminalButton = emptyTerminalState
			.locator("xpath=..")
			.locator("button")
			.first();
		await expect(newTerminalButton).toBeVisible();
		await newTerminalButton.click();
		// NarratorTerminal only renders xterm panels for Runtime terminals whose
		// server-side status is running, so this proves the real terminal path.
		await expect(page.locator(".xterm-screen")).toBeVisible({
			timeout: 60_000,
		});
		await expect(page.locator(".xterm-helper-textarea")).toBeVisible({
			timeout: 10_000,
		});
	} finally {
		await page.evaluate(async (id) => {
			const response = await fetch(
				`/api/terminals?narratorId=${encodeURIComponent(id)}`,
			);
			if (!response.ok) return;
			const terminals = (await response.json()) as Array<{ id?: string }>;
			await Promise.all(
				terminals
					.filter(
						(terminal): terminal is { id: string } =>
							typeof terminal.id === "string",
					)
					.map((terminal) =>
						fetch(`/api/terminals/${encodeURIComponent(terminal.id)}`, {
							method: "DELETE",
						}),
					),
			);
		}, narratorId);
	}
});

test("隔离 Runtime 的 Narrator 外层工作区支持桌面恢复与 390px 移动切换", async ({
	page,
}) => {
	await page.goto("/login");
	// An isolated Runtime starts with no users, so the auth surface may already
	// be in registration mode. Only toggle when the login form is shown.
	const createAccountButton = page.getByRole("button", {
		name: "没有账户？创建账户",
	});
	if (await createAccountButton.count()) await createAccountButton.click();
	await expect(page.getByRole("heading", { name: "创建账户" })).toBeVisible();
	await page.getByLabel("用户名").fill(uniqueUsername());
	await page.getByLabel("密码").fill("Narrator-workspace-password-123!");
	await page.getByRole("button", { name: "创建并登录" }).click();
	await expect(page.getByTestId("agent-shell-route")).toBeVisible({
		timeout: 30_000,
	});

	const suffix = Date.now();
	const titleA = `最近会话甲-${suffix}`;
	const titleB = `最近会话乙-${suffix}`;
	const bookTitle = `书籍工作区-${suffix}`;
	const narratorA = await createStandaloneNarrator(page, titleA);
	const narratorB = await createStandaloneNarrator(page, titleB);
	const book = await createBookNarrator(page, bookTitle);

	await upsertRecent(page, {
		type: "narrator",
		id: narratorA,
		narratorId: narratorA,
		title: titleA,
		lastVisitedAt: 10,
	});
	await upsertRecent(page, {
		type: "chapter",
		id: `book-tab-${suffix}`,
		narratorId: book.narratorId,
		title: bookTitle,
		lastVisitedAt: 20,
	});
	await upsertRecent(page, {
		type: "narrator",
		id: narratorB,
		narratorId: narratorB,
		title: titleB,
		lastVisitedAt: 30,
	});

	await page.goto(`/next/narrators/${encodeURIComponent(narratorA)}`);
	await waitForNarrator(page, narratorA);
	const sidebar = page.getByTestId("shell-sidebar");
	await expect(sidebar).toContainText(titleA);
	await expect(sidebar).toContainText(titleB);

	const dragSource = sidebar
		.locator('[draggable="true"]')
		.filter({ hasText: titleB });
	const dragTarget = sidebar
		.locator('[draggable="true"]')
		.filter({ hasText: titleA });
	await dragSource.dragTo(dragTarget);
	await expect
		.poll(async () => {
			const keys = await recentTabKeys(page);
			return (
				keys.indexOf(`narrator:${narratorB}`) <
				keys.indexOf(`narrator:${narratorA}`)
			);
		})
		.toBe(true);

	await sidebar.getByRole("button", { name: `置顶最近项 ${titleA}` }).click();
	await expect
		.poll(async () => (await recentTabKeys(page))[0])
		.toBe(`narrator:${narratorA}`);

	await page.getByRole("button", { name: "打开会话抽屉" }).click();
	const desktopDrawer = page.getByTestId("narrator-workspace-drawer");
	await expect(desktopDrawer).toBeVisible();
	await expect(desktopDrawer).toContainText(bookTitle);
	await desktopDrawer
		.locator('section[aria-label="最近标签"]')
		.getByRole("button", { name: new RegExp(`^${titleB} 独立叙述者$`) })
		.click();
	await expect(page).toHaveURL(new RegExp(`/next/narrators/${narratorB}$`));
	await waitForNarrator(page, narratorB);

	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/next/narrators/${narratorA}$`));
	await waitForNarrator(page, narratorA);
	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/next/narrators/${narratorB}$`));
	await waitForNarrator(page, narratorB);
	await page.reload();
	await waitForNarrator(page, narratorB);
	await page.keyboard.press("Control+ArrowUp");
	await expect(page).toHaveURL(new RegExp(`/next/narrators/${narratorA}$`));
	await waitForNarrator(page, narratorA);
	await page.screenshot({
		path: ".test-data/narrator-workspace-browser/desktop.png",
		fullPage: true,
	});

	await page.goto(`/next/narrators/${encodeURIComponent(book.narratorId)}`);
	await waitForNarrator(page, book.narratorId);
	await verifyChapterToolEntrypoints(page);

	await page.goto("/next/narrators/not-a-real-narrator");
	await expect(page).toHaveURL(/\/next\/sessions$/, { timeout: 30_000 });

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/next/narrators/${encodeURIComponent(narratorB)}`);
	await waitForNarrator(page, narratorB);
	const mobileConversation = page.getByTestId("native-runtime-narrator-panel");
	await mobileConversation.evaluate((element) => {
		element.setAttribute("data-workspace-identity", "preserved");
	});
	await page
		.locator('[data-slot="mobile-shell-header"]')
		.getByRole("button", { name: "打开会话抽屉" })
		.click();
	const mobileDrawer = page.getByTestId("narrator-workspace-drawer");
	await expect(mobileDrawer).toBeVisible();
	await expect(mobileConversation).toHaveAttribute(
		"data-workspace-identity",
		"preserved",
	);
	await expect(mobileConversation).toBeAttached();
	await mobileDrawer
		.locator('section[aria-label="最近标签"]')
		.getByRole("button", { name: new RegExp(`^${bookTitle} 书籍 ·`) })
		.click();
	await expect(page).toHaveURL(
		new RegExp(`/next/narrators/${book.narratorId}$`),
	);
	await waitForNarrator(page, book.narratorId);
	await page
		.locator('[data-slot="mobile-shell-header"]')
		.getByRole("button", { name: "打开会话抽屉" })
		.click();
	await expect(page.getByTestId("narrator-workspace-drawer")).toContainText(
		"书籍 ·",
	);
	await page.screenshot({
		path: ".test-data/narrator-workspace-browser/mobile-390.png",
		fullPage: true,
	});
});
