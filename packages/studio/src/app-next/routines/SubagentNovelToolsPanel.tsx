import { Bot, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

import { createCustomSubagentsClient, type CustomSubagent } from "../runtime-admin";
import { ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "./routines-shared";

const subagentsClient = createCustomSubagentsClient();

/**
 * 小说插件贡献、可给子代理用的只读领域工具。Runtime 原页的子代理编辑框只列通用工具，
 * 但保存时原样保留它不认识的工具名，所以两边各管各的、互不覆盖。
 */
export const NOVEL_SUBAGENT_TOOLS: ReadonlyArray<{ readonly name: string; readonly label: string }> = [
	{ name: "chapter.read", label: "读章节" },
	{ name: "chapter.list", label: "列章节" },
	{ name: "lore.read", label: "读经纬" },
	{ name: "memory.read", label: "读记忆" },
	{ name: "memory.graph", label: "记忆图谱" },
	{ name: "memory.search", label: "搜记忆" },
	{ name: "memory.list", label: "列记忆" },
	{ name: "cockpit.snapshot", label: "驾驶舱快照" },
	{ name: "chapter.audit", label: "章节审校" },
	{ name: "skills.read", label: "读技能" },
	{ name: "hooks.manage", label: "管理钩子" },
	{ name: "character.check_consistency", label: "角色一致性检查" },
];

/**
 * 子代理小说工具：给「通用套路 › 自定义子代理」里工具访问为 Custom tool list 的子代理勾选小说工具。
 * 子代理本身是全局的，不按书区分。
 */
export function SubagentNovelToolsPanel() {
	const [subagents, setSubagents] = useState<readonly CustomSubagent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingName, setPendingName] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setSubagents(await subagentsClient.list());
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function toggleTool(subagent: CustomSubagent, tool: string) {
		const customTools = subagent.customTools.includes(tool)
			? subagent.customTools.filter((name) => name !== tool)
			: [...subagent.customTools, tool];
		setPendingName(subagent.name);
		setError(null);
		try {
			// 整条定义原样写回，只改工具列表；子代理的其余字段由 Runtime 原页管理。
			const updated = await subagentsClient.update(subagent.name, { ...subagent, customTools });
			setSubagents((current) => current.map((item) => (item.name === subagent.name ? updated : item)));
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setPendingName(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="子代理可用的小说工具"
				description="自定义子代理在「通用套路 › 自定义子代理」里创建和编辑；那里只列通用工具。要让子代理读章节、经纬或记忆，在这里勾选——只对工具访问选了「Custom tool list」的子代理有效，改完对新派出的子代理生效。"
				action={
					<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
						<RefreshCw data-icon="inline-start" />
						刷新
					</Button>
				}
			/>
			{error && <ErrorAlert title="子代理请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : subagents.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Bot />
						</EmptyMedia>
						<EmptyTitle>还没有自定义子代理</EmptyTitle>
						<EmptyDescription>先在「通用套路 › 自定义子代理」创建一个，工具访问选「Custom tool list」。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{subagents.map((subagent) => {
						const custom = subagent.toolAccess === "custom";
						const otherTools = subagent.customTools.filter(
							(tool) => !NOVEL_SUBAGENT_TOOLS.some((item) => item.name === tool),
						);
						return (
							<Card key={subagent.name}>
								<CardHeader>
									<CardTitle>{subagent.name}</CardTitle>
									<CardDescription>{subagent.description}</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									{custom ? (
										<>
											<fieldset className="flex flex-wrap gap-1.5" aria-label={`小说工具：${subagent.name}`}>
												{NOVEL_SUBAGENT_TOOLS.map((tool) => {
													const active = subagent.customTools.includes(tool.name);
													return (
														<Button
															key={tool.name}
															type="button"
															size="xs"
															variant={active ? "default" : "outline"}
															aria-pressed={active}
															title={tool.name}
															disabled={pendingName === subagent.name}
															onClick={() => void toggleTool(subagent, tool.name)}
														>
															{tool.label}
														</Button>
													);
												})}
											</fieldset>
											<p className="text-xs text-muted-foreground">
												通用工具（在原页勾选）：{otherTools.length > 0 ? otherTools.join("、") : "无"}
											</p>
										</>
									) : (
										<p className="text-sm text-muted-foreground">
											工具访问是「{subagent.toolAccess === "general" ? "General（可写）" : "Read-only"}」，不按工具列表限制，这里不能单独加小说工具。要指定工具，先在「通用套路 › 自定义子代理」把工具访问改为「Custom tool list」。
										</p>
									)}
									{custom && subagent.customTools.some((tool) => NOVEL_SUBAGENT_TOOLS.some((item) => item.name === tool)) && (
										<Badge variant="outline" className="w-fit">
											已加入 {subagent.customTools.filter((tool) => NOVEL_SUBAGENT_TOOLS.some((item) => item.name === tool)).length} 个小说工具
										</Badge>
									)}
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
