import { ChevronDown, ChevronUp, Eye, FileCode, FolderTree, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { invalidateNarratorCommands } from "../../runtime/narrator-command-cache";
import { createRuntimeProductClient, type RuntimeBookSkillSummary } from "../../runtime/product-contract";
import { DeleteConfirmDialog, ErrorAlert, LoadingCards, SectionHeading, errorMessage } from "../routines-shared";

const productClient = createRuntimeProductClient();

interface SkillFormState {
	name: string;
	description: string;
	content: string;
}

const EMPTY_SKILL_FORM: SkillFormState = { name: "", description: "", content: "" };

interface FilePreview {
	readonly skillName: string;
	readonly fileName: string;
	readonly content?: string;
	readonly loading?: boolean;
}

/** 本书技能：书籍绑定的作品目录里的技能，服务端解析绑定，前端不接触路径与 Runtime 项目标识。 */
export function BookSkillsPanel({ bookId, bookTitle }: { readonly bookId: string; readonly bookTitle: string }) {
	const [skills, setSkills] = useState<readonly RuntimeBookSkillSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingName, setPendingName] = useState<string | null>(null);
	const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; currentName: string } | null>(null);
	const [form, setForm] = useState<SkillFormState>(EMPTY_SKILL_FORM);
	const [deleteName, setDeleteName] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [filePreview, setFilePreview] = useState<FilePreview | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setSkills(await productClient.listBookSkills(bookId));
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [bookId]);

	useEffect(() => {
		void load();
	}, [load]);

	// 换书即换可信作用域：不留上一本书的编辑框、删除确认与进行中状态。
	useEffect(() => {
		setEditor(null);
		setForm(EMPTY_SKILL_FORM);
		setDeleteName(null);
		setPendingName(null);
		setFilePreview(null);
	}, [bookId]);

	async function openFilePreview(skillName: string, fileName: string) {
		setFilePreview({ skillName, fileName, loading: true });
		try {
			const skill = await productClient.getBookSkill(bookId, skillName);
			setFilePreview({
				skillName,
				fileName,
				content: fileName === "SKILL.md" ? skill.content : `// 技能子文件：${fileName}\n\n${skill.content}`,
			});
		} catch (previewError) {
			setFilePreview({ skillName, fileName, content: `加载文件内容失败：${errorMessage(previewError)}` });
		}
	}

	async function openEdit(name: string) {
		setPendingName(name);
		setError(null);
		try {
			const skill = await productClient.getBookSkill(bookId, name);
			setForm({ name: skill.name, description: skill.description, content: skill.content });
			setEditor({ mode: "edit", currentName: name });
		} catch (editError) {
			setError(errorMessage(editError));
		} finally {
			setPendingName(null);
		}
	}

	async function saveSkill() {
		if (!editor) return;
		setPendingName(editor.mode === "edit" ? editor.currentName : form.name);
		setError(null);
		const input = { name: form.name.trim(), description: form.description.trim(), content: form.content };
		try {
			if (editor.mode === "create") await productClient.createBookSkill(bookId, input);
			else await productClient.updateBookSkill(bookId, editor.currentName, input);
			setEditor(null);
			setForm(EMPTY_SKILL_FORM);
			await invalidateNarratorCommands();
			await load();
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setPendingName(null);
		}
	}

	async function deleteSkill() {
		if (!deleteName) return;
		setPendingName(deleteName);
		setError(null);
		try {
			await productClient.deleteBookSkill(bookId, deleteName);
			setDeleteName(null);
			await invalidateNarratorCommands();
			await load();
		} catch (deleteError) {
			setError(errorMessage(deleteError));
		} finally {
			setPendingName(null);
		}
	}

	function openCreate() {
		setForm(EMPTY_SKILL_FORM);
		setEditor({ mode: "create" });
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="本书技能"
				description={`《${bookTitle}》作品目录里的技能（SKILL.md），只对这本书的叙述者可用；全局技能在「通用套路 › 全局技能」。写作配置里启用的写作技能存在作品数据库，不在这里。`}
				action={
					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
							<RefreshCw data-icon="inline-start" />
							重新扫描
						</Button>
						<Button type="button" size="sm" onClick={openCreate}>
							<Plus data-icon="inline-start" />
							创建技能
						</Button>
					</div>
				}
			/>
			{error && <ErrorAlert title="本书技能请求失败" message={error} />}
			{loading ? (
				<LoadingCards />
			) : skills.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Sparkles />
						</EmptyMedia>
						<EmptyTitle>这本书还没有技能</EmptyTitle>
						<EmptyDescription>先点「重新扫描」从作品目录发现已有技能；目录为空时再创建。</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button type="button" onClick={openCreate}>
							<Plus data-icon="inline-start" />
							创建技能
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{skills.map((skill) => {
						const open = expanded.has(skill.name);
						return (
							<Card key={skill.name}>
								<CardHeader>
									<CardTitle>{skill.name}</CardTitle>
									<CardDescription>{skill.description}</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									<div className="flex flex-wrap items-center gap-2">
										<Badge variant="outline">本书</Badge>
										<Badge variant={skill.disabled ? "destructive" : "secondary"}>
											{skill.disabled ? "已禁用" : "已启用"}
										</Badge>
										<Button
											type="button"
											variant="ghost"
											size="xs"
											aria-expanded={open}
											onClick={() =>
												setExpanded((prev) => {
													const next = new Set(prev);
													if (next.has(skill.name)) next.delete(skill.name);
													else next.add(skill.name);
													return next;
												})
											}
										>
											<FolderTree data-icon="inline-start" />
											{skill.files?.length ?? 0} 个文件
											{open ? <ChevronUp data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
										</Button>
									</div>
									{open && (
										<div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 text-xs">
											{skill.files && skill.files.length > 0 ? (
												skill.files.map((file) => (
													<button
														key={file}
														type="button"
														className="flex items-center justify-between rounded px-2 py-1 text-left hover:bg-muted"
														onClick={() => void openFilePreview(skill.name, file)}
													>
														<span className="flex items-center gap-1.5 font-mono text-muted-foreground">
															<FileCode className="size-3 text-primary" aria-hidden />
															{file}
														</span>
														<Eye className="size-3 text-muted-foreground" aria-hidden />
													</button>
												))
											) : (
												<div className="text-muted-foreground">（只有 SKILL.md）</div>
											)}
										</div>
									)}
									<div className="flex gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={pendingName === skill.name}
											onClick={() => void openEdit(skill.name)}
										>
											<Pencil data-icon="inline-start" />
											编辑
										</Button>
										<Button
											type="button"
											variant="destructive"
											size="sm"
											disabled={pendingName === skill.name}
											onClick={() => setDeleteName(skill.name)}
										>
											<Trash2 data-icon="inline-start" />
											删除
										</Button>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<Dialog
				open={editor !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
						setForm(EMPTY_SKILL_FORM);
					}
				}}
			>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{editor?.mode === "edit" ? "编辑本书技能" : "创建本书技能"}</DialogTitle>
						<DialogDescription>保存到《{bookTitle}》的作品目录，只对这本书生效。</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="book-skill-name">名称</Label>
							<Input
								id="book-skill-name"
								value={form.name}
								onChange={(event) => setForm({ ...form, name: event.target.value })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="book-skill-description">描述</Label>
							<Input
								id="book-skill-description"
								value={form.description}
								onChange={(event) => setForm({ ...form, description: event.target.value })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="book-skill-content">内容</Label>
							<Textarea
								id="book-skill-content"
								className="min-h-64 font-mono"
								value={form.content}
								onChange={(event) => setForm({ ...form, content: event.target.value })}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setEditor(null)}>
							取消
						</Button>
						<Button
							type="button"
							disabled={pendingName !== null || !form.name.trim() || !form.description.trim()}
							onClick={() => void saveSkill()}
						>
							{pendingName !== null ? "保存中…" : editor?.mode === "edit" ? "保存修改" : "创建"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<DeleteConfirmDialog
				open={deleteName !== null}
				title="删除本书技能"
				description={`确定从《${bookTitle}》删除技能“${deleteName ?? ""}”吗？`}
				deleting={deleteName !== null && pendingName === deleteName}
				onOpenChange={(open) => {
					if (!open) setDeleteName(null);
				}}
				onConfirm={() => void deleteSkill()}
			/>

			<Dialog open={filePreview !== null} onOpenChange={(open) => !open && setFilePreview(null)}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>
							{filePreview?.skillName} · {filePreview?.fileName}
						</DialogTitle>
						<DialogDescription>技能文件内容（只读）。</DialogDescription>
					</DialogHeader>
					{filePreview?.loading ? (
						<p className="p-8 text-center text-sm text-muted-foreground">正在读取技能文件…</p>
					) : (
						<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed">
							{filePreview?.content || "无内容"}
						</pre>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
