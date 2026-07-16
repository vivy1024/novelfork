import { FileText, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import {
	createRoutinesClient,
	createSettingsClient,
	type GlobalPromptResult,
} from "../runtime-admin";
import { createRuntimeProductClient, type RuntimeBookPromptResult } from "../runtime/product-contract";

const routinesClient = createRoutinesClient();
const settingsClient = createSettingsClient();
const productClient = createRuntimeProductClient();

function errorMessage(error: unknown, label: string): string {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? Number((error as { status?: unknown }).status)
			: undefined;
	const message = error instanceof Error ? error.message : String(error);
	if (status === 403) return `${label}需要 Runtime 管理员权限。${message}`;
	return status ? `${label}：${status} — ${message}` : `${label}：${message}`;
}

export function RulesSection({ bookId, bookTitle }: { readonly bookId?: string; readonly bookTitle?: string }) {
	const [globalPrompt, setGlobalPrompt] = useState<GlobalPromptResult | null>(
		null,
	);
	const [globalContent, setGlobalContent] = useState("");
	const [globalBaseline, setGlobalBaseline] = useState("");
	const [filePath, setFilePath] = useState("");
	const [defaultPrompt, setDefaultPrompt] = useState("");
	const [defaultBaseline, setDefaultBaseline] = useState("");
	const [bookPrompt, setBookPrompt] = useState<RuntimeBookPromptResult | null>(null);
	const [bookContent, setBookContent] = useState("");
	const [bookBaseline, setBookBaseline] = useState("");
	const [bookFilePath, setBookFilePath] = useState("");
	const [loading, setLoading] = useState(true);
	const [savingGlobal, setSavingGlobal] = useState(false);
	const [savingDefault, setSavingDefault] = useState(false);
	const [savingBook, setSavingBook] = useState(false);
	const [globalSaved, setGlobalSaved] = useState(false);
	const [defaultSaved, setDefaultSaved] = useState(false);
	const [bookSaved, setBookSaved] = useState(false);
	const [errors, setErrors] = useState<string[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		setErrors([]);
		const [globalResult, settingsResult] = await Promise.allSettled([
			routinesClient.getGlobalPrompt(),
			settingsClient.get(),
		]);
		const nextErrors: string[] = [];
		if (globalResult.status === "fulfilled") {
			setGlobalPrompt(globalResult.value);
			const content = globalResult.value.content ?? "";
			setGlobalContent(content);
			setGlobalBaseline(content);
			setFilePath(
				globalResult.value.filePath ??
					globalResult.value.candidates[0]?.path ??
					"",
			);
		} else {
			nextErrors.push(
				errorMessage(globalResult.reason, "仓库根目录提示词加载失败"),
			);
		}
		if (settingsResult.status === "fulfilled") {
			const content = settingsResult.value.agent?.defaultSystemPrompt ?? "";
			setDefaultPrompt(content);
			setDefaultBaseline(content);
		} else {
			nextErrors.push(
				errorMessage(settingsResult.reason, "默认系统提示词加载失败"),
			);
		}
		if (bookId) {
			try {
				const result = await productClient.listBookRules(bookId);
				setBookPrompt(result);
				const content = result.content ?? "";
				setBookContent(content);
				setBookBaseline(content);
				setBookFilePath(result.filePath ?? result.candidates[0]?.path ?? "");
			} catch (bookError) {
				nextErrors.push(errorMessage(bookError, "作品规则加载失败"));
			}
		} else {
			setBookPrompt(null);
			setBookContent("");
			setBookBaseline("");
			setBookFilePath("");
		}
		setErrors(nextErrors);
		setLoading(false);
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	const globalDirty = globalContent !== globalBaseline;
	const defaultDirty = defaultPrompt !== defaultBaseline;
	const bookDirty = bookContent !== bookBaseline;
	async function saveBookPrompt() {
		if (!bookId || !bookFilePath) return;
		setSavingBook(true);
		setBookSaved(false);
		try {
			const result = await productClient.putBookRules(bookId, bookContent, bookFilePath);
			setBookFilePath(result.filePath);
			setBookBaseline(bookContent);
			setBookSaved(true);
			setBookPrompt(await productClient.listBookRules(bookId));
		} catch (saveError) {
			setErrors((current) => [...current, errorMessage(saveError, "作品规则保存失败")]);
		} finally {
			setSavingBook(false);
		}
	}
	async function restoreDefaultPrompt() {
		setSavingDefault(true);
		setDefaultSaved(false);
		try {
			const updated = await settingsClient.patch({ agent: { defaultSystemPrompt: null } });
			const content = updated.agent?.defaultSystemPrompt ?? "";
			setDefaultPrompt(content);
			setDefaultBaseline(content);
			setDefaultSaved(true);
		} catch (restoreError) {
			setErrors((current) => [...current, errorMessage(restoreError, "默认系统提示词恢复失败")]);
		} finally {
			setSavingDefault(false);
		}
	}
	async function saveDefaultPrompt() {
		setSavingDefault(true);
		setDefaultSaved(false);
		setErrors((current) =>
			current.filter((item) => !item.startsWith("默认系统提示词保存失败")),
		);
		try {
		const updated = await settingsClient.patch({
				agent: { defaultSystemPrompt: defaultPrompt.trim() ? defaultPrompt : null },
		});

			const content = updated.agent?.defaultSystemPrompt ?? defaultPrompt;
			setDefaultPrompt(content);
			setDefaultBaseline(content);
			setDefaultSaved(true);
		} catch (saveError) {
			setErrors((current) => [
				...current,
				errorMessage(saveError, "默认系统提示词保存失败"),
			]);
		} finally {
			setSavingDefault(false);
		}
	}

	async function saveGlobalPrompt() {
		if (!filePath) return;
		setSavingGlobal(true);
		setGlobalSaved(false);
		setErrors((current) =>
			current.filter((item) => !item.startsWith("仓库根目录提示词保存失败")),
		);
		try {
			const result = await routinesClient.putGlobalPrompt(
				globalContent,
				filePath,
			);
			setFilePath(result.filePath);
			setGlobalBaseline(globalContent);
			setGlobalSaved(true);
			const refreshed = await routinesClient.getGlobalPrompt();
			setGlobalPrompt(refreshed);
		} catch (saveError) {
			setErrors((current) => [
				...current,
				errorMessage(saveError, "仓库根目录提示词保存失败"),
			]);
		} finally {
			setSavingGlobal(false);
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-lg font-semibold">规则与提示词</h2>
				<p className="text-sm text-muted-foreground">
					分别管理 Runtime
					默认基础提示词，以及会追加到所有会话的仓库根目录提示词。
				</p>
			</div>

			<Alert>
				<ShieldCheck />
				<AlertTitle>两层提示词语义不同</AlertTitle>
				<AlertDescription>
					默认系统提示词只在 narrator 自身 systemPrompt 为空时使用；仓库根目录的
					AGENT.md（缺失时为 CLAUDE.md）会在每次构建系统提示词时追加。
				</AlertDescription>
			</Alert>
			{errors.map((error) => (
				<Alert key={error}>
					<AlertTitle>规则请求失败</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			))}

			{loading ? (
				<div className="grid gap-4 lg:grid-cols-2">
					{[0, 1].map((item) => (
						<Card key={item}>
							<CardHeader>
								<Skeleton className="h-5 w-40" />
								<Skeleton className="h-4 w-full" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-72 w-full" />
							</CardContent>
						</Card>
					))}
				</div>
			) : (
				<div className="grid gap-4 xl:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>默认系统提示词</CardTitle>
							<CardDescription>
								`settings.agent.defaultSystemPrompt` · narrator
								没有独立提示词时生效。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="default-system-prompt">
										默认系统提示词 Markdown
									</FieldLabel>
									<Textarea
										id="default-system-prompt"
										className="min-h-96 font-mono"
										value={defaultPrompt}
										onChange={(event) => {
											setDefaultPrompt(event.target.value);
											setDefaultSaved(false);
										}}
									/>
									<FieldDescription>
										空字符串表示不提供额外的默认基础提示词。
									</FieldDescription>
								</Field>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant="outline"
										disabled={savingDefault || !defaultPrompt}
										onClick={() => void restoreDefaultPrompt()}
									>
										恢复继承
									</Button>
									<Button
										type="button"
										disabled={savingDefault || !defaultDirty}
										onClick={() => void saveDefaultPrompt()}
									>
										<Save data-icon="inline-start" />
										{savingDefault ? "保存中…" : "保存默认提示词"}
									</Button>
									{defaultSaved && <Badge variant="secondary">已保存</Badge>}
								</div>
							</FieldGroup>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>仓库根目录提示词</CardTitle>
							<CardDescription>
								{filePath || "Runtime 尚未返回仓库根目录候选路径"}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FieldGroup>
								<Field>
									<FieldLabel>允许的文件</FieldLabel>
									<FieldDescription>
										仅使用当前 Git 仓库根目录的 AGENT.md；AGENT.md
										不存在时回退至同级
										CLAUDE.md。不会读取或写入用户目录、NARRAFORK_HOME
										或任意子目录。
									</FieldDescription>
								</Field>
								<div className="flex flex-wrap gap-2">
									{(globalPrompt?.candidates ?? []).map((candidate) => (
										<Badge
											key={candidate.path}
											variant={candidate.exists ? "secondary" : "outline"}
										>
											{candidate.path} ·{" "}
											{candidate.exists ? "已存在" : "不存在"}
										</Badge>
									))}
								</div>
								<Field>
									<FieldLabel htmlFor="global-agent-md">
										仓库根目录提示词 Markdown
									</FieldLabel>
									<Textarea
										id="global-agent-md"
										className="min-h-96 font-mono"
										value={globalContent}
										onChange={(event) => {
											setGlobalContent(event.target.value);
											setGlobalSaved(false);
										}}
									/>
									<FieldDescription>
										当前目标：
										{globalPrompt?.candidates.some(
											(candidate) =>
												candidate.path === filePath && candidate.exists,
										)
											? "覆盖仓库根目录已有文件"
											: "在仓库根目录创建 AGENT.md"}
										。
									</FieldDescription>
								</Field>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										disabled={savingGlobal || !filePath || !globalDirty}
										onClick={() => void saveGlobalPrompt()}
									>
										<FileText data-icon="inline-start" />
										{savingGlobal ? "保存中…" : "保存仓库提示词"}
									</Button>
									{globalSaved && <Badge variant="secondary">已保存</Badge>}
								</div>
							</FieldGroup>
						</CardContent>
					</Card>
					{bookId && (
						<Card className="xl:col-span-2">
							<CardHeader>
								<CardTitle>作品规则</CardTitle>
								<CardDescription>{bookTitle || bookId} · 通过可信书籍绑定读写受控作品根目录</CardDescription>
							</CardHeader>
							<CardContent>
								<FieldGroup>
									<Field>
										<FieldLabel>允许的文件</FieldLabel>
										<FieldDescription>仅允许受控作品根目录的 AGENT.md 或 CLAUDE.md；Runtime 服务端解析作品绑定，不接受前端路径构造。</FieldDescription>
									</Field>
									<div className="flex flex-wrap gap-2">
										{(bookPrompt?.candidates ?? []).map((candidate) => (
											<Badge key={candidate.path} variant={candidate.exists ? "secondary" : "outline"}>
												{candidate.path} · {candidate.exists ? "已存在" : "不存在"}
											</Badge>
										))}
									</div>
									<Field>
										<FieldLabel htmlFor="book-agent-md">作品规则 Markdown</FieldLabel>
										<Textarea
											id="book-agent-md"
											className="min-h-72 font-mono"
											value={bookContent}
											onChange={(event) => { setBookContent(event.target.value); setBookSaved(false); }}
										/>
										<FieldDescription>{bookFilePath || "Runtime 尚未返回作品规则候选路径"}</FieldDescription>
									</Field>
									<div className="flex flex-wrap items-center gap-2">
										<Button type="button" disabled={savingBook || !bookFilePath || !bookDirty} onClick={() => void saveBookPrompt()}>
											<FileText data-icon="inline-start" />
											{savingBook ? "保存中…" : "保存作品规则"}
										</Button>
										{bookSaved && <Badge variant="secondary">已保存</Badge>}
									</div>
								</FieldGroup>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
