import React from "react";

interface ProviderConfigProps {
  theme: "light" | "dark";
}

export const ProviderConfig = React.memo(function ProviderConfig({ theme }: ProviderConfigProps) {
  const panelClassName = theme === "dark"
    ? "rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-slate-100"
    : "rounded-xl border border-slate-200 bg-white p-6 text-slate-900";

  return (
    <div className="p-6">
      <div className={panelClassName}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">统一模型池</p>
        <h3 className="mt-2 text-lg font-semibold">旧模型供应商配置已停用</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          旧组件曾在浏览器本地维护第二套供应商配置。现在模型与供应商只来自 Studio 的统一运行时模型池，
          请前往新版设置页管理供应商、刷新模型并执行真实连接测试。
        </p>
        <a
          href="/next/settings"
          className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          打开 AI 供应商设置
        </a>
      </div>
    </div>
  );
});
