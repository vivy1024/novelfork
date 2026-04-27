import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsSectionContent } from "./SettingsSectionContent";

afterEach(() => cleanup());

describe("SettingsSectionContent", () => {
  it("shows profile fields with Git identity and an explicit avatar gap", () => {
    render(<SettingsSectionContent sectionId="profile" />);

    expect(screen.getByRole("heading", { name: "个人资料" })).toBeTruthy();
    expect(screen.getByText("Git 用户名")).toBeTruthy();
    expect(screen.getByText("Git 邮箱")).toBeTruthy();
    expect(screen.getByText("头像上传未接入")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "保存个人资料" }).length).toBeGreaterThan(0);
  });

  it("shows model defaults, sub-agent preferences and reasoning settings", () => {
    render(<SettingsSectionContent sectionId="models" />);

    expect(screen.getByRole("heading", { name: "模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "默认模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "摘要模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Explore 子代理模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plan 子代理模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "模型池限制" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "全局推理强度" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Codex 推理强度" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 AI 供应商" })).toBeTruthy();
  });

  it("shows runtime agent controls mapped from RuntimeControlPanel", () => {
    render(<SettingsSectionContent sectionId="agents" />);

    expect(screen.getByRole("heading", { name: "AI 代理" })).toBeTruthy();
    expect(screen.getByText("默认权限模式")).toBeTruthy();
    expect(screen.getByText("每条消息最大轮次")).toBeTruthy();
    expect(screen.getByText("可恢复错误最大重试次数")).toBeTruthy();
    expect(screen.getByText("WebFetch 代理模式")).toBeTruthy();
    expect(screen.getByText("上下文窗口阈值")).toBeTruthy();
    expect(screen.getByText("token 用量 / 输出速率")).toBeTruthy();
    expect(screen.getByText("目录 / 命令白名单黑名单")).toBeTruthy();
    expect(screen.getByText("复用 RuntimeControlPanel")).toBeTruthy();
  });

  it("shows non-provider settings sections with explicit reuse or not-connected status", () => {
    const sections = [
      ["notifications", "通知", "未接入通知配置"],
      ["appearance", "外观与界面", "主题模式"],
      ["server", "服务器与系统", "启动诊断"],
      ["storage", "存储空间", "SQLite 数据库"],
      ["resources", "运行资源", "Admin Resources"],
      ["history", "使用历史", "Admin Requests"],
      ["about", "关于", "版本 / commit / 平台 / 作者"],
    ] as const;

    for (const [sectionId, heading, marker] of sections) {
      cleanup();
      render(<SettingsSectionContent sectionId={sectionId} />);
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
    }
  });
});
