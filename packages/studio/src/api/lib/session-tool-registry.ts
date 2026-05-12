import { SESSION_TOOL_RISKS } from "../../shared/agent-native-workspace.js";
import type {
  JsonObjectSchema,
  SessionToolDefinition,
  SessionToolRisk,
  SessionToolScope,
} from "../../shared/agent-native-workspace.js";
import type { SessionPermissionMode } from "../../shared/session-types.js";
import { NOVEL_SESSION_TOOL_DEFINITIONS, NOVEL_TOOL_NAMES } from "./session-tool-registry-novel.js";

export { SESSION_TOOL_RISKS };
export { NOVEL_SESSION_TOOL_DEFINITIONS, NOVEL_TOOL_NAMES };
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

export const SESSION_TOOL_DEFINITIONS = [
  // --- 小说领域工具（从 session-tool-registry-novel.ts 导入） ---
  ...NOVEL_SESSION_TOOL_DEFINITIONS,
  // --- Claude Code / Codex 级开发工具 ---
  sessionTool({
    name: "Bash",
    description: "在工作目录中执行 shell 命令。支持 cwd 追踪和超时控制。",
    inputSchema: objectSchema({
      command: stringSchema("要执行的 shell 命令。"),
      workDir: stringSchema("工作目录路径（可选，默认使用 session workDir）。"),
      timeoutMs: numberSchema("超时毫秒数（默认 30000）。"),
    }, ["command"]),
    risk: "destructive",
    renderer: "tool.bash",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Read",
    description: "读取工作目录内的文件内容，支持行偏移和行数限制。",
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
    description: "将内容写入工作目录内的文件，自动创建父目录。",
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
    description: "在工作目录内的文件中执行精确文本替换。",
    inputSchema: objectSchema({
      path: stringSchema("要编辑的文件路径（相对于工作目录）。"),
      oldText: stringSchema("要替换的原始文本。"),
      newText: stringSchema("替换后的新文本。"),
    }, ["path", "oldText", "newText"]),
    risk: "confirmed-write",
    renderer: "tool.fileEdit",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 文件搜索工具 ---
  sessionTool({
    name: "Glob",
    description: "使用 glob 模式匹配工作目录内的文件，返回匹配的文件路径列表。",
    inputSchema: objectSchema({
      pattern: stringSchema("Glob 模式（如 **/*.ts, src/**/*.json）。"),
      path: stringSchema("搜索目录（相对于工作目录，默认为根目录）。"),
    }, ["pattern"]),
    risk: "read",
    renderer: "tool.glob",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "Grep",
    description: "使用正则表达式搜索工作目录内文件的内容，支持文件过滤和上下文行。",
    inputSchema: objectSchema({
      pattern: stringSchema("正则表达式搜索模式。"),
      path: stringSchema("搜索路径（相对于工作目录，默认为根目录）。"),
      glob: stringSchema("文件过滤 glob 模式（如 *.ts, **/*.json）。"),
      output_mode: stringSchema("输出模式：content（显示匹配行）| files_with_matches（仅文件路径）| count（匹配计数）。"),
      context: numberSchema("显示匹配行前后的上下文行数。"),
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
    description: "向用户提出结构化问题（单选/多选/自由文本），等待用户回答后继续。",
    inputSchema: objectSchema({
      questions: arraySchema("问题数组，每个含 question、options、multiSelect 字段。"),
    }, ["questions"]),
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
    description: "搜索网络获取最新信息，返回搜索结果摘要和链接。",
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
    description: "控制浏览器进行多步交互：导航、点击、填写、截图、执行 JS、网络调试。",
    inputSchema: objectSchema({
      action: stringSchema("浏览器操作：launch | click | fill | screenshot | evaluate | navigate | scroll | dom | close 等。"),
      url: stringSchema("URL（launch/navigate 时使用）。"),
      session_id: stringSchema("浏览器会话 ID（launch 之外的操作需要）。"),
      selector: stringSchema("CSS 选择器（元素操作时使用）。"),
      value: stringSchema("值（fill/evaluate 时使用）。"),
    }, ["action"]),
    risk: "destructive",
    renderer: "tool.browser",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 子代理与并行 ---
  sessionTool({
    name: "Agent",
    description: "启动隔离子代理执行专项任务（explore/plan/general 类型），支持后台运行。",
    inputSchema: objectSchema({
      prompt: stringSchema("子代理要执行的任务描述。"),
      subagent_type: stringSchema("子代理类型：explore | plan | general。"),
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
    }, ["mode", "message"]),
    risk: "confirmed-write",
    renderer: "tool.forkNarrator",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  // --- 辅助工具 ---
  sessionTool({
    name: "Terminal",
    description: "交互式终端管理（PTY）：创建、读取输出、写入输入、列出终端。",
    inputSchema: objectSchema({
      action: stringSchema("终端操作：create | read | write | list。"),
      terminal_id: stringSchema("终端 ID（read/write 时需要）。"),
      input: stringSchema("要发送到终端的输入（write 时使用）。"),
      name: stringSchema("终端名称（create 时使用）。"),
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
    description: "搜索当前会话的对话历史，支持全文搜索和消息浏览。",
    inputSchema: objectSchema({
      action: stringSchema("操作：search | read_conversation | read_tool_call。"),
      query: stringSchema("搜索查询（action=search 时使用）。"),
      message_id: stringSchema("消息 ID（read_conversation 时可选，用于定位）。"),
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
    description: "调用已注册的技能（slash command 行为），执行专项能力。",
    inputSchema: objectSchema({
      skill: stringSchema("技能名称。"),
      args: stringSchema("技能参数。"),
    }, ["skill"]),
    risk: "read",
    renderer: "tool.skill",
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

export const SESSION_TOOL_NAMES = SESSION_TOOL_DEFINITIONS.map((tool) => tool.name);

function cloneDefinition(definition: SessionToolDefinition): SessionToolDefinition {
  return {
    ...definition,
    inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)) as JsonObjectSchema,
    enabledForModes: [...definition.enabledForModes],
  };
}

export function getAllSessionToolDefinitions(): SessionToolDefinition[] {
  return SESSION_TOOL_DEFINITIONS.map(cloneDefinition);
}

export function getSessionToolDefinition(name: string): SessionToolDefinition | undefined {
  const definition = SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  return definition ? cloneDefinition(definition) : undefined;
}

export function isSessionToolEnabledForMode(
  toolName: string,
  permissionMode: SessionPermissionMode,
): boolean {
  const definition = SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
  return definition?.enabledForModes.includes(permissionMode) ?? false;
}

// ---------------------------------------------------------------------------
// Agent 角色专属工具开关（对标 agent-writing-pipeline spec Req1）
// ---------------------------------------------------------------------------

const AGENT_TOOL_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  writer: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TodoWrite"],
    disable: ["Terminal", "Browser", "ForkNarrator", "NarraForkAdmin", "Recall", "ShareFile"],
  },
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
  hooks: {
    enable: ["Read", "Write", "Grep", "Glob"],
    disable: ["Bash", "Terminal", "Browser", "ForkNarrator"],
  },
  "chapter-hooks": {
    enable: ["Read", "Grep", "Glob"],
    disable: ["Write", "Edit", "Bash", "Terminal", "Browser"],
  },
  outline: {
    enable: ["Read", "Write", "Edit", "Grep", "Glob"],
    disable: ["Bash", "Terminal", "Browser", "ForkNarrator"],
  },
};

const UNAVAILABLE_SERVICE_TOOLS = new Set([
  "cockpit.get_snapshot",
  "cockpit.list_open_hooks",
  "cockpit.list_recent_candidates",
  "narrative.read_line",
  "narrative.propose_change",
  "health.read_summary",
]);

export function getEnabledSessionTools(permissionMode: SessionPermissionMode, agentId?: string, options?: { disabledTools?: readonly string[]; projectType?: string }): SessionToolDefinition[] {
  let tools = SESSION_TOOL_DEFINITIONS
    .filter((tool) => tool.enabledForModes.includes(permissionMode))
    // Do not expose service-backed tools until their services are wired into the session executor.
    // Exposing them causes the model to repeatedly call tools that can only return configuration errors.
    .filter((tool) => !UNAVAILABLE_SERVICE_TOOLS.has(tool.name))
    .map(cloneDefinition);

  // 按 projectType 过滤 scope（向后兼容：不传或 "novel" 时返回所有工具）
  const projectType = options?.projectType;
  if (projectType && projectType !== "novel") {
    tools = tools.filter((tool) => tool.scope !== "novel");
  }

  // 按 Agent 角色过滤工具
  if (agentId) {
    const preset = AGENT_TOOL_PRESETS[agentId];
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
