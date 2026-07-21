import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, ShieldCheck, Trash2, Wrench } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import {
  createMcpClient,
  createSettingsClient,
  type McpBehavior,
  type McpExternalTool,
  type McpServerStatus,
  type RuntimeAgentSettings,
} from "../runtime-admin";

const settingsClient = createSettingsClient();
const mcpClient = createMcpClient();

type PatternEntry = NonNullable<RuntimeAgentSettings["commandWhitelist"]>[number];
type BlacklistEntry = NonNullable<RuntimeAgentSettings["commandBlacklist"]>[number];
type WebFetchPolicy = NonNullable<RuntimeAgentSettings["webFetchPolicy"]>;

type DraftPatternEntry = {
  id: string;
  pattern: string;
  enabled?: boolean;
  denyPrompt?: string;
};

let nextPatternDraftId = 0;

function createPatternDraftId(): string {
  nextPatternDraftId += 1;
  return `permission-pattern-${nextPatternDraftId}`;
}

function toDraftPattern(entry: PatternEntry | BlacklistEntry): DraftPatternEntry {
  return { id: createPatternDraftId(), ...entry };
}

function stripDraftPattern(entry: DraftPatternEntry): Omit<DraftPatternEntry, "id"> {
  const { id: _id, ...value } = entry;
  return value;
}

type PermissionCategory = "always-allow" | "always-ask" | "read-only" | "default" | "optional";

interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly category: PermissionCategory;
  readonly configurable?: boolean;
}

const BUILTIN_TOOLS: readonly ToolMetadata[] = [
  { name: "Bash", description: "执行 shell 命令；可配置命令白名单和黑名单。", category: "default", configurable: true },
  { name: "Read", description: "读取文件内容。", category: "read-only" },
  { name: "Write", description: "创建或完整写入文件。", category: "default" },
  { name: "Edit", description: "对现有文件执行精确替换。", category: "default" },
  { name: "Glob", description: "按文件名模式搜索。", category: "read-only" },
  { name: "Grep", description: "搜索文件内容。", category: "read-only" },
  { name: "WebSearch", description: "搜索公开网页。", category: "always-allow" },
  { name: "WebFetch", description: "抓取指定 URL；可配置 URL 策略。", category: "default", configurable: true },
  { name: "Agent", description: "启动隔离的子代理任务。", category: "default" },
  { name: "EnterPlanMode", description: "进入计划模式。", category: "always-allow" },
  { name: "ExitPlanMode", description: "提交实现计划并等待确认。", category: "always-ask", configurable: true },
  { name: "AskUserQuestion", description: "向用户请求关键决策。", category: "always-ask" },
  { name: "Skill", description: "加载 Runtime Skill。", category: "always-allow" },
  { name: "Await", description: "等待后台任务完成。", category: "always-allow" },
  { name: "Send", description: "向子代理或协作者发送消息。", category: "default" },
  { name: "ShareFile", description: "生成受控文件分享链接。", category: "optional" },
  { name: "Terminal", description: "管理持久交互终端。", category: "optional" },
  { name: "Browser", description: "控制浏览器并捕获页面证据。", category: "optional" },
  { name: "Recall", description: "检索 NarraFork 会话记录。", category: "optional" },
];

interface PermissionDraft {
  commandWhitelist: DraftPatternEntry[];
  commandBlacklist: DraftPatternEntry[];
  webFetchPolicy: {
    allowAll: boolean;
    whitelist: DraftPatternEntry[];
    blacklist: DraftPatternEntry[];
  };
  planReflectionAutoApprove: boolean;
}

const EMPTY_DRAFT: PermissionDraft = {
  commandWhitelist: [],
  commandBlacklist: [],
  webFetchPolicy: { allowAll: false, whitelist: [], blacklist: [] },
  planReflectionAutoApprove: false,
};

function categoryLabel(category: PermissionCategory): string {
  if (category === "always-allow") return "固定允许";
  if (category === "always-ask") return "固定询问";
  if (category === "read-only") return "只读";
  if (category === "optional") return "可选工具";
  return "默认权限";
}

function categoryVariant(category: PermissionCategory): "secondary" | "outline" | "destructive" {
  if (category === "always-ask") return "destructive";
  if (category === "always-allow" || category === "read-only") return "secondary";
  return "outline";
}

function draftFromAgent(agent?: RuntimeAgentSettings): PermissionDraft {
  const webFetchPolicy: WebFetchPolicy = agent?.webFetchPolicy ?? {};
  return {
    commandWhitelist: (agent?.commandWhitelist ?? []).map(toDraftPattern),
    commandBlacklist: (agent?.commandBlacklist ?? []).map(toDraftPattern),
    webFetchPolicy: {
      allowAll: webFetchPolicy.allowAll ?? false,
      whitelist: (webFetchPolicy.whitelist ?? []).map(toDraftPattern),
      blacklist: (webFetchPolicy.blacklist ?? []).map(toDraftPattern),
    },
    planReflectionAutoApprove: agent?.planReflectionAutoApprove ?? false,
  };
}

function errorMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 403) return `403 禁止访问 — 工具权限设置需要 Runtime 管理员权限。${message}`;
  return status ? `${status} — ${message}` : message;
}

export function ToolPermissionsSection() {
  const [draft, setDraft] = useState<PermissionDraft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_DRAFT));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<readonly McpServerStatus[]>([]);
  const [mcpTools, setMcpTools] = useState<readonly McpExternalTool[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpPendingKey, setMcpPendingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await settingsClient.get();
      const next = draftFromAgent(settings.agent);
      setDraft(next);
      setBaseline(JSON.stringify(next));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const [serversResult, toolsResult] = await Promise.all([
        mcpClient.list(),
        mcpClient.tools(),
      ]);
      setMcpServers(serversResult.servers);
      setMcpTools(toolsResult.tools);
    } catch (loadError) {
      setMcpError(errorMessage(loadError));
      setMcpServers([]);
      setMcpTools([]);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMcp();
  }, [load, loadMcp]);

  const dirty = useMemo(() => JSON.stringify(draft) !== baseline, [baseline, draft]);

  const mcpToolCards = useMemo(() => {
    const fromServers = mcpServers.flatMap((server) =>
      server.tools.map((tool) => {
        const permission = server.toolPermissions?.find(
          (item) => item.toolName === tool.name,
        );
        const behavior =
          permission?.enabled === false
            ? "inherit"
            : (permission?.behavior ?? server.defaultBehavior ?? "inherit");
        return {
          key: `${server.id}:${tool.name}`,
          serverId: server.id,
          serverName: server.name,
          serverStatus: server.status,
          toolName: tool.name,
          description: tool.description ?? "",
          behavior: behavior as string,
          editable: true as const,
        };
      }),
    );
    if (fromServers.length > 0) return fromServers;
    return mcpTools.map((tool) => ({
      key: `${tool.serverId}:${tool.name}`,
      serverId: tool.serverId,
      serverName: tool.serverName,
      serverStatus: "unknown" as const,
      toolName: tool.name,
      description: tool.description ?? "",
      behavior: "inherit" as const,
      editable: Boolean(tool.serverId) as boolean,
    }));
  }, [mcpServers, mcpTools]);

  async function updateMcpToolBehavior(
    serverId: string,
    toolName: string,
    behavior: McpBehavior | "inherit",
  ) {
    const pendingKey = `${serverId}:${toolName}`;
    setMcpPendingKey(pendingKey);
    setMcpError(null);
    try {
      await mcpClient.patch(serverId, {
        toolPermissionPatch: {
          toolName,
          behavior: behavior === "inherit" ? null : behavior,
        },
      });
      await loadMcp();
    } catch (patchError) {
      setMcpError(errorMessage(patchError));
    } finally {
      setMcpPendingKey(null);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await settingsClient.patch({
        agent: {
          commandWhitelist: draft.commandWhitelist.map(stripDraftPattern),
          commandBlacklist: draft.commandBlacklist.map(stripDraftPattern),
          webFetchPolicy: {
            allowAll: draft.webFetchPolicy.allowAll,
            whitelist: draft.webFetchPolicy.whitelist.map(stripDraftPattern),
            blacklist: draft.webFetchPolicy.blacklist.map(stripDraftPattern),
          },
          planReflectionAutoApprove: draft.planReflectionAutoApprove,
        },
      });
      const next = draftFromAgent(updated.agent);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">工具权限</h2>
          <p className="text-sm text-muted-foreground">
            对齐 Runtime：展示内置工具分类；可编辑 Bash、WebFetch、计划反思，以及已发现 MCP 工具的权限行为。服务器生命周期在「MCP」分区管理。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || mcpLoading}
            onClick={() => {
              void load();
              void loadMcp();
            }}
          >
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
          <Button type="button" size="sm" disabled={loading || saving || !dirty} onClick={() => void save()}>
            <Save data-icon="inline-start" />
            {saving ? "保存中…" : "保存权限设置"}
          </Button>
        </div>
      </div>

      <Alert>
        <ShieldCheck />
        <AlertTitle>权限引擎保持唯一</AlertTitle>
        <AlertDescription>
          未标记“可配置”的工具遵循 Runtime 固定策略。可选工具（Terminal/Browser…）由套路开关或会话 /load 控制；会话详情可禁用具体工具。
        </AlertDescription>
      </Alert>
      {error && <Alert><AlertTitle>工具权限请求失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && <Alert><AlertTitle>已保存</AlertTitle><AlertDescription>新的 Runtime 工具权限设置已生效。</AlertDescription></Alert>}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}><CardHeader><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-full" /></CardHeader></Card>
          ))}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-label="Runtime 内置工具">
            <div>
              <h3 className="font-medium">Runtime 内置工具</h3>
              <p className="text-sm text-muted-foreground">分类用于说明默认权限语义，不会创建平行策略。</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {BUILTIN_TOOLS.map((tool) => (
                <Card key={tool.name} size="sm">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {tool.name}
                      <Badge variant={categoryVariant(tool.category)}>{categoryLabel(tool.category)}</Badge>
                      {tool.configurable && <Badge variant="outline">可配置</Badge>}
                    </CardTitle>
                    <CardDescription>{tool.description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-label="MCP 工具面">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-medium">已发现的 MCP 工具</h3>
                <p className="text-sm text-muted-foreground">
                  与原生一致：可在此直接修改每个工具的权限行为（继承/只读/读写/询问/拒绝）。服务器添加、连接与导入请到「MCP」分区。
                </p>
              </div>
              <Badge variant="outline">{mcpToolCards.length} 个工具</Badge>
            </div>
            {mcpError && (
              <Alert>
                <AlertTitle>MCP 工具请求失败</AlertTitle>
                <AlertDescription>{mcpError}</AlertDescription>
              </Alert>
            )}
            {mcpLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1].map((item) => (
                  <Card key={item}>
                    <CardHeader>
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-full" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : mcpToolCards.length === 0 ? (
              <Alert>
                <AlertTitle>暂无 MCP 工具</AlertTitle>
                <AlertDescription>
                  连接 MCP 服务器后，这里会列出已发现工具，并可直接设置权限行为。
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-3">
                {mcpToolCards.map((tool) => (
                  <div
                    key={tool.key}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm">{tool.toolName}</span>
                        <Badge variant="outline">{tool.serverName}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tool.description || "无描述"}
                      </div>
                    </div>
                    <SimpleSelect
                      aria-label={`工具权限：${tool.serverName}/${tool.toolName}`}
                      value={tool.behavior === "allow" ? "readWrite" : tool.behavior}
                      disabled={!tool.editable || mcpPendingKey === tool.key}
                      onValueChange={(value) =>
                        void updateMcpToolBehavior(
                          tool.serverId,
                          tool.toolName,
                          value as McpBehavior | "inherit",
                        )
                      }
                      options={[
                        { value: "inherit", label: "继承服务器设置" },
                        { value: "readOnly", label: "只读" },
                        { value: "readWrite", label: "读写" },
                        { value: "ask", label: "询问" },
                        { value: "deny", label: "拒绝" },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <PatternListEditor
              title="Bash 命令白名单"
              description="命中且启用的命令模式可按 Runtime 策略自动放行。"
              items={draft.commandWhitelist}
              placeholder="例如 ^git status$"
              onChange={(commandWhitelist) => setDraft({ ...draft, commandWhitelist })}
            />
            <PatternListEditor
              title="Bash 命令黑名单"
              description="命中的命令会被拒绝；可设置返回给 Agent 的拒绝提示。"
              items={draft.commandBlacklist}
              placeholder="例如 rm\\s+-rf"
              showDenyPrompt
              onChange={(commandBlacklist) => setDraft({ ...draft, commandBlacklist })}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>WebFetch URL 策略</CardTitle>
              <CardDescription>allow-all 关闭时，由白名单与黑名单共同决定是否需要批准或拒绝。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field orientation="horizontal">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium">允许所有 URL</span>
                  <FieldDescription>开启后白名单不再限制抓取；黑名单仍由 Runtime 执行。</FieldDescription>
                </div>
                <Switch
                  aria-label="WebFetch 允许所有 URL"
                  checked={draft.webFetchPolicy.allowAll}
                  onCheckedChange={(allowAll) => setDraft({
                    ...draft,
                    webFetchPolicy: { ...draft.webFetchPolicy, allowAll },
                  })}
                />
              </Field>
              {!draft.webFetchPolicy.allowAll && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <PatternListEditor
                    title="URL 白名单"
                    description="支持 Runtime 接受的字符串或正则模式。"
                    items={draft.webFetchPolicy.whitelist}
                    placeholder="例如 ^https://docs\\.example\\.com/"
                    onChange={(whitelist) => setDraft({
                      ...draft,
                      webFetchPolicy: { ...draft.webFetchPolicy, whitelist },
                    })}
                  />
                  <PatternListEditor
                    title="URL 黑名单"
                    description="命中的 URL 会被 Runtime 拒绝。"
                    items={draft.webFetchPolicy.blacklist}
                    placeholder="例如 ^https://internal\\.example\\.com/"
                    onChange={(blacklist) => setDraft({
                      ...draft,
                      webFetchPolicy: { ...draft.webFetchPolicy, blacklist },
                    })}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ExitPlanMode 反思</CardTitle>
              <CardDescription>对应 Runtime `agent.planReflectionAutoApprove`，不改变普通权限请求。</CardDescription>
            </CardHeader>
            <CardContent>
              <Field orientation="horizontal">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium">计划反思自动批准</span>
                  <FieldDescription>在允许编辑的权限模式中，计划反思可无需额外确认。</FieldDescription>
                </div>
                <Switch
                  aria-label="计划反思自动批准"
                  checked={draft.planReflectionAutoApprove}
                  onCheckedChange={(planReflectionAutoApprove) => setDraft({
                    ...draft,
                    planReflectionAutoApprove,
                  })}
                />
              </Field>
            </CardContent>
          </Card>

          <Alert>
            <Wrench />
            <AlertTitle>MCP 权限与服务器管理</AlertTitle>
            <AlertDescription>
              上方可直接修改已发现工具的权限行为（与「MCP」分区同一 Runtime API）。添加/连接/导入服务器、修改服务器默认行为与作品级 override 仍在「MCP」分区完成。
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}

function PatternListEditor({
  title,
  description,
  items,
  placeholder,
  showDenyPrompt = false,
  onChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly items: ReadonlyArray<DraftPatternEntry>;
  readonly placeholder: string;
  readonly showDenyPrompt?: boolean;
  readonly onChange: (items: DraftPatternEntry[]) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无规则。</p>
        ) : items.map((item, index) => (
          <FieldSet key={item.id} className="rounded-lg border p-3">
            <FieldLegend variant="label">规则 {index + 1}</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${title}-pattern-${index}`}>模式</FieldLabel>
                <Input
                  id={`${title}-pattern-${index}`}
                  className="font-mono"
                  value={item.pattern}
                  placeholder={placeholder}
                  onChange={(event) => {
                    const next = [...items];
                    next[index] = { ...item, pattern: event.target.value };
                    onChange(next);
                  }}
                />
              </Field>
              {showDenyPrompt && (
                <Field>
                  <FieldLabel htmlFor={`${title}-deny-${index}`}>拒绝提示</FieldLabel>
                  <Input
                    id={`${title}-deny-${index}`}
                    value={item.denyPrompt ?? ""}
                    onChange={(event) => {
                      const next = [...items];
                      next[index] = { ...item, denyPrompt: event.target.value || undefined };
                      onChange(next);
                    }}
                  />
                </Field>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Switch
                    aria-label={`启用规则：${item.pattern || index + 1}`}
                    checked={item.enabled !== false}
                    onCheckedChange={(enabled) => {
                      const next = [...items];
                      next[index] = { ...item, enabled };
                      onChange(next);
                    }}
                  />
                  <span className="text-sm">{item.enabled === false ? "已停用" : "已启用"}</span>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
                  <Trash2 data-icon="inline-start" />删除规则
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => onChange([
            ...items,
            { id: createPatternDraftId(), pattern: "", enabled: true },
          ])}
        >
          <Plus data-icon="inline-start" />添加规则
        </Button>
      </CardContent>
    </Card>
  );
}
