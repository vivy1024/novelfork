import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/** Runtime 请求失败的说明：带 HTTP 状态；403 时说明是管理员权限问题。 */
export function errorMessage(error: unknown, adminOnlyLabel?: string): string {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? Number((error as { status?: unknown }).status)
			: undefined;
	const message = error instanceof Error ? error.message : String(error);
	if (adminOnlyLabel && status === 403) {
		return `403 禁止访问 — ${adminOnlyLabel}需要 Runtime 管理员权限。${message}`;
	}
	return status ? `${status} — ${message}` : message;
}

export function ErrorAlert({
	message,
	title = "请求失败",
}: {
	readonly message: string;
	readonly title?: string;
}) {
	return (
		<Alert>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

export function LoadingCards({ count = 2 }: { readonly count?: number }) {
	return (
		<div className="grid gap-3 md:grid-cols-2" role="status" aria-label="加载中">
			{Array.from({ length: count }, (_, item) => (
				<Card key={item}>
					<CardHeader>
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-full" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-8 w-full" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

export function SectionHeading({
	title,
	description,
	action,
}: {
	readonly title: string;
	readonly description: ReactNode;
	readonly action?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0">
				<h2 className="text-lg font-semibold">{title}</h2>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{action}
		</div>
	);
}

export function DeleteConfirmDialog({
	open,
	title,
	description,
	deleting,
	onOpenChange,
	onConfirm,
}: {
	readonly open: boolean;
	readonly title: string;
	readonly description: string;
	readonly deleting: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button type="button" variant="destructive" disabled={deleting} onClick={onConfirm}>
						{deleting ? "删除中…" : "删除"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
