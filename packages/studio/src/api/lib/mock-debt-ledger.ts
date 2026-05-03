export type MockDebtStatus =
  | "must-replace"
  | "transparent-placeholder"
  | "internal-demo"
  | "confirmed-real"
  | "test-only";

export type MockDebtRisk = "critical" | "high" | "medium" | "low";

export interface MockDebtItem {
  id: string;
  module: string;
  files: string[];
  currentBehavior: string;
  userRisk: MockDebtRisk;
  status: MockDebtStatus;
  targetBehavior: string;
  ownerSpec: string;
  verification: string[];
}

const OWNER_SPEC = "project-wide-real-runtime-cleanup";
const NOVEL_CREATION_WORKBENCH_SPEC = "novel-creation-workbench-complete-flow";

export const MOCK_DEBT_ITEMS = [
  {
    id: "provider-runtime",
    module: "Provider runtime",
    files: [
      "packages/studio/src/api/lib/provider-manager.ts",
      "packages/studio/src/api/routes/providers.ts",
    ],
    currentBehavior: "Provider CRUD、模型刷新、模型测试、Admin provider 列表、Onboarding 模型状态与写作工具 AI gate 均读取 ProviderRuntimeStore / runtime model pool；旧 provider-manager 仅保留为无生产入口引用的兼容类与测试对象。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持 ProviderRuntimeStore / runtime model pool 为唯一生产事实源；provider-manager 不得重新接入生产路由或用户可见 gate。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "provider store 重新实例化后数据仍存在",
      "刷新模型调用 adapter.listModels，模型测试调用 adapter.testModel，API 响应不回传明文密钥",
      "Admin/Onboarding/WritingTools 测试断言读取 runtime store 而不是 providerManager",
    ],
  },
  {
    id: "platform-integrations",
    module: "Platform integrations",
    files: ["packages/studio/src/api/routes/platform-integrations.ts"],
    currentBehavior: "Codex/Kiro JSON 账号导入写入 runtime store，重新实例化后仍可列出；账号缺失或禁用时平台模型池同步过滤；Cline JSON 导入保持 501 unsupported 与透明文案。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持平台账号 JSON 导入持久化、模型池账号过滤与未接入平台 unsupported；新增平台导入能力前不得返回假成功。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "导入 Codex JSON 账号后重新实例化 store 仍能列出账号且 API 不泄露 credentialJson",
      "无账号或禁用账号时模型池不返回对应平台模型",
      "Cline 未接入路径返回 501 unsupported，UI 显示透明占位",
    ],
  },
  {
    id: "runtime-model-pool",
    module: "Runtime model pool",
    files: [
      "packages/studio/src/shared/provider-catalog.ts",
      "packages/studio/src/api/routes/providers.ts",
      "packages/studio/src/components/ChatWindow.tsx",
    ],
    currentBehavior: "/api/providers/models 已从 runtime store 构建统一模型池，并只返回 enabled provider、enabled model 与可用凭据/活跃平台账号组合；shared provider catalog 仅作为设置页模板/类型来源。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持 /api/providers/models 作为唯一运行时模型池；禁用 provider/model、缺凭据 API provider、无活跃账号平台 provider 均不得出现在可用模型池中。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "runtime-model-pool 测试覆盖禁用 provider、禁用 model 与缺凭据 API provider 均被过滤",
      "platform account 测试覆盖无活跃账号时平台模型不返回",
      "ChatWindow/Runtime settings/NewSessionDialog 测试断言模型选项来自 /api/providers/models",
    ],
  },
  {
    id: "session-chat-runtime",
    module: "Session chat runtime",
    files: ["packages/studio/src/api/lib/session-chat-service.ts"],
    currentBehavior: "session-chat-service 已调用 llm runtime service，成功回复来自 provider adapter，失败返回 error envelope 且不生成假 assistant 正文。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持会话发送校验 runtime model pool 并调用 llm runtime；失败返回错误 envelope，成功内容来自上游响应。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "测试断言 assistant 内容来自 llmRuntimeService 返回值",
      "adapter unsupported 或凭据缺失时没有假 assistant 正文",
      "成功响应记录 provider/model/run metadata",
    ],
  },
  {
    id: "legacy-model-ui",
    module: "Legacy model UI",
    files: [
      "packages/studio/src/components/Model/ModelPicker.tsx",
      "packages/studio/src/components/Model/ProviderConfig.tsx",
    ],
    currentBehavior: "旧 ModelPicker 已迁移为 /api/providers/models 客户端；旧 ProviderConfig 只显示停用说明并引导到新版设置页。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持统一模型池为唯一来源；不得恢复浏览器本地供应商配置或本地连接测试。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "ModelPicker 测试断言选项来自 /api/providers/models",
      "ProviderConfig 测试断言旧本地编辑器不可用",
      "静态扫描不再命中 key 长度测试或浏览器本地 provider 配置作为运行时事实源",
    ],
  },
  {
    id: "book-chat-history",
    module: "Book chat history",
    files: ["packages/studio/src/api/routes/chat.ts"],
    currentBehavior: "轻量 book chat 仍使用当前进程内存历史，但 API 响应与 ChatPanel 已明确标注 process-memory / 当前进程临时历史。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "短期保持明确 process-memory 的透明临时面板；后续并入正式 session/message repository。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "持久化路径验证重启后历史仍在",
      "透明临时路径验证 API 与 UI 均标注 persistence: process-memory",
    ],
  },
  {
    id: "pipeline-runs",
    module: "Pipeline runs",
    files: ["packages/studio/src/api/routes/pipeline.ts"],
    currentBehavior: "Pipeline route 仍使用当前进程内存保存 run/stage 状态，但 status/stages/list/SSE 响应已明确标注 process-memory 与当前进程临时运行状态。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "短期保持明确 process-memory 的临时运行状态；后续复用 RunStore 事实流持久化 run/stage/event。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "route 测试覆盖 run 状态来源于持久化 store 或响应包含 process-memory 标记",
      "UI 不暗示临时 run 历史已持久化",
    ],
  },
  {
    id: "monitor-status",
    module: "Monitor status",
    files: ["packages/studio/src/api/routes/monitor.ts"],
    currentBehavior: "/api/monitor/status 在缺少 daemon/runtime 事实源时返回 501 unsupported；Monitor WebSocket 连接后发送 unsupported 并关闭，不再伪造 stopped 或实时日志。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "保持无事实源时返回 unsupported；后续接入真实 daemon/runtime 状态与事件订阅后再恢复实时监控。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "route 测试断言不再固定 200 stopped",
      "unsupported 路径返回 code: unsupported 与 capability",
      "WS 未接入时 UI 或接口语义保持透明",
    ],
  },
  {
    id: "agent-config-service",
    module: "Agent config service",
    files: ["packages/studio/src/api/lib/agent-config-service.ts"],
    currentBehavior: "Agent 配置写入 runtime JSON；资源使用在未接 runtime 事实源时返回 unknown；端口分配会通过本机 listen 探测真实占用并持久化保留端口。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "继续保持配置持久化与真实端口探测；后续接入 worktree/container/run stores 后把资源使用 source 从 unknown 升级为 runtime。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "配置重新实例化后仍存在",
      "端口占用测试证明真实 listen 检测生效",
      "无法获取的资源字段返回 unknown 或 unsupported",
    ],
  },
  {
    id: "admin-users",
    module: "Admin users",
    files: ["packages/studio/src/api/routes/admin.ts", "packages/studio/src/components/Admin/UsersTab.tsx"],
    currentBehavior: "Admin 用户管理已降级为本地单用户透明占位：列表不返回伪用户，CRUD API 返回 501 unsupported，UsersTab 按钮 disabled 并显示未接入说明。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "本地单用户阶段保持用户 CRUD disabled/unsupported；后续如启用多用户系统，必须写入持久化 store/SQLite。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "透明占位路径按钮 disabled 并展示本地单用户说明",
      "若保留 CRUD，测试验证重新实例化后用户仍存在",
    ],
  },
  {
    id: "writing-modes-apply",
    module: "Writing modes apply",
    files: [
      "packages/studio/src/api/routes/writing-modes.ts",
      "packages/studio/src/components/writing-modes/*.tsx",
      "packages/studio/src/app-next/workspace/WorkspacePage.tsx",
    ],
    currentBehavior: "writing modes 生成端点仍可返回 mode: prompt-preview；真实生成结果可通过 Workspace 目标选择与确认流程调用安全 apply route 写入 candidate/draft，章节 insert/replace 会转为非破坏性候选稿；章节钩子插入会写入 pending_hooks.md。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "保持 prompt-preview 透明语义；章节钩子应用必须持续写入 pending_hooks.md 或结构化 hooks repository；真实生成结果必须先确认目标并写入 candidate/draft，正式章节 insert/replace 不得无确认直改正文。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "route/UI 测试覆盖 mode: prompt-preview 或真实生成路径",
      "UI 测试覆盖应用写入或 disabled 状态",
      "route/UI 测试覆盖 hook 应用写入 pending_hooks.md",
      "静态扫描不再命中 Workspace 写作模式 noop 回调",
    ],
  },
  {
    id: "writing-tools-health",
    module: "Writing tools health",
    files: [
      "packages/studio/src/api/routes/writing-tools.ts",
      "packages/studio/src/components/writing-tools/BookHealthDashboard.tsx",
    ],
    currentBehavior: "书籍 health endpoint 返回章节数、总字数、今日字数、敏感词命中数和已登记矛盾数等真实可计算指标；连续性评分从章节审计数据聚合，钩子回收率从 pending_hooks.md 解析，AI 味均值从 filter report 仓库读取，节奏多样性从章节节奏分析计算；数据源不可用时返回 null。",
    userRisk: "critical",
    status: "confirmed-real",
    targetBehavior: "保持真实可计算字段来自文件、写作日志、敏感词扫描和矛盾仓库；四项质量指标从各自真实数据源聚合，数据源不可用时返回 null 而非固定值。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "无审计数据时 consistencyScore 返回 null",
      "有审计数据时 consistencyScore 返回 measured 与真实分数",
      "无伏笔文件时 hookRecoveryRate 返回 null",
      "有 filter report 时 aiTasteMean 返回 measured 与均值",
      "章节不足时 rhythmDiversity 返回 null",
      "UI 将 null 渲染为暂无数据",
    ],
  },
  {
    id: "ai-complete-streaming",
    module: "Inline completion streaming",
    files: ["packages/studio/src/api/routes/ai.ts"],
    currentBehavior: "接口先拿完整 LLM 结果，再按 4 字切片发送 SSE，payload 已明确标注 streamSource: chunked-buffer，不再伪装为上游原生流式。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "未接原生流式前保持 streamSource: chunked-buffer 透明标注；接入后直接透传上游 chunk。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "SSE payload 包含 streamSource: chunked-buffer",
      "UI 不将 chunked-buffer 描述为真实上游流式",
    ],
  },
  {
    id: "tool-usage-example",
    module: "Tool usage demo",
    files: ["packages/studio/src/components/ToolUsageExample.tsx"],
    currentBehavior: "组件保留为明确的内部 Demo / Mock 示例，不从生产组件 barrel 导出；executeToolMock() 仅用于展示 ToolUseCard/ToolResultCard/PermissionPrompt 交互。",
    userRisk: "critical",
    status: "internal-demo",
    targetBehavior: "保持 internal-demo 明确标注；生产入口不得引用该示例，真实工具执行 UI 必须调用 tool executor。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "生产入口无 ToolUsageExample 引用",
      "若保留，路径或 UI 明确 demo/mock 且 ledger 状态为 internal-demo",
    ],
  },
  {
    id: "transparent-admin-placeholders",
    module: "Transparent admin placeholders",
    files: [
      "packages/studio/src/components/Admin/ContainerTab.tsx",
      "packages/studio/src/components/Admin/ResourcesTab.tsx",
      "packages/studio/src/components/Admin/WorktreesTab.tsx",
      "packages/studio/src/app-next/routines/RoutinesNextPage.tsx",
      "packages/studio/src/app-next/dashboard/DashboardPage.tsx",
      "packages/studio/src/app-next/settings/providers/PlatformAccountTable.tsx",
      "packages/studio/src/app-next/settings/providers/PlatformIntegrationCard.tsx",
      "packages/studio/src/app-next/settings/providers/PlatformIntegrationDetail.tsx",
    ],
    currentBehavior: "Container、Worktree terminal/container、Resources 缺失字段、Routines hooks、Dashboard URL 导入、平台账号 future actions 与 Cline import 均使用 UnsupportedCapability 或等价透明占位；未接入按钮保持 disabled。",
    userRisk: "medium",
    status: "transparent-placeholder",
    targetBehavior: "保持统一 UnsupportedCapability 口径，所有未接入按钮 disabled 并展示原因；后续接入真实运行时或 API 后再恢复交互。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "UI 测试断言未接入按钮 disabled",
      "页面展示明确未接入或当前进程临时状态文案",
      "未接入 API 返回 unsupported 而非 200 success",
    ],
  },
  {
    id: "core-missing-file-sentinel",
    module: "Core missing file sentinel",
    files: ["packages/core/src/**"],
    currentBehavior: "Core 中的“(文件尚未创建)”用于表示缺文件哨兵；生产源码扫描仅命中 config-loader 的 noop-model，测试确认它只在 requireApiKey=false 的非真实配置加载中注入。",
    userRisk: "low",
    status: "confirmed-real",
    targetBehavior: "保留缺文件哨兵；保持 noop-model 仅用于 requireApiKey=false 的非真实调用路径，真实 LLM 配置缺 key 时继续报错。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "静态扫描将 Core 生产命中限制在低风险哨兵/noop-model 口径内",
      "config-loader 测试确认默认真实路径缺 key 会报错，只有 requireApiKey=false 才注入 noop-model",
    ],
  },
  {
    id: "cli-production-source",
    module: "CLI production source",
    files: ["packages/cli/src/**"],
    currentBehavior: "当前 CLI 生产源码扫描未发现 mock 债务；CLI __tests__ 下的 mock/spy/fake timer 仅用于测试，不纳入产品债务。",
    userRisk: "low",
    status: "confirmed-real",
    targetBehavior: "保持扫描确认；后续 CLI 生产源码若新增高风险命中必须追加 ledger，测试目录 mock 继续由扫描器排除。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "生产源码 mock scan 不发现 CLI 命中",
      "测试目录 mock 不作为产品债务处理",
    ],
  },
  {
    id: "publish-readiness-continuity-placeholder",
    module: "Publish readiness continuity metrics",
    files: [
      "packages/core/src/compliance/publish-readiness.ts",
      "packages/studio/src/api/routes/compliance.ts",
    ],
    currentBehavior: "发布检查已接入敏感词、AI 比例、格式检查和章节审计连续性事实源；有 auditIssues 时返回 passed/has-issues 与可追溯指标，缺少事实源或格式异常时返回 unknown。",
    userRisk: "medium",
    status: "confirmed-real",
    targetBehavior: "保持连续性指标来自真实章节审计事实源；无事实源时继续 unknown，禁止固定成功。",
    ownerSpec: NOVEL_CREATION_WORKBENCH_SPEC,
    verification: [
      "core publish readiness 测试覆盖有审计数据、缺失数据和异常格式",
      "studio compliance route 测试覆盖章节 auditIssues 传入 publish readiness",
      "mock debt scan 不再登记连续性未接入文案",
    ],
  },
  {
    id: "workspace-outline-bible-placeholders",
    module: "Workspace outline and bible fallback placeholders",
    files: [
      "packages/studio/src/app-next/workspace/resource-view-registry.tsx",
    ],
    currentBehavior: "Workspace 大纲编辑器和经纬分类视图已接入真实 bookId/endpoint 时可读取和保存；缺少 bookId 或分类映射时显示 UnsupportedCapability，避免伪造保存或编辑成功。",
    userRisk: "medium",
    status: "transparent-placeholder",
    targetBehavior: "保持缺少事实上下文时 disabled/unsupported；后续补齐 bookId 与分类映射后再启用真实读写，不得返回假成功。",
    ownerSpec: NOVEL_CREATION_WORKBENCH_SPEC,
    verification: [
      "resource view 测试覆盖大纲/经纬真实路径或 unsupported 透明路径",
      "缺少 bookId 或分类映射时显示 UnsupportedCapability",
      "mock debt scan 将暂未接入文案登记为透明占位",
    ],
  },
] as const satisfies readonly MockDebtItem[];

export function listMockDebtItems(items: readonly MockDebtItem[] = MOCK_DEBT_ITEMS): MockDebtItem[] {
  return items.map((item) => ({ ...item, files: [...item.files], verification: [...item.verification] }));
}

export function getMockDebtItem(id: string, items: readonly MockDebtItem[] = MOCK_DEBT_ITEMS): MockDebtItem | undefined {
  const item = items.find((candidate) => candidate.id === id);
  return item ? { ...item, files: [...item.files], verification: [...item.verification] } : undefined;
}

export function updateMockDebtItemStatus(
  id: string,
  status: MockDebtStatus,
  items: readonly MockDebtItem[] = MOCK_DEBT_ITEMS,
): MockDebtItem[] {
  if (!items.some((item) => item.id === id)) {
    throw new Error(`Unknown mock debt item: ${id}`);
  }

  return items.map((item) =>
    item.id === id
      ? { ...item, status, files: [...item.files], verification: [...item.verification] }
      : { ...item, files: [...item.files], verification: [...item.verification] },
  );
}
