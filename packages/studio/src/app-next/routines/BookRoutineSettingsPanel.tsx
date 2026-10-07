import { BookOpen, Braces, FileText, PenLine, Settings2, Sparkles, Wrench } from "lucide-react";
import { Suspense, useMemo, useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SimpleSelect } from "@/components/ui/simple-select";

import { getPluginUISections } from "../plugin-ui/register-plugins";
import { getPluginSection } from "../plugin-ui/section-registry";
import type { ShellBookItem } from "../shell/shell-route";
import { BookHooksPanel } from "./book/BookHooksPanel";
import { BookMcpOverridesPanel } from "./book/BookMcpOverridesPanel";
import { BookRoutineOverridesPanel } from "./book/BookRoutineOverridesPanel";
import { BookRulesPanel } from "./book/BookRulesPanel";
import { BookSkillsPanel } from "./book/BookSkillsPanel";

type BookPanelProps = { readonly bookId: string; readonly bookTitle: string };

const BOOK_SECTIONS: ReadonlyArray<{
	readonly id: string;
	readonly label: string;
	readonly icon: typeof Wrench;
	readonly Component: ComponentType<BookPanelProps>;
}> = [
	{ id: "tools", label: "可选工具", icon: Wrench, Component: BookRoutineOverridesPanel },
	{ id: "skills", label: "技能", icon: Sparkles, Component: BookSkillsPanel },
	{ id: "rules", label: "规则", icon: FileText, Component: BookRulesPanel },
	{ id: "mcp", label: "MCP 权限", icon: Braces, Component: BookMcpOverridesPanel },
	{ id: "hooks", label: "钩子", icon: Settings2, Component: BookHooksPanel },
];

/**
 * 「本书设置」：Runtime 原生套路页没有、只属于一本书的设置。
 * 插件贡献的套路分区（小说插件的「写作配置」）排在最前，其余是对全局套路的按书覆盖。
 */
export function BookRoutineSettingsPanel({
	books,
	selectedBook,
	onSelectBook,
}: {
	readonly books: readonly ShellBookItem[];
	readonly selectedBook: ShellBookItem | null;
	readonly onSelectBook: (bookId: string) => void;
}) {
	const pluginSections = useMemo(() => getPluginUISections("routines"), []);
	const [activeId, setActiveId] = useState<string>(() => pluginSections[0]?.componentKey ?? BOOK_SECTIONS[0]!.id);

	if (!selectedBook) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<BookOpen />
					</EmptyMedia>
					<EmptyTitle>还没有作品</EmptyTitle>
					<EmptyDescription>先在首页新建或导入一本书，再来设置它的写作配置与套路覆盖。</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const bookId = selectedBook.id;
	const bookTitle = selectedBook.title;
	const activePlugin = pluginSections.find((section) => section.componentKey === activeId);
	const activeBuiltin = BOOK_SECTIONS.find((section) => section.id === activeId);
	const PluginComponent = activePlugin ? getPluginSection(activePlugin.componentKey) : undefined;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">作品</span>
					{books.length > 1 ? (
						<SimpleSelect
							aria-label="选择作品"
							className="w-72 max-w-full"
							value={bookId}
							onValueChange={onSelectBook}
							options={books.map((book) => ({ value: book.id, label: book.title }))}
						/>
					) : (
						<p className="text-sm">
							《{bookTitle}》
						</p>
					)}
				</div>
				<div role="tablist" aria-label="本书设置分区" className="flex flex-wrap gap-1">
					{pluginSections.map((section) => (
						<Button
							key={section.componentKey}
							type="button"
							role="tab"
							aria-selected={section.componentKey === activeId}
							variant={section.componentKey === activeId ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setActiveId(section.componentKey)}
						>
							<PenLine data-icon="inline-start" />
							{section.label}
						</Button>
					))}
					{BOOK_SECTIONS.map((section) => {
						const Icon = section.icon;
						return (
							<Button
								key={section.id}
								type="button"
								role="tab"
								aria-selected={section.id === activeId}
								variant={section.id === activeId ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setActiveId(section.id)}
							>
								<Icon data-icon="inline-start" />
								{section.label}
							</Button>
						);
					})}
				</div>
			</div>

			<div role="tabpanel" aria-label={activePlugin?.label ?? activeBuiltin?.label}>
				{activePlugin &&
					(PluginComponent ? (
						<Suspense fallback={<p className="text-sm text-muted-foreground">加载中…</p>}>
							<PluginComponent key={bookId} bookId={bookId} />
						</Suspense>
					) : (
						<p className="text-sm text-muted-foreground">插件分区「{activePlugin.label}」没有注册渲染组件。</p>
					))}
				{activeBuiltin && <activeBuiltin.Component key={bookId} bookId={bookId} bookTitle={bookTitle} />}
			</div>
		</div>
	);
}
