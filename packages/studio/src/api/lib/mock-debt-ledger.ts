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

export const MOCK_DEBT_ITEMS = [
  {
    id: "provider-runtime",
    module: "Provider runtime",
    files: [
      "packages/studio/src/api/lib/provider-manager.ts",
      "packages/studio/src/api/routes/providers.ts",
    ],
    currentBehavior: "Provider 与 model 状态由内存 Map 维护，刷新模型不请求上游，测试模型只检查 apiKey 是否存在。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "Provider CRUD、模型刷新、模型测试写入持久化 runtime store，并通过 adapter 访问真实上游；未支持能力返回 unsupported。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "provider store 重新实例化后数据仍存在",
      "刷新模型调用 adapter.listModels",
      "测试模型调用 adapter.testModel 且 API 响应不回传明文密钥",
    ],
  },
  {
    id: "platform-integrations",
    module: "Platform integrations",
    files: ["packages/studio/src/api/routes/platform-integrations.ts"],
    currentBehavior: "Codex/Kiro 等平台账号保存在 route 级内存数组，重启后丢失；Cline 后续接入路径可能误导为已导入。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "平台账号 JSON 导入写入 runtime store；账号缺失、禁用或删除时模型池同步过滤；未接入平台返回 unsupported。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "导入账号后重新实例化 store 仍能列出账号",
      "禁用账号后模型池不返回对应平台模型",
      "Cline 未接入路径返回 unsupported 或透明占位",
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
    currentBehavior: "静态 provider catalog 被当作运行时真实模型池，不能反映用户配置、账号状态或模型禁用状态。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "/api/providers/models 成为唯一运行时模型池，只返回 enabled provider、enabled model 与可用凭据/账号组合。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "禁用 provider 后模型池移除其模型",
      "禁用 model 后模型池移除该模型",
      "shared provider catalog 仅作为 seed/template 使用",
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
    currentBehavior: "writing modes endpoint 已标注 mode: prompt-preview，相关 UI 显示 Prompt 预览/复制 prompt/执行生成未接入；Workspace 写作模式应用按钮在无安全写入目标时 disabled 并显示原因；章节钩子插入会写入 pending_hooks.md。",
    userRisk: "critical",
    status: "transparent-placeholder",
    targetBehavior: "保持 prompt-preview 与 disabled 透明语义；章节钩子应用必须持续写入 pending_hooks.md 或结构化 hooks repository；后续新增真实 generate/apply 时必须定位章节文件/编辑器并写入目标。",
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
    files: ["packages/studio/src/api/routes/writing-tools.ts"],
    currentBehavior: "书籍 health endpoint 返回固定默认值与满分指标，像真实评分但实际未计算。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "真实可计算字段返回真实值；暂不能计算字段返回 unknown 或隐藏，禁止固定 consistencyScore: 100。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "无数据时不返回固定满分",
      "未知指标以 unknown 状态呈现",
      "UI 不把 unknown 渲染为真实健康评分",
    ],
  },
  {
    id: "ai-complete-streaming",
    module: "Inline completion streaming",
    files: ["packages/studio/src/api/routes/ai.ts"],
    currentBehavior: "接口先拿完整 LLM 结果，再按 4 字切片模拟 SSE streaming。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "未接原生流式前标注 streamSource: chunked-buffer；接入后直接透传上游 chunk。",
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
    currentBehavior: "组件内 executeToolMock() 模拟工具执行，若进入生产入口会误导用户。",
    userRisk: "critical",
    status: "must-replace",
    targetBehavior: "删除未使用组件，或移入 demo-only 并明确 internal-demo；生产入口不得引用。",
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
      "packages/studio/src/app-next/settings/providers/PlatformAccountTable.tsx",
      "packages/studio/src/app-next/settings/providers/PlatformIntegrationCard.tsx",
      "packages/studio/src/app-next/settings/providers/PlatformIntegrationDetail.tsx",
    ],
    currentBehavior: "部分页面已说明未接入，但文案与按钮状态分散，缺少统一 UnsupportedCapability 口径。",
    userRisk: "medium",
    status: "transparent-placeholder",
    targetBehavior: "统一使用 UnsupportedCapability 或等价组件，所有未接入按钮 disabled 并展示原因。",
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
    currentBehavior: "Core 中的“(文件尚未创建)”用于表示缺文件哨兵，不是用户可点击假实现。",
    userRisk: "low",
    status: "confirmed-real",
    targetBehavior: "保留为缺文件哨兵，并确保 noop-model 只在 requireApiKey=false 的非真实调用路径使用。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "静态扫描将该项归类为低风险哨兵",
      "确认真实 LLM 调用路径不使用 noop-model",
    ],
  },
  {
    id: "cli-production-source",
    module: "CLI production source",
    files: ["packages/cli/src/**"],
    currentBehavior: "当前生产源码未发现 mock 债务；测试 mock 不纳入产品债务。",
    userRisk: "low",
    status: "confirmed-real",
    targetBehavior: "保持扫描确认；后续生产源码若新增高风险命中必须追加 ledger。",
    ownerSpec: OWNER_SPEC,
    verification: [
      "生产源码 mock scan 不发现未登记 CLI 命中",
      "测试目录 mock 不作为产品债务处理",
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
