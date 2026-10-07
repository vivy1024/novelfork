import { Braces, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SimpleSelect } from "@/components/ui/simple-select";

import { createMcpClient, type McpBehavior, type McpServerStatus } from "../../runtime-admin";
import {
	createRuntimeProductClient,
	type RuntimeBookMcpOverridePatch,
	type RuntimeBookMcpServerOverride,
} from "../../runtime/product-contract";
import { ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "../routines-shared";

const mcpClient = createMcpClient();
const productClient = createRuntimeProductClient();

type BehaviorChoice = McpBehavior | "inherit";

const BEHAVIOR_OPTIONS: ReadonlyArray<{ value: McpBehavior; label: string }> = [
	{ value: "readOnly", label: "只读" },
	{ value: "readWrite", label: "读写" },
	{ value: "ask", label: "询问" },
	{ value: "deny", label: "拒绝" },
];

function behaviorLabel(behavior: McpBehavior | undefined): string {
	return BEHAVIOR_OPTIONS.find((option) => option.value === behavior)?.label ?? "Runtime 默认";
}

/**
 * 本书 MCP 权限：在全局 MCP 服务器之上，为一本书单独收紧或放开服务器与逐工具的权限。
 * 服务器本身的增删、连接与全局权限在 Runtime 原页（通用套路 › MCP 工具）里管。
 */
export function BookMcpOverridesPanel({ bookId, bookTitle }: { readonly bookId: string; readonly bookTitle: string }) {
	const [servers, setServers] = useState<readonly McpServerStatus[]>([]);
	const [overrides, setOverrides] = useState<readonly RuntimeBookMcpServerOverride[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingKey, setPendingKey] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [serverResult, overrideResult] = await Promise.all([
				mcpClient.list(),
				productClient.listBookMcpOverrides(bookId),
			]);
			setServers(serverResult.servers);
			setOverrides(overrideResult.serverOverrides);
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	const overrideByServer = useMemo(
		() => new Map(overrides.map((override) => [override.serverId, override] as const)),
		[overrides],
	);

	async function patch(serverId: string, key: string, body: RuntimeBookMcpOverridePatch) {
		setPendingKey(key);
		setError(null);
		try {
			const result = await productClient.putBookMcpOverride(bookId, serverId, body);
			setOverrides(result.serverOverrides);
		} catch (patchError) {
			setError(errorMessage(patchError));
		} finally {
			setPendingKey(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="MCP 权限覆盖"
				description={`只影响《${bookTitle}》。选「继承」会删除本书的覆盖，回到全局设置；MCP 服务器的添加、连接和全局权限在「通用套路 › MCP 工具」里改。`}
				action={
					<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
						<RefreshCw data-icon="inline-start" />
						刷新
					</Button>
				}
			/>
			{error && <ErrorAlert title="MCP 权限请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : servers.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Braces />
						</EmptyMedia>
						<EmptyTitle>还没有 MCP 服务器</EmptyTitle>
						<EmptyDescription>先在「通用套路 › MCP 工具」添加服务器，再回来为这本书设权限。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-3">
					{servers.map((server) => {
						const override = overrideByServer.get(server.id);
						const serverKey = `server:${server.id}`;
						return (
							<Card key={server.id}>
								<CardHeader>
									<CardTitle className="flex flex-wrap items-center gap-2">
										{server.name}
										<Badge variant="outline">{server.status === "connected" ? "已连接" : "未连接"}</Badge>
									</CardTitle>
									<CardDescription>全局默认：{behaviorLabel(server.defaultBehavior)}</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-col gap-2">
									<div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
										<span className="text-sm font-medium">本书的服务器默认行为</span>
										<SimpleSelect
											aria-label={`本书服务器权限：${server.name}`}
											value={override?.defaultBehavior ?? "inherit"}
											disabled={pendingKey === serverKey}
											onValueChange={(value) =>
												void patch(server.id, serverKey, {
													defaultBehavior: value === "inherit" ? null : (value as McpBehavior),
												})
											}
											options={[{ value: "inherit", label: "继承全局" }, ...BEHAVIOR_OPTIONS]}
										/>
									</div>
									{server.tools.map((tool) => {
										const permission = override?.toolPermissions?.find((item) => item.toolName === tool.name);
										const value: BehaviorChoice =
											permission && permission.enabled !== false ? permission.behavior : "inherit";
										const toolKey = `tool:${server.id}:${tool.name}`;
										return (
											<div
												key={tool.name}
												className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
											>
												<div className="flex min-w-0 flex-col gap-1">
													<span className="truncate font-mono text-xs">{tool.name}</span>
													<span className="text-xs text-muted-foreground">
														继承时先看本书的服务器设置，本书没设再看全局。
													</span>
												</div>
												<SimpleSelect
													aria-label={`本书工具权限：${server.name}/${tool.name}`}
													value={value}
													disabled={pendingKey === toolKey}
													onValueChange={(next) =>
														void patch(server.id, toolKey, {
															toolPermissionPatch: {
																toolName: tool.name,
																behavior: next === "inherit" ? null : (next as McpBehavior),
															},
														})
													}
													options={[{ value: "inherit", label: "继承上层" }, ...BEHAVIOR_OPTIONS]}
												/>
											</div>
										);
									})}
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
