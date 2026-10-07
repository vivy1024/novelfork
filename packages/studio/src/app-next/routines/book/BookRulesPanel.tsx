import { FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { createRuntimeProductClient, type RuntimeBookPromptResult } from "../../runtime/product-contract";
import { ErrorAlert, SectionHeading, errorMessage } from "../routines-shared";

const productClient = createRuntimeProductClient();

/**
 * 本书规则：作品根目录的 AGENT.md（缺失时 CLAUDE.md），每次构建这本书叙述者的系统提示词时追加。
 * 服务端按书籍绑定解析可写文件，前端只在候选里选，不构造路径。
 */
export function BookRulesPanel({ bookId, bookTitle }: { readonly bookId: string; readonly bookTitle: string }) {
	const [prompt, setPrompt] = useState<RuntimeBookPromptResult | null>(null);
	const [content, setContent] = useState("");
	const [baseline, setBaseline] = useState("");
	const [filePath, setFilePath] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		setSaved(false);
		try {
			const result = await productClient.listBookRules(bookId);
			setPrompt(result);
			setContent(result.content ?? "");
			setBaseline(result.content ?? "");
			setFilePath(result.filePath ?? result.candidates[0]?.path ?? "");
		} catch (loadError) {
			setPrompt(null);
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	async function save() {
		if (!filePath) return;
		setSaving(true);
		setSaved(false);
		setError(null);
		try {
			const result = await productClient.putBookRules(bookId, content, filePath);
			setFilePath(result.filePath);
			setBaseline(content);
			setSaved(true);
			setPrompt(await productClient.listBookRules(bookId));
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setSaving(false);
		}
	}

	const targetExists = prompt?.candidates.some((candidate) => candidate.path === filePath && candidate.exists) ?? false;

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="本书规则"
				description={`《${bookTitle}》作品根目录的 AGENT.md（没有时用 CLAUDE.md）。它追加在全局提示词之后，只影响这本书的叙述者；全局的系统提示词与仓库提示词在「通用套路」里改。`}
			/>
			{error && <ErrorAlert title="本书规则请求失败" message={error} />}
			{loading ? (
				<Card>
					<CardHeader>
						<Skeleton className="h-5 w-40" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-72 w-full" />
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>规则文件</CardTitle>
						<CardDescription>
							{filePath ? `${targetExists ? "覆盖" : "新建"} ${filePath}` : "Runtime 没有返回可写的候选文件"}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<FieldGroup>
							<div className="flex flex-wrap gap-2">
								{(prompt?.candidates ?? []).map((candidate) => (
									<Badge key={candidate.path} variant={candidate.exists ? "secondary" : "outline"}>
										{candidate.path} · {candidate.exists ? "已存在" : "不存在"}
									</Badge>
								))}
							</div>
							<Field>
								<FieldLabel htmlFor="book-rules-md">本书规则 Markdown</FieldLabel>
								<Textarea
									id="book-rules-md"
									className="min-h-72 font-mono"
									value={content}
									onChange={(event) => {
										setContent(event.target.value);
										setSaved(false);
									}}
								/>
								<FieldDescription>只能写作品根目录的这两个文件，不读写任何子目录。</FieldDescription>
							</Field>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									disabled={saving || !filePath || content === baseline}
									onClick={() => void save()}
								>
									<FileText data-icon="inline-start" />
									{saving ? "保存中…" : "保存本书规则"}
								</Button>
								{saved && (
									<Badge variant="secondary" role="status">
										已保存
									</Badge>
								)}
							</div>
						</FieldGroup>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
