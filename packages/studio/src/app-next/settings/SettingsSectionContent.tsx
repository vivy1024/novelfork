import type { ReactNode } from "react";

interface SettingsSectionContentProps {
  readonly sectionId: string;
  readonly onSectionChange?: (sectionId: string) => void;
}

interface MetricItem {
  readonly title: string;
  readonly value: string;
  readonly description?: string;
}

interface ActionItem {
  readonly title: string;
  readonly status: string;
  readonly description: string;
  readonly action?: string;
}

interface SettingsSectionDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly metrics: readonly MetricItem[];
  readonly items: readonly ActionItem[];
  readonly footer?: ReactNode;
}

const SETTINGS_SECTION_DEFINITIONS: Record<string, SettingsSectionDefinition> = {
  profile: {
    id: "profile",
    title: "个人资料",
    description: "迁移旧 ProfilePanel 的 Git 身份配置；头像上传暂未接入时明确标注。",
    source: "复用 ProfilePanel / /api/settings/user",
    metrics: [
      { title: "身份字段", value: "4", description: "姓名、邮箱、Git 用户名、Git 邮箱" },
      { title: "头像上传", value: "未接入", description: "头像上传未接入，不伪造成功" },
      { title: "保存链路", value: "已映射", description: "复用旧用户设置 API" },
    ],
    items: [
      { title: "Git 用户名", status: "可编辑", description: "用于 Git 提交作者名，来自旧个人资料面板。", action: "保存个人资料" },
      { title: "Git 邮箱", status: "可编辑", description: "用于 Git 提交邮箱，来自旧个人资料面板。", action: "保存个人资料" },
      { title: "头像上传未接入", status: "未接入", description: "等待头像存储与上传 API，当前只显示状态。" },
    ],
  },
  models: {
    id: "models",
    title: "模型",
    description: "展示默认模型、摘要模型、子代理偏好、模型池限制和推理强度，并连接 AI 供应商模型列表入口。",
    source: "复用 provider catalog / provider settings API / RuntimeControlPanel model defaults",
    metrics: [
      { title: "默认模型", value: "已映射", description: "运行时默认模型配置入口" },
      { title: "摘要模型", value: "已映射", description: "摘要/压缩任务使用模型" },
      { title: "模型列表", value: "供应商页", description: "模型启用、测试、上下文长度在 AI 供应商中管理" },
    ],
    items: [
      { title: "默认模型", status: "可查看", description: "复用运行时模型默认值，不新建模型 store。" },
      { title: "摘要模型", status: "可查看", description: "用于摘要、压缩与上下文管理。" },
      { title: "Explore 子代理模型", status: "可查看", description: "对应 Explore agent 模型偏好。" },
      { title: "Plan 子代理模型", status: "可查看", description: "对应 Plan agent 模型偏好。" },
      { title: "模型池限制", status: "可查看", description: "展示各类子代理可用模型池上限。" },
      { title: "全局推理强度", status: "可查看", description: "通用推理强度默认值。" },
      { title: "Codex 推理强度", status: "可查看", description: "Codex 模式的默认 thinking strength。", action: "打开 AI 供应商" },
    ],
  },
  agents: {
    id: "agents",
    title: "AI 代理",
    description: "迁移 RuntimeControlPanel 的权限、恢复、上下文、调试和请求行为配置。",
    source: "复用 RuntimeControlPanel",
    metrics: [
      { title: "权限模式", value: "已映射", description: "默认 allow/ask/deny 口径" },
      { title: "恢复/重试", value: "已映射", description: "可恢复错误与退避策略" },
      { title: "调试观测", value: "已映射", description: "Dump 请求、token 与输出速率" },
    ],
    items: [
      { title: "默认权限模式", status: "可查看", description: "会话默认权限策略。" },
      { title: "每条消息最大轮次", status: "可查看", description: "限制 agent 单轮最大迭代。" },
      { title: "可恢复错误最大重试次数", status: "可查看", description: "失败恢复与重试上限。" },
      { title: "重试退避时间上限", status: "可查看", description: "请求失败后的退避上限。" },
      { title: "WebFetch 代理模式", status: "可查看", description: "网页抓取时的代理选择策略。" },
      { title: "上下文窗口阈值", status: "可查看", description: "触发压缩/降级的上下文阈值。" },
      { title: "token 用量 / 输出速率", status: "可查看", description: "复用 AI 请求观测数据。" },
      { title: "目录 / 命令白名单黑名单", status: "可查看", description: "复用工具权限与命令规则。" },
    ],
  },
  notifications: {
    id: "notifications",
    title: "通知",
    description: "通知配置尚未接入后端，当前只显示状态与后续入口。",
    source: "未接入通知配置",
    metrics: [
      { title: "桌面通知", value: "未接入" },
      { title: "任务完成提醒", value: "未接入" },
      { title: "错误提醒", value: "未接入" },
    ],
    items: [
      { title: "未接入通知配置", status: "未接入", description: "等待通知权限与偏好 API。" },
    ],
  },
  appearance: {
    id: "appearance",
    title: "外观与界面",
    description: "迁移旧 AppearancePanel 的主题与字体配置，保留短路径操作。",
    source: "复用 AppearancePanel / /api/settings/theme",
    metrics: [
      { title: "主题模式", value: "浅色 / 深色 / 自动" },
      { title: "字体大小", value: "12-20" },
      { title: "保存链路", value: "已映射" },
    ],
    items: [
      { title: "主题模式", status: "可编辑", description: "浅色、深色、跟随系统。", action: "保存外观设置" },
      { title: "字体大小", status: "可编辑", description: "复用旧用户偏好设置。", action: "保存外观设置" },
    ],
  },
  server: {
    id: "server",
    title: "服务器与系统",
    description: "复用平台升级后的启动诊断、运行时信息、自愈动作与系统状态。",
    source: "Admin Resources / startup diagnostics",
    metrics: [
      { title: "启动诊断", value: "可查看" },
      { title: "运行时信息", value: "可查看" },
      { title: "自愈动作", value: "可触发" },
    ],
    items: [
      { title: "启动诊断", status: "可查看", description: "显示 unclean shutdown、静态资源、provider availability 等诊断项。", action: "刷新诊断" },
      { title: "运行时信息", status: "只读", description: "Bun / Vite / 静态资源来源 / 项目根目录。" },
      { title: "自愈动作", status: "可触发", description: "复用 Admin Resources 的修复入口。", action: "打开资源管理" },
    ],
  },
  storage: {
    id: "storage",
    title: "存储空间",
    description: "展示 SQLite、作品目录、会话存储与索引状态；危险清理动作暂不接入。",
    source: "Admin Resources / SQLite storage diagnostics",
    metrics: [
      { title: "SQLite 数据库", value: "可查看" },
      { title: "作品目录", value: "可查看" },
      { title: "清理动作", value: "只读" },
    ],
    items: [
      { title: "SQLite 数据库", status: "只读", description: "复用 storage.sqlite 诊断与数据库路径信息。" },
      { title: "会话存储", status: "可查看", description: "显示孤儿历史、会话索引与恢复状态。" },
      { title: "危险清理", status: "未接入", description: "不伪造删除/清理成功，后续需单独确认。" },
    ],
  },
  resources: {
    id: "resources",
    title: "运行资源",
    description: "复用 Admin Resources 的资源扫描、运行任务、WebSocket 状态与刷新动作。",
    source: "Admin Resources",
    metrics: [
      { title: "资源扫描", value: "可刷新" },
      { title: "运行任务", value: "可查看" },
      { title: "WebSocket", value: "可查看" },
    ],
    items: [
      { title: "Admin Resources", status: "复用", description: "查看 live runs、资源占用与工作区状态。", action: "刷新资源" },
      { title: "启动健康", status: "可查看", description: "复用 startup recovery report。" },
    ],
  },
  history: {
    id: "history",
    title: "使用历史",
    description: "复用 AI request observability，查看请求历史、token、TTFT、成本与 run 关联。",
    source: "Admin Requests",
    metrics: [
      { title: "请求历史", value: "可查看" },
      { title: "token 用量", value: "可查看" },
      { title: "TTFT / 成本", value: "可查看" },
    ],
    items: [
      { title: "Admin Requests", status: "复用", description: "请求列表、provider 过滤、run drilldown。", action: "刷新历史" },
      { title: "AI request observability", status: "复用", description: "不新建日志统计系统。" },
    ],
  },
  about: {
    id: "about",
    title: "关于",
    description: "复用 ReleaseOverview 的版本、commit、平台、作者向更新信息。",
    source: "ReleaseOverview / /api/settings/release",
    metrics: [
      { title: "版本 / commit / 平台 / 作者", value: "可查看" },
      { title: "更新日志", value: "入口已映射" },
      { title: "构建来源", value: "可查看" },
    ],
    items: [
      { title: "版本 / commit / 平台 / 作者", status: "可查看", description: "复用发布快照，不手写版本事实。" },
      { title: "更新日志", status: "可打开", description: "指向 ReleaseOverview 提供的 changelog 入口。", action: "查看更新日志" },
    ],
  },
};

export function SettingsSectionContent({ sectionId, onSectionChange }: SettingsSectionContentProps) {
  const definition = SETTINGS_SECTION_DEFINITIONS[sectionId] ?? SETTINGS_SECTION_DEFINITIONS.models;

  return (
    <section aria-label={`${definition.title}设置`} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{definition.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{definition.description}</p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">{definition.source}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {definition.metrics.map((metric) => (
          <article key={`${definition.id}:${metric.title}`} className="rounded-xl border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground">{metric.title}</div>
            <div className="mt-1 font-semibold">{metric.value}</div>
            {metric.description && <p className="mt-1 text-xs text-muted-foreground">{metric.description}</p>}
          </article>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {definition.items.map((item) => (
          <article key={`${definition.id}:${item.title}`} className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{item.status}</span>
            </div>
            {item.action && (
              <button
                className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
                type="button"
                onClick={() => item.action === "打开 AI 供应商" ? onSectionChange?.("providers") : undefined}
              >
                {item.action}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
