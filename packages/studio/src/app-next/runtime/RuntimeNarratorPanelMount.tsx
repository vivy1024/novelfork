import { lazy, Suspense, useCallback, useEffect, useState } from "react";

const EmbeddedNarratorDockHost = lazy(() =>
	import("@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel").then(
		(module) => ({
			default: module.EmbeddedNarratorDockHost,
		}),
	),
);

import type {
	RuntimeFileOpenInterceptor,
	RuntimeToolResultAction,
} from "@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel";

import { useColorScheme } from "@/hooks/use-color-scheme";

import { executeToolResultAction } from "../tool-results/actions";
import { renderToolResult } from "../tool-results/registry";
import { chapterNumberFromRuntimeFilePath } from "./chapter-file-open";
import type { ToolResultAction, ToolResultArtifact } from "../tool-results/types";
import type { RuntimeNarratorSummary } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

export interface RuntimeNativeNarratorPanelMountProps {
	readonly narratorId: string;
	readonly compact?: boolean;
	readonly bookId?: string;
	/** 结果卡上的「在画布打开」：由宿主（写作工作台）决定打开哪个资源；不给则不显示该按钮。 */
	readonly onOpenArtifact?: (artifact: ToolResultArtifact) => void;
	/** 叙述者面板要打开文件时先交给宿主；返回 true 表示宿主已处理，不再打开 Runtime 文件面板。 */
	readonly onOpenFile?: RuntimeFileOpenInterceptor;
}

export interface RuntimeNarratorPanelMountProps {
	readonly bookId: string;
	readonly narrator: RuntimeNarratorSummary;
	readonly compact?: boolean;
	readonly onOpenArtifact?: (artifact: ToolResultArtifact) => void;
	/** 叙述者面板里点开本书章节时交给写作台打开；不给则仍用 Runtime 的文件面板。 */
	readonly onOpenChapter?: (chapterNumber: number) => void;
}

export interface RuntimeStandaloneNarratorPanelMountProps {
	readonly narrator: RuntimeNarratorRecord;
	readonly compact?: boolean;
}

function readHighlightMessageId(): string | undefined {
	if (typeof globalThis.location?.hash !== "string") return undefined;
	return globalThis.location.hash.startsWith("#msg-")
		? globalThis.location.hash.slice(5)
		: undefined;
}

/** The single unguarded Studio mount for the native NarraFork NarratorPanel. */
export function RuntimeNativeNarratorPanelMount({
	narratorId,
	compact,
	bookId,
	onOpenArtifact,
	onOpenFile,
}: RuntimeNativeNarratorPanelMountProps) {
	const [highlightMessageId, setHighlightMessageId] = useState(
		readHighlightMessageId,
	);
	// 嵌入的叙述者面板跟随 Studio 的明暗开关，而不是系统设置。
	const colorScheme = useColorScheme();
	const onAction = useCallback(
		(action: ToolResultAction) => {
			if (!bookId) {
				return Promise.reject(new Error("当前面板没有可信书籍绑定，无法执行结果卡操作。"));
			}
			return executeToolResultAction(bookId, action);
		},
		[bookId],
	);
	const renderToolResultWithAction = useCallback(
		(input: {
			toolName: string;
			renderer: string;
			result: unknown;
			onAction?: (action: RuntimeToolResultAction) => Promise<unknown> | unknown;
		}) => renderToolResult({
			toolName: input.toolName,
			result: input.result,
			onAction: input.onAction ?? onAction,
			...(onOpenArtifact ? { onOpenArtifact } : {}),
		}),
		[onAction, onOpenArtifact],
	);

	useEffect(() => {
		const update = () => setHighlightMessageId(readHighlightMessageId());
		window.addEventListener("hashchange", update);
		window.addEventListener("popstate", update);
		return () => {
			window.removeEventListener("hashchange", update);
			window.removeEventListener("popstate", update);
		};
	}, []);

	return (
		<section
			className="h-full min-h-0 w-full overflow-hidden"
			data-testid="native-runtime-narrator-panel"
			data-narrator-id={narratorId}
		>
			<Suspense
				fallback={
					<div
						role="status"
						className="grid h-full min-h-[160px] place-items-center p-4 text-sm text-muted-foreground"
					>
						正在加载原生 NarratorPanel…
					</div>
				}
			>
				<EmbeddedNarratorDockHost
					key={narratorId}
					narratorId={narratorId}
					highlightMessageId={highlightMessageId}
					compact={compact}
					toolResultRenderer={renderToolResultWithAction}
					{...(onOpenFile ? { onOpenFile } : {})}
					colorScheme={colorScheme}
				/>
			</Suspense>
		</section>
	);
}

/** Trusted book-bound guard. */
export function RuntimeNarratorPanelMount({
	bookId,
	narrator,
	compact,
	onOpenArtifact,
	onOpenChapter,
}: RuntimeNarratorPanelMountProps) {
	const bookRoot = narrator.cwd;
	// 章节在写作台里编辑（字数、结算、设定都在那边）；工具改动的对比视图仍交给 Runtime。
	const onOpenFile = useCallback<RuntimeFileOpenInterceptor>(
		(request) => {
			if (!onOpenChapter || request.toolEdit || request.deviceId !== "local") return false;
			const chapterNumber = chapterNumberFromRuntimeFilePath(request.filePath, bookRoot);
			if (chapterNumber === null) return false;
			onOpenChapter(chapterNumber);
			return true;
		},
		[bookRoot, onOpenChapter],
	);
	if (narrator.bookId !== bookId || narrator.capabilities.read !== true) {
		return (
			<p role="alert" className="p-4 text-sm text-destructive">
				当前 Runtime 叙述者不属于此书籍或不可访问
			</p>
		);
	}
	return (
		<RuntimeNativeNarratorPanelMount
			narratorId={narrator.id}
			compact={compact}
			bookId={bookId}
			{...(onOpenArtifact ? { onOpenArtifact } : {})}
			{...(onOpenChapter ? { onOpenFile } : {})}
		/>
	);
}

/** Canonical standalone guard. Chapter-bound IDs must never bypass product binding. */
export function RuntimeStandaloneNarratorPanelMount({
	narrator,
	compact,
}: RuntimeStandaloneNarratorPanelMountProps) {
	if (
		narrator.chapterId !== null ||
		narrator.type !== "primary" ||
		narrator.variant !== "primary"
	) {
		return (
			<p role="alert" className="p-4 text-sm text-destructive">
				当前 Runtime 叙述者不是可独立访问的主叙述者
			</p>
		);
	}
	return (
		<RuntimeNativeNarratorPanelMount
			narratorId={narrator.id}
			compact={compact}
		/>
	);
}
