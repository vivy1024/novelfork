import { Info, Palette, Settings2, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { createUserPreferencesClient } from "../runtime-admin";
import { RuntimePageMount } from "../runtime/RuntimePageMount";
import { RUNTIME_PAGE_SECTIONS } from "../runtime/runtime-page-sections";
import type { SettingsNovelPanel, SettingsRoute } from "../shell/shell-route";
import { AboutPanel } from "./panels/AboutPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { EmbeddingSettingsPanel } from "./panels/EmbeddingSettingsPanel";
import { SetupWizardPanel } from "./panels/SetupWizardPanel";
import { UsersPanel } from "./panels/UsersPanel";

const RUNTIME_SETTINGS_ROOT = RUNTIME_PAGE_SECTIONS.settings;

const TABS: ReadonlyArray<{
	readonly id: SettingsNovelPanel | "runtime";
	readonly label: string;
	readonly icon: typeof Settings2;
	readonly description: string;
}> = [
	{
		id: "runtime",
		label: "通用设置",
		icon: Settings2,
		description:
			"NarraFork Runtime 自带的设置页：个人资料、安全、通知、AI 供应商、模型、AI 代理、网络搜索、代理、容器、服务器、认证、用户、终端、存储、运行资源、插件与使用历史等，对所有作品和叙述者都起作用。",
	},
	{
		id: "appearance",
		label: "外观与界面",
		icon: Palette,
		description: "书房主题与明暗是 NovelFork 产品外观，嵌入的 Runtime 界面一同切换；通用显示偏好在「通用设置 › 外观与界面」。",
	},
	{
		id: "embedding",
		label: "Embedding 供应商",
		icon: Sparkles,
		description: "向量模型是小说专属设置（经纬实体与记忆检索用），Runtime 原页没有，只在这里配置。",
	},
	{
		id: "users",
		label: "用户",
		icon: Users,
		description: "管理本机账户与注册开关；删除有数据的用户时走产品兜底（Runtime 原页只能删空账户）。",
	},
	{
		id: "about",
		label: "关于",
		icon: Info,
		description: "NovelFork 产品版本、发版说明与 Runtime 构建标识；Runtime 原页的「设置 › 关于」只含 Runtime 版本。",
	},
];

export interface SettingsNextPageProps {
	readonly route: SettingsRoute;
	readonly onNavigate: (route: SettingsRoute) => void;
	/** Runtime 原页要去 /settings 以外的 Runtime 路径（叙述者、套路……），由外壳决定去哪。 */
	readonly onNavigateRuntimePath: (path: string) => void;
}

/**
 * 设置页：通用部分直接嵌 Runtime 原生设置页（Studio 不再维护复制品），
 * Runtime 没有的小说专属与产品级设置是 NovelFork 自己的面板。
 */
export function SettingsNextPage({ route, onNavigate, onNavigateRuntimePath }: SettingsNextPageProps) {
	const panel = "panel" in route ? route.panel : null;
	const routeRuntimePath = "panel" in route ? null : (route.path ?? RUNTIME_SETTINGS_ROOT);
	// 与套路页同理：切到 NovelFork 面板时 Runtime 原页只是藏起来，回来时仍停在原来的子页。
	const [lastRuntimePath, setLastRuntimePath] = useState(routeRuntimePath ?? RUNTIME_SETTINGS_ROOT);
	const [runtimeMounted, setRuntimeMounted] = useState(routeRuntimePath !== null);
	const [wizardDismissed, setWizardDismissed] = useState<boolean>(true);

	useEffect(() => {
		void createUserPreferencesClient().get()
			.then((data) => {
				if ((data as { setupWizardCompleted?: boolean }).setupWizardCompleted === false) {
					setWizardDismissed(false);
				}
			})
			.catch(() => setWizardDismissed(true));
	}, []);

	useEffect(() => {
		if (routeRuntimePath === null) return;
		setLastRuntimePath(routeRuntimePath);
		setRuntimeMounted(true);
	}, [routeRuntimePath]);

	const activeTab = TABS.find((tab) => tab.id === (panel ?? "runtime")) ?? TABS[0]!;

	// 与原设置页一致：首次设置向导未完成时整页换成向导，两个世界的内容都不渲染。
	if (!wizardDismissed) {
		return (
			<section aria-label="设置" data-testid="settings-page" className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
				<div className="mx-auto w-full max-w-[960px] p-4">
					<SetupWizardPanel onComplete={() => setWizardDismissed(true)} />
				</div>
			</section>
		);
	}

	function openTab(id: SettingsNovelPanel | "runtime") {
		if (id !== "runtime") {
			onNavigate({ kind: "settings", panel: id });
			return;
		}
		onNavigate(lastRuntimePath === RUNTIME_SETTINGS_ROOT ? { kind: "settings" } : { kind: "settings", path: lastRuntimePath });
	}

	return (
		<section aria-label="设置" data-testid="settings-page" className="flex h-full min-h-0 w-full flex-col">
			<header className="shrink-0 border-b bg-background py-3">
				<div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4">
					<h1 className="sr-only">设置</h1>
					<div role="tablist" aria-label="设置页签" className="flex flex-wrap gap-1">
						{TABS.map((tab) => {
							const Icon = tab.icon;
							const selected = tab.id === activeTab.id;
							return (
								<Button
									key={tab.id}
									type="button"
									role="tab"
									aria-selected={selected}
									variant={selected ? "secondary" : "ghost"}
									size="sm"
									onClick={() => openTab(tab.id)}
								>
									<Icon data-icon="inline-start" />
									{tab.label}
								</Button>
							);
						})}
					</div>
					<p className="text-sm text-muted-foreground">{activeTab.description}</p>
				</div>
			</header>

			<div className="min-h-0 flex-1">
				{runtimeMounted && (
					<div hidden={panel !== null} className="h-full min-h-0" data-testid="settings-runtime-page">
						<RuntimePageMount
							section="settings"
							path={routeRuntimePath ?? lastRuntimePath}
							onPathChange={(path) => onNavigate({ kind: "settings", path })}
							onNavigateOutside={onNavigateRuntimePath}
						/>
					</div>
				)}
				{panel !== null && (
					<div role="tabpanel" aria-label={activeTab.label} className="h-full min-h-0 overflow-y-auto">
						<div className="mx-auto w-full max-w-[960px] p-4">
							{panel === "appearance" ? (
								<AppearancePanel />
							) : panel === "embedding" ? (
								<EmbeddingSettingsPanel />
							) : panel === "users" ? (
								<UsersPanel />
							) : (
								<AboutPanel />
							)}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
