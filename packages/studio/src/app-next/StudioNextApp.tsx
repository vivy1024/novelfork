import { useState } from "react";

import { resolveStudioNextRoute, type StudioNextRoute } from "./entry";
import { NextShell, ResourceWorkspaceLayout, SectionLayout, SettingsLayout } from "./components/layouts";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute;
}

const SETTINGS_SECTIONS = [
  { id: "profile", label: "个人资料", status: "可编辑", group: "个人设置" },
  { id: "models", label: "模型", status: "部分接入", group: "个人设置" },
  { id: "agents", label: "AI 代理", status: "复用运行时", group: "个人设置" },
  { id: "notifications", label: "通知", status: "未接入", group: "个人设置" },
  { id: "appearance", label: "外观与界面", status: "可迁移", group: "个人设置" },
  { id: "providers", label: "AI 供应商", status: "可管理", group: "实例管理" },
  { id: "server", label: "服务器与系统", status: "只读", group: "实例管理" },
  { id: "storage", label: "存储空间", status: "只读", group: "实例管理" },
  { id: "resources", label: "运行资源", status: "只读", group: "实例管理" },
  { id: "history", label: "使用历史", status: "可查看", group: "实例管理" },
  { id: "about", label: "关于", status: "可查看", group: "实例管理" },
] as const;

const ROUTINE_SECTIONS = [
  "命令",
  "可选工具",
  "工具权限",
  "全局技能",
  "项目技能",
  "自定义子代理",
  "全局提示词",
  "系统提示词",
  "MCP 工具",
  "钩子",
] as const;

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());

  return (
    <NextShell activeRoute={activeRoute} onRouteChange={setActiveRoute} status="旧前端冻结，旁路建设中">
      {activeRoute === "workspace" && <WorkspacePage />}
      {activeRoute === "settings" && <SettingsPage />}
      {activeRoute === "routines" && <RoutinesPage />}
    </NextShell>
  );
}

function WorkspacePage() {
  return (
    <SectionLayout title="创作工作台" description="第一主页面：资源管理器、正文编辑器、AI / 经纬面板三栏闭环。">
      <ResourceWorkspaceLayout
        explorer={
          <div className="space-y-4">
            <h2 className="text-base font-semibold">资源管理器</h2>
            <ResourceGroup title="作品" items={["未选择作品"]} action="选择作品" />
            <ResourceGroup title="卷" items={["第一卷：未接入章节树"]} action="创建卷" />
            <ResourceGroup title="已有章节" items={["第 1 章：示例正式章节"]} action="创建章节" />
            <ResourceGroup title="生成章节" items={["AI 候选稿会进入这里，不直接覆盖正文"]} action="生成下一章" />
            <ResourceGroup title="草稿" items={["未定稿片段与章节草稿"]} action="新建草稿" />
            <ResourceGroup title="大纲" items={["主线 / 卷纲 / 章节目标"]} action="打开大纲" />
            <ResourceGroup title="经纬 / 资料库" items={["人物", "地点", "势力", "物品", "伏笔", "世界规则"]} action="创建条目" />
          </div>
        }
        editor={
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-xl font-semibold">正文编辑器</h2>
                <p className="text-sm text-muted-foreground">章节状态：正式正文 · 字数：0 · 保存状态：未修改</p>
              </div>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">保存</button>
            </div>
            <textarea
              aria-label="章节正文"
              className="min-h-[26rem] w-full resize-none rounded-xl border border-border bg-background p-4 leading-7 outline-none focus:ring-2 focus:ring-ring"
              placeholder="打开已有章节后在这里编辑正文；生成稿需先进入候选区。"
            />
            <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
              对照视图占位：优先支持“生成稿 vs 已有章节”。
            </div>
          </div>
        }
        assistant={
          <div className="space-y-4">
            <h2 className="text-base font-semibold">AI / 经纬面板</h2>
            {[
              "生成下一章",
              "续写当前段落",
              "审校当前章",
              "改写选中段落",
              "去 AI 味",
              "连续性检查",
            ].map((label) => (
              <button key={label} className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-muted" type="button">
                {label}
                <span className="ml-2 text-xs text-muted-foreground">输出到候选稿</span>
              </button>
            ))}
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium">相关经纬</div>
              <p className="mt-1 text-muted-foreground">人物、地点、伏笔、前文摘要会按当前章节展示；未关联时提供创建入口。</p>
            </div>
          </div>
        }
      />
    </SectionLayout>
  );
}

function ResourceGroup({ title, items, action }: { readonly title: string; readonly items: readonly string[]; readonly action: string }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button className="text-xs text-primary hover:underline" type="button">{action}</button>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item) => <li key={item} className="rounded-lg bg-muted/40 px-2 py-1">{item}</li>)}
      </ul>
    </section>
  );
}

function SettingsPage() {
  const [sectionId, setSectionId] = useState("models");
  const active = SETTINGS_SECTIONS.find((section) => section.id === sectionId) ?? SETTINGS_SECTIONS[1];

  return (
    <SettingsLayout title="设置" sections={SETTINGS_SECTIONS} activeSectionId={sectionId} onSectionChange={setSectionId}>
      {sectionId === "providers" ? (
        <ProviderSettingsPage />
      ) : (
        <section aria-label="当前设置详情" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatusCard title="分区" value={active.label} />
            <StatusCard title="接入状态" value={active.status} />
            <StatusCard title="交互模式" value="总览 → 详情 → 动作" />
          </div>
          <div className="rounded-xl border border-border p-4">
            <h2 className="text-lg font-semibold">{active.label}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              当前分区遵循 NarraFork 管理型设置范式。已接入项复用旧配置源；未接入项明确显示只读或未接入。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">刷新</button>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">查看详情</button>
              <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">未接入项不会伪造保存</span>
            </div>
          </div>
        </section>
      )}
    </SettingsLayout>
  );
}

function RoutinesPage() {
  return (
    <SectionLayout title="套路" description="保留 NarraFork 固定 AI 专业功能集合，复用旧 Routines API 与类型。">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {ROUTINE_SECTIONS.map((section) => (
          <article key={section} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold">{section}</h2>
            <p className="mt-2 text-sm text-muted-foreground">复用旧 Routines 读写链；缺口明确标记未接入。</p>
            <button className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">
              打开{section}
            </button>
          </article>
        ))}
      </div>
    </SectionLayout>
  );
}

function StatusCard({ title, value }: { readonly title: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
