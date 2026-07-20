import { lazy, Suspense, useEffect, useState } from "react";

const EmbeddedNarratorDockHost = lazy(() =>
	import("@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel").then(
		(module) => ({
			default: module.EmbeddedNarratorDockHost,
		}),
	),
);

import { renderToolResult } from "../tool-results/registry";
import type { RuntimeNarratorSummary } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

export interface RuntimeNativeNarratorPanelMountProps {
	readonly narratorId: string;
	readonly compact?: boolean;
}

export interface RuntimeNarratorPanelMountProps {
	readonly bookId: string;
	readonly narrator: RuntimeNarratorSummary;
	readonly compact?: boolean;
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
}: RuntimeNativeNarratorPanelMountProps) {
	const [highlightMessageId, setHighlightMessageId] = useState(
		readHighlightMessageId,
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
					toolResultRenderer={renderToolResult}
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
}: RuntimeNarratorPanelMountProps) {
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
