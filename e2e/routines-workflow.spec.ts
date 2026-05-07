import { expect, test } from "@playwright/test";

test("/next/routines exposes release workflow groups without fake current claims", async ({ page }) => {
  await page.goto("/next/routines");

  await expect(page.getByRole("heading", { name: "套路" })).toBeVisible();
  await expect(page.getByText("管理技能、命令和 MCP 工具。")).toBeVisible();

  const routineNav = page.getByRole("tablist", { name: "套路分区" });
  for (const label of ["命令", "可选工具", "工具权限", "全局技能", "项目技能", "自定义子代理", "全局提示词", "系统提示词", "MCP 工具", "钩子"]) {
    await expect(routineNav.getByRole("tab", { name: new RegExp(label) })).toBeVisible();
  }

  await routineNav.getByRole("tab", { name: /命令/ }).click();
  await expect(page.getByRole("button", { name: "添加命令" })).toBeVisible();

  await routineNav.getByRole("tab", { name: /可选工具/ }).click();
  await expect(page.getByPlaceholder("搜索工具...")).toBeVisible();

  await routineNav.getByRole("tab", { name: /工具权限/ }).click();
  await expect(page.getByText("Bash 命令规则")).toBeVisible();
  await expect(page.getByText("MCP 工具权限")).toBeVisible();

  await routineNav.getByRole("tab", { name: /项目技能/ }).click();
  await expect(page.getByText("当前分区：项目技能")).toBeVisible();

  await routineNav.getByRole("tab", { name: /自定义子代理/ }).click();
  await expect(page.getByRole("button", { name: "添加子代理" })).toBeVisible();

  await routineNav.getByRole("tab", { name: /MCP 工具/ }).click();
  await expect(page.getByRole("heading", { name: "MCP Server 管理" })).toBeVisible();
  await expect(page.getByText("策略来源：")).toBeVisible();

  await routineNav.getByRole("tab", { name: /钩子/ }).click();
  await expect(page.getByRole("heading", { name: "生命周期钩子" })).toBeVisible();

  await expect(page.getByText(/UnsupportedCapability|假 current|mock current/)).toHaveCount(0);
});
