import { SESSION_TOOL_RISKS } from "../../shared/agent-native-workspace.js";
import type {
  JsonObjectSchema,
  SessionToolDefinition,
  SessionToolRisk,
  SessionToolScope,
} from "../../shared/agent-native-workspace.js";
import type { SessionPermissionMode } from "../../shared/session-types.js";

export { SESSION_TOOL_RISKS };
export type { JsonObjectSchema, SessionToolDefinition, SessionToolRisk, SessionToolScope };

export type ProviderSessionToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonObjectSchema;
  };
};

const ALL_SESSION_PERMISSION_MODES = ["ask", "edit", "allow", "read", "plan"] as const;
const WRITE_SESSION_PERMISSION_MODES = ["ask", "edit", "allow"] as const;

function objectSchema(
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberSchema(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function booleanSchema(description: string): Record<string, unknown> {
  return { type: "boolean", description };
}

function arraySchema(description: string, items: Record<string, unknown> = { type: "object" }): Record<string, unknown> {
  return { type: "array", description, items };
}

function sessionTool(
  definition: Omit<SessionToolDefinition, "visibility"> & Partial<Pick<SessionToolDefinition, "visibility">>,
): SessionToolDefinition {
  return { visibility: "author", ...definition };
}

// ---------------------------------------------------------------------------
// Plugin registration — 动态插件工具注册
// ---------------------------------------------------------------------------

let pluginToolDefinitions: SessionToolDefinition[] = [];
let pluginAgentPresets: Record<string, { enable: string[]; disable: string[] }> = {};

/** 动态注册插件工具定义（如小说工具）。按 name 去重，重复注册安全。 */
export function registerPluginTools(tools: readonly SessionToolDefinition[]): void {
  const existingNames = new Set(pluginToolDefinitions.map(t => t.name));
  const newTools = tools.filter(t => !existingNames.has(t.name));
  pluginToolDefinitions = [...pluginToolDefinitions, ...newTools];
}

/** 动态注册插件 Agent 角色预设。同名预设覆盖。 */
export function registerPluginAgentPresets(presets: Record<string, { enable: string[]; disable: string[] }>): void {
  pluginAgentPresets = { ...pluginAgentPresets, ...presets };
}

/** 清除所有插件注册（主要用于测试） */
export function clearPluginRegistrations(): void {
  pluginToolDefinitions = [];
  pluginAgentPresets = {};
}

// ---------------------------------------------------------------------------
// Builtin tool definitions — 通用工具（不依赖任何插件）
// ---------------------------------------------------------------------------

const BUILTIN_TOOL_DEFINITIONS: readonly SessionToolDefinition[] = [
  sessionTool({
    name: "Bash",
    description: "在工作目录中执行 shell 命令（Git Bash）。用于 git、npm、bun、编译、运行脚本等需要 shell 的操作。不要用 Bash 执行 cat/head/grep/find——用专用的 Read/Grep/Glob 工具代替。默认超时 120 秒，可用 timeoutMs 参数调整（最大 600000ms=10分钟）。长任务可设 run_in_background=true 后台执行。",
    inputSchema: objectSchema({
      command: stringSchema("要执行的 shell 命令。"),
      description: stringSchema("命令的简短描述（5-10 词），用于 UI 折叠态展示。"),
      workDir: stringSchema("工作目录路径（可选，默认使用 session workDir）。"),
      timeoutMs: numberSchema("超时毫秒数（默认 120000，最大 600000）。长时间任务请设大或用 run_in_background。"),
      run_in_background: booleanSchema("是否在后台运行命令。为 true 时立即返回 task ID，使用 Await 工具获取结果。"),
    }, ["command"]),
    risk: "destructive",
    renderer: "tool.bash",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Read",
    description: "读取文件内容。大文件（>500行）会自动截断，用 offset/limit 参数分页读取后续内容。优先使用此工具而非 Bash cat/head/tail。",
    inputSchema: objectSchema({
      path: stringSchema("要读取的文件路径（相对于工作目录）。"),
      offset: numberSchema("起始行号（0-based）。"),
      limit: numberSchema("读取行数。"),
    }, ["path"]),
    risk: "read",
    renderer: "tool.fileRead",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Write",
    description: "创建或完整覆盖文件。注意：会覆盖整个文件内容。如果只需修改部分内容，用 Edit 工具代替。写入前建议先 Read 确认当前内容。",
    inputSchema: objectSchema({
      path: stringSchema("要写入的文件路径（相对于工作目录）。"),
      content: stringSchema("要写入的文件内容。"),
    }, ["path", "content"]),
    risk: "confirmed-write",
    renderer: "tool.fileWrite",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Edit",
    description: "精确文本替换。old_string 必须在文件中唯一匹配（提供足够上下文确保唯一性）。修改部分内容时优先使用此工具而非 Write。编辑前先 Read 确认当前内容。",
    inputSchema: objectSchema({
      path: stringSchema("要编辑的文件路径（相对于工作目录）。"),
      old_string: stringSchema("要替换的原始文本（必须在文件中唯一匹配）。"),
      new_string: stringSchema("替换后的新文本。"),
      replace_all: booleanSchema("替换所有匹配项（默认 false，仅替换第一处）。"),
    }, ["path", "old_string", "new_string"]),
    risk: "confirmed-write",
    renderer: "tool.fileEdit",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ApplyPatch",
    description: "应用 unified diff 补丁到文件。适用于多处修改或大面积重构。输入为标准 unified diff 格式（以 --- a/path 和 +++ b/path 开头）。",
    inputSchema: objectSchema({
      patch: stringSchema("unified diff 格式的补丁内容。"),
      path: stringSchema("目标文件路径（可选，如果 diff 头部已包含路径则自动提取）。"),
    }, ["patch"]),
    risk: "confirmed-write",
    renderer: "tool.fileEdit",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 文件搜索工具 ---
  sessionTool({
    name: "Glob",
    description: "快速文件模式匹配。用 path 参数指定搜索子目录（而非在 pattern 中写路径）。示例：pattern=\"*.ts\", path=\"src/api\" 搜索 src/api 下的 ts 文件。pattern 支持 **（递归）和 *（单层）。返回匹配的文件路径列表（按修改时间排序）。",
    inputSchema: objectSchema({
      pattern: stringSchema("Glob 模式（如 *.ts, *.md, **/*.json）。不要在 pattern 中写目录路径，用 path 参数代替。"),
      path: stringSchema("搜索起始目录（相对于工作目录）。指定子目录比在 pattern 中写路径更高效。"),
    }, ["pattern"]),
    risk: "read",
    renderer: "tool.glob",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Grep",
    description: "正则表达式内容搜索（基于 ripgrep）。用 path 参数限定搜索范围。支持文件类型过滤、上下文行、跨行匹配。返回匹配行及其文件位置。",
    inputSchema: objectSchema({
      pattern: stringSchema("正则表达式搜索模式。"),
      path: stringSchema("搜索路径（相对于工作目录）。指定子目录可大幅减少搜索范围。"),
      glob: stringSchema("文件过滤 glob 模式（如 *.ts, **/*.json）。"),
      type: stringSchema("文件类型过滤（如 ts, js, py, rust, go, java）。比 glob 更高效。"),
      output_mode: stringSchema("输出模式：content（显示匹配行）| files_with_matches（仅文件路径）| count（匹配计数）。"),
      context: numberSchema("显示匹配行前后的上下文行数（对称，等同于 -C）。"),
      before_context: numberSchema("匹配行前显示的上下文行数（-B）。"),
      after_context: numberSchema("匹配行后显示的上下文行数（-A）。"),
      case_insensitive: booleanSchema("大小写不敏感搜索（-i）。"),
      multiline: booleanSchema("启用跨行匹配模式（. 匹配换行，模式可跨行）。默认 false。"),
      head_limit: numberSchema("限制输出前 N 行/条目。"),
    }, ["pattern"]),
    risk: "read",
    renderer: "tool.grep",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  // --- Worktree 管理 ---
  sessionTool({
    name: "EnterWorktree",
    description: "创建或进入 git worktree，切换会话工作目录到隔离的分支环境。",
    inputSchema: objectSchema({
      name: stringSchema("新建 worktree 的名称（与 path 互斥）。"),
      path: stringSchema("已存在的 worktree 路径（与 name 互斥）。"),
      branch: stringSchema("基于哪个分支创建 worktree（默认当前分支）。"),
    }, []),
    risk: "confirmed-write",
    renderer: "tool.enterWorktree",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ExitWorktree",
    description: "退出当前 worktree，恢复会话工作目录到主仓库。",
    inputSchema: objectSchema({
      action: stringSchema("退出操作：keep（保留 worktree）或 remove（删除 worktree）。"),
      discard_changes: booleanSchema("action=remove 时是否强制删除有未提交更改的 worktree。"),
    }, ["action"]),
    risk: "confirmed-write",
    renderer: "tool.exitWorktree",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 用户交互工具 ---
  sessionTool({
    name: "AskUserQuestion",
    description: "向用户提出结构化问题（单选/多选），等待回答后继续。优先使用 questions 数组；也兼容 question/options 简写。用于需要用户决策的场景。",
    inputSchema: objectSchema({
      questions: arraySchema("问题数组，每个含 question、options、multiSelect 字段。"),
      question: stringSchema("单个问题文本（简写格式）。"),
      prompt: stringSchema("单个问题文本（兼容字段）。"),
      header: stringSchema("问题短标题。"),
      options: arraySchema("单个问题的选项数组。"),
      multiSelect: booleanSchema("是否允许多选。"),
    }),
    risk: "read",
    renderer: "tool.askUserQuestion",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "EnterPlanMode",
    description: "进入计划模式，Agent 只做调查和设计，不执行写入操作，直到计划被批准。",
    inputSchema: objectSchema({}),
    risk: "read",
    renderer: "tool.planMode",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ExitPlanMode",
    description: "提交实施计划文本，等待用户批准后退出计划模式开始执行。",
    inputSchema: objectSchema({
      plan: stringSchema("完整的实施计划（Markdown 格式）。"),
    }, ["plan"]),
    risk: "read",
    renderer: "tool.planMode",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "TaskCreate",
    description: "创建或更新任务列表（todo），前端渲染为可勾选的任务卡片。",
    inputSchema: objectSchema({
      todos: arraySchema("任务数组，每项含 id、content、status、priority 字段。"),
    }, ["todos"]),
    risk: "read",
    renderer: "tool.taskCreate",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  // --- 网络与浏览器 ---
  sessionTool({
    name: "WebSearch",
    description: "搜索网络获取最新信息。用于需要实时数据、文档查询或验证事实的场景。返回搜索结果摘要和链接。",
    inputSchema: objectSchema({
      query: stringSchema("搜索查询文本。"),
      allowed_domains: arraySchema("仅包含这些域名的结果。", { type: "string" }),
      blocked_domains: arraySchema("排除这些域名的结果。", { type: "string" }),
    }, ["query"]),
    risk: "read",
    renderer: "tool.webSearch",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "WebFetch",
    description: "抓取指定 URL 的网页内容，支持 readability/screenshot/dom/smart 模式。",
    inputSchema: objectSchema({
      url: stringSchema("要抓取的 URL。"),
      mode: stringSchema("提取模式：readability | screenshot | dom | smart。"),
      max_length: numberSchema("最大输出长度（字符数）。"),
    }, ["url"]),
    risk: "read",
    renderer: "tool.webFetch",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Browser",
    description: "控制浏览器进行多步交互：导航、点击、填写、截图、执行 JS、网络调试。screenshot action 支持无 session 模式（直接使用系统 Chrome/Edge 截图，无需 Playwright）。",
    inputSchema: objectSchema({
      action: stringSchema("浏览器操作：launch | click | fill | screenshot | evaluate | navigate | scroll | dom | close 等。"),
      url: stringSchema("URL（launch/navigate/screenshot 时使用）。"),
      session_id: stringSchema("浏览器会话 ID（launch/无session截图 之外的操作需要）。"),
      selector: stringSchema("CSS 选择器（元素操作时使用）。"),
      value: stringSchema("值（fill/evaluate 时使用）。"),
      width: numberSchema("截图宽度（screenshot 无 session 模式，默认 1280）。"),
      height: numberSchema("截图高度（screenshot 无 session 模式，默认 900）。"),
    }, ["action"]),
    risk: "destructive",
    renderer: "tool.browser",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 子代理与并行 ---
  sessionTool({
    name: "Agent",
    description: "启动隔离子代理执行专项任务。仅在任务需要隔离上下文或并行执行时使用。单个 Read/Grep/Glob 能解决的查找不要用子代理。类型：explore（只读调查）、plan（读写规划）、general（全部工具）。子代理有独立消息历史，使用对应模型配置，完成后返回结果。",
    inputSchema: objectSchema({
      prompt: stringSchema("子代理要执行的任务描述。"),
      subagent_type: stringSchema("子代理类型：explore（只读）| plan（读写）| general（全部工具）。默认 general。"),
      reasoning_effort: stringSchema("推理强度：low | medium | high。影响子代理的思考深度。"),
      run_in_background: booleanSchema("是否在后台运行。"),
      description: stringSchema("任务简短描述（3-5 词）。"),
    }, ["prompt"]),
    risk: "confirmed-write",
    renderer: "tool.agent",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Await",
    description: "等待后台子代理或后台 Bash 任务完成，返回当前状态和输出。",
    inputSchema: objectSchema({
      type: stringSchema("等待类型：agent | bash。"),
      id: stringSchema("任务 ID 或别名。"),
      timeout: numberSchema("等待超时毫秒数。"),
    }, ["type", "id"]),
    risk: "read",
    renderer: "tool.await",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Send",
    description: "向子代理发送消息，可选等待回复。",
    inputSchema: objectSchema({
      id: stringSchema("目标子代理 ID 或别名。"),
      message: stringSchema("要发送的消息内容。"),
      await: booleanSchema("是否等待目标子代理回复。"),
    }, ["id", "message"]),
    risk: "read",
    renderer: "tool.send",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ForkNarrator",
    description: "创建独立叙述者（新会话），支持 fresh（全新）或 fork（继承历史）模式。",
    inputSchema: objectSchema({
      mode: stringSchema("创建模式：fresh（全新）| fork（继承当前对话历史）。"),
      message: stringSchema("发送给新叙述者的初始消息。"),
      title: stringSchema("新叙述者的标题。"),
      inheritMode: stringSchema("fork 模式下的继承方式：full（完整复制所有消息）| compressed（压缩摘要）。默认 full。"),
    }, ["mode", "message"]),
    risk: "confirmed-write",
    renderer: "tool.forkNarrator",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 辅助工具 ---
  sessionTool({
    name: "Terminal",
    description: "交互式终端管理（PTY）：创建、读取输出、写入输入、列出终端。使用系统 shell（Windows: cmd.exe, Unix: /bin/sh）。",
    inputSchema: objectSchema({
      action: stringSchema("终端操作：create | read | write | list。"),
      terminal_id: stringSchema("终端 ID（read/write 时需要）。"),
      input: stringSchema("要发送到终端的输入（write 时使用）。"),
      name: stringSchema("终端名称（create 时使用）。"),
      cwd: stringSchema("工作目录（create 时使用，默认为 session workDir）。"),
    }, ["action"]),
    risk: "destructive",
    renderer: "tool.terminal",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ShareFile",
    description: "生成文件或目录的临时下载链接，目录自动压缩为 .tar.gz。",
    inputSchema: objectSchema({
      path: stringSchema("要分享的文件或目录路径。"),
      compress: booleanSchema("是否 gzip 压缩文件。"),
    }, ["path"]),
    risk: "read",
    renderer: "tool.shareFile",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Recall",
    description: "搜索当前会话的对话历史，支持 FTS5 全文搜索、消息浏览和工具调用查看。",
    inputSchema: objectSchema({
      action: stringSchema("操作：search | read_conversation | read_tool_call。默认 search。"),
      query: {
        description: "搜索查询（action=search 时使用）。支持单个字符串或字符串数组（批量搜索）。",
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      time_range: stringSchema("相对时间范围（如 '24h', '7d', '1mo'）。可选。"),
      from: stringSchema("绝对时间范围起始（ISO 格式）。可选。"),
      to: stringSchema("绝对时间范围结束（ISO 格式）。可选。"),
      limit: numberSchema("返回结果数量上限（默认 20，最大 50）。"),
      message_id: stringSchema("消息 ID（read_conversation 时可选，用于定位上下文）。"),
      tool_call_id: stringSchema("工具调用 ID（action=read_tool_call 时使用）。"),
    }, ["action"]),
    risk: "read",
    renderer: "tool.recall",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "StartPipeline",
    description: "进入管道模式，后续工具输出被捕获为短别名，用于处理长输出。",
    inputSchema: objectSchema({
      label: stringSchema("管道会话的人类可读标签。"),
    }, ["label"]),
    risk: "read",
    renderer: "tool.pipeline",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "EndPipeline",
    description: "退出管道模式，使用 shell 风格规则过滤/排序捕获的输出。",
    inputSchema: objectSchema({
      rule: stringSchema("过滤规则（如 from p1 | grep error | head -n 20）。"),
    }, ["rule"]),
    risk: "read",
    renderer: "tool.pipeline",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "LearningGuide",
    description: "查询学习中心文档，支持列表、搜索和获取单篇文档。",
    inputSchema: objectSchema({
      mode: stringSchema("操作模式：list | search | get。"),
      query: stringSchema("搜索查询（mode=search 时使用）。"),
      id: stringSchema("文档 ID（mode=get 时使用）。"),
    }, ["mode"]),
    risk: "read",
    renderer: "tool.learningGuide",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Skill",
    description: "调用一个已注册的 skill。Skills 提供专门的领域知识和工作流。优先从磁盘加载 skill 文件（.claude/skills/、.novelfork/skills/、.kiro/skills/），未找到时回退到 slash command 路由。",
    inputSchema: objectSchema({
      skill: stringSchema("Skill 名称"),
      args: stringSchema("传递给 skill 的参数（可选）"),
    }, ["skill"]),
    risk: "read",
    renderer: "tool.skill",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "ToolSearch",
    description: "搜索按需加载的工具。核心工具（读写章节、经纬、快照、审计、PGI 等）已直接可用；当你需要使用预设、节拍、文风导入、片段改写、章节导入、一致性检查等非核心工具时，先用此工具按关键词搜索。返回匹配工具的名称、描述和完整的 inputSchema，你可据此直接调用该工具。",
    inputSchema: objectSchema({
      query: stringSchema("搜索关键词"),
    }, ["query"]),
    risk: "read",
    renderer: "tool.toolSearch",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "GetGoals",
    description: "获取当前会话的目标列表，包括活跃/待处理/已暂停目标。",
    inputSchema: objectSchema({}),
    risk: "read",
    renderer: "tool.goals",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "AddGoal",
    description: "添加一个目标到当前会话的目标列表。",
    inputSchema: objectSchema({
      objective: stringSchema("要添加的具体目标描述。"),
    }, ["objective"]),
    risk: "read",
    renderer: "tool.goals",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "UpdateGoal",
    description: "标记当前活跃目标为已完成。",
    inputSchema: objectSchema({
      status: stringSchema("目标状态：complete。"),
    }, ["status"]),
    risk: "read",
    renderer: "tool.goals",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
] as const;

// ---------------------------------------------------------------------------
// Merged definitions — 合并内置 + 插件工具
// ---------------------------------------------------------------------------

/** 获取合并后的完整工具定义列表（插件工具在前，内置工具在后） */
function getSessionToolDefinitions(): readonly SessionToolDefinition[] {
  if (pluginToolDefinitions.length === 0) return BUILTIN_TOOL_DEFINITIONS;
  return [...pluginToolDefinitions, ...BUILTIN_TOOL_DEFINITIONS];
}

/** 获取合并后的完整工具定义列表（用于 ToolSearch） */
export function listSessionToolDefinitions(): readonly SessionToolDefinition[] {
  return getSessionToolDefinitions();
}

/** 向后兼容：合并后的工具名列表 */
export function getSessionToolNames(): string[] {
  return getSessionToolDefinitions().map((tool) => tool.name);
}

/**
 * @deprecated 使用 getSessionToolNames() 代替。保留仅为兼容现有引用。
 * 注意：此值仅包含内置工具名，不含动态注册的插件工具。
 */
export const SESSION_TOOL_NAMES = BUILTIN_TOOL_DEFINITIONS.map((tool) => tool.name);

function cloneDefinition(definition: SessionToolDefinition): SessionToolDefinition {
  return {
    ...definition,
    inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)) as JsonObjectSchema,
    enabledForModes: [...definition.enabledForModes],
  };
}

export function getAllSessionToolDefinitions(): SessionToolDefinition[] {
  return getSessionToolDefinitions().map(cloneDefinition);
}

export function getSessionToolDefinition(name: string): SessionToolDefinition | undefined {
  const definitions = getSessionToolDefinitions();
  // 精确匹配
  let definition = definitions.find((tool) => tool.name === name);
  // Fallback: 模型可能返回 provider-safe 格式（点号→下划线），反向查找
  if (!definition && name.includes("_")) {
    definition = definitions.find((tool) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_") === name);
  }
  return definition ? cloneDefinition(definition) : undefined;
}

export function isSessionToolEnabledForMode(
  toolName: string,
  permissionMode: SessionPermissionMode,
): boolean {
  const definition = getSessionToolDefinitions().find((tool) => tool.name === toolName);
  return definition?.enabledForModes.includes(permissionMode) ?? false;
}

// ---------------------------------------------------------------------------
// Agent 角色专属工具开关（对标 agent-writing-pipeline spec Req1）
// ---------------------------------------------------------------------------

const BUILTIN_AGENT_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  planner: {
    enable: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite"],
    disable: ["Bash", "Write", "Edit", "Terminal"],
  },
  auditor: {
    enable: ["Read", "Grep", "Glob"],
    disable: ["Write", "Edit", "Bash", "Terminal"],
  },
  explorer: {
    enable: ["Read", "Grep", "Glob", "Recall"],
    disable: ["Write", "Edit", "Bash", "Terminal", "EnterWorktree", "ExitWorktree"],
  },
  architect: {
    enable: ["Read", "Write", "Grep", "Glob", "WebSearch"],
    disable: ["Bash", "Terminal"],
  },
  subagent: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
    disable: ["Terminal", "Browser", "ForkNarrator"],
  },
};

const UNAVAILABLE_SERVICE_TOOLS = new Set([
  "cockpit.get_snapshot",
  "cockpit.list_recent_candidates",
  "narrative.propose_change",
  "health.read_summary",
]);

/**
 * v1 工具已被 v2 替代，默认不暴露给模型。
 * 用户可通过 showDeprecated=true 或设置中"显示全部工具"恢复。
 */
const DEPRECATED_V1_TOOLS = new Set([
  // 被 jingwei.read(scope=brief/category/search) 替代
  "jingwei.read_brief",
  "jingwei.read_category",
  "jingwei.search",
  "jingwei.read_context",
  // 被 jingwei.write 替代
  "jingwei.upsert_entry",
  // 被 pgi.ask 替代
  "pgi.generate_questions",
  "pgi.record_answers",
  "pgi.format_answers_for_prompt",
  // 被 pipeline.write 替代
  "pipeline.generate_chapter",
  // 被 cockpit.snapshot 替代（已在 UNAVAILABLE 中，双重保险）
  "cockpit.get_snapshot",
  "cockpit.list_recent_candidates",
  // 写作时不需要的配置工具
  "questionnaire.list_templates",
  "questionnaire.start",
  "questionnaire.suggest_answer",
  "questionnaire.submit_response",
  // 被 pgi.ask + scene.spec 流程替代的引导式生成
  "guided.enter",
  "guided.answer_question",
  "guided.exit",
  // 被 cockpit.snapshot 包含的健康度
  "health.read_summary",
]);

/**
 * 网文核心工具白名单（高频）。
 * 书绑定 session 默认只暴露这些小说工具 + 通用核心工具 + ToolSearch，
 * 其余小说工具（预设/节拍/文风/改写等）由模型通过 ToolSearch 按需发现。
 * 可按实际使用日志调整。
 */
export const NOVEL_CORE_TOOLS = new Set<string>([
  "jingwei.read",
  "jingwei.write",
  "cockpit.snapshot",
  "chapter.read",
  "chapter.audit",
  "pipeline.write",
  "scene.spec",
  "pgi.ask",
]);

export function getEnabledSessionTools(permissionMode: SessionPermissionMode, agentId?: string, options?: { disabledTools?: readonly string[]; projectType?: string; sessionConfig?: { projectType?: string }; showDeprecated?: boolean }): SessionToolDefinition[] {
  let tools = getSessionToolDefinitions()
    .filter((tool) => tool.enabledForModes.includes(permissionMode))
    // Do not expose service-backed tools until their services are wired into the session executor.
    // Exposing them causes the model to repeatedly call tools that can only return configuration errors.
    .filter((tool) => !UNAVAILABLE_SERVICE_TOOLS.has(tool.name))
    .map(cloneDefinition);

  // v2 工具可见性分层：默认隐藏被 v2 替代的旧工具
  if (!options?.showDeprecated) {
    tools = tools.filter((tool) => !DEPRECATED_V1_TOOLS.has(tool.name));
  }

  // 按 projectType 过滤 scope（向后兼容：不传或 "novel" 时返回所有工具）
  const projectType = options?.projectType ?? options?.sessionConfig?.projectType;
  if (projectType && projectType !== "novel") {
    tools = tools.filter((tool) => !tool.scope || tool.scope === "universal" || tool.scope === "all" || tool.scope === projectType);
  }

  // 按 Agent 角色过滤工具（合并内置 + 插件预设）
  if (agentId) {
    const mergedPresets = { ...BUILTIN_AGENT_PRESETS, ...pluginAgentPresets };
    const preset = mergedPresets[agentId];
    if (preset) {
      tools = tools.filter((tool) => !preset.disable.includes(tool.name));
    }
  }

  // 过滤用户禁用的工具（来自 routines.tools 或 toolPolicy.deny）
  if (options?.disabledTools?.length) {
    const disabled = new Set(options.disabledTools);
    tools = tools.filter((tool) => !disabled.has(tool.name));
  }

  return tools;
}

export function getProviderSessionToolDefinitions(
  permissionMode: SessionPermissionMode,
  agentId?: string,
): ProviderSessionToolDefinition[] {
  return getEnabledSessionTools(permissionMode, agentId).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * Initialize MCP tools from user config.
 * Connects to configured MCP servers and registers their tools as session tools.
 * Should be called once at startup or when MCP config changes.
 */
export async function initializeMcpTools(): Promise<{ connected: number; tools: number }> {
  try {
    const { getMcpRegistry } = await import("./mcp-registry.js");
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();

    const mcpServers = config.mcpServers ?? [];
    const autoConnectServers = mcpServers.filter((s: { autoConnect?: boolean }) => s.autoConnect !== false);

    if (autoConnectServers.length === 0) {
      return { connected: 0, tools: 0 };
    }

    const registry = getMcpRegistry({
      mcpStrategy: config.runtimeControls.toolAccess.mcpStrategy,
    });

    // Convert McpServerEntry to McpServerConfig format
    const configs = autoConnectServers.map((entry: { id: string; name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string }) => ({
      id: entry.id,
      name: entry.name,
      transport: entry.transport as "stdio" | "sse" | "http",
      command: entry.command ?? "",
      args: entry.args ?? [] as string[],
      env: entry.env,
      cwd: entry.cwd,
      url: entry.url,
    }));

    await registry.loadFromConfigs(configs);

    const statuses = registry.getServerStatuses();
    const connected = statuses.filter((s: { status: string }) => s.status === "connected").length;
    const tools = statuses.reduce((sum: number, s: { toolCount: number }) => sum + s.toolCount, 0);

    return { connected, tools };
  } catch {
    return { connected: 0, tools: 0 };
  }
}
