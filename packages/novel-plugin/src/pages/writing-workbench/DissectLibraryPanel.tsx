import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookMarked, ChevronDown, ChevronRight, FileText, Folder, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchJson as defaultFetch } from "@/hooks/use-api";
import type { ChapterSelection, DissectBuildInput, DissectNode } from "../../engine/dissect-library/dissect-library";

interface LibraryTree { tree: DissectNode; referenceFiles: { path: string; title: string; bytes: number }[] }
export interface DissectLibraryPanelProps {
  bookId: string;
  sidebarHost?: HTMLElement | null;
  fetchJson?: (path: string, init?: RequestInit) => Promise<unknown>;
  onSendToNarrator?: (message: string) => Promise<void> | void;
  onDirtyChange?: (title: string | null) => void;
}
export function nextDissectSelection(selection: ChapterSelection): ChapterSelection {
  const end = selection.preset === "first5" ? 5 : selection.preset === "first10" ? 10 : selection.to ?? 0;
  return { preset: "range", from: end + 1, to: end + 10 };
}
function TreeNode({ node, selected, onSelect }: { node: DissectNode; selected?: string; onSelect: (node: DissectNode) => void }) {
  const [open, setOpen] = useState(true);
  const directory = node.kind === "directory";
  const Icon = directory ? Folder : FileText;
  return <li className="min-w-0 list-none">
    <button type="button" aria-expanded={directory ? open : undefined} aria-current={selected === node.path ? "page" : undefined} title={directory ? node.title : `${node.title} · ${node.wordCount} 字`} className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary" onClick={() => directory ? setOpen(!open) : onSelect(node)}>
      {directory ? open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" /> : <span className="w-3 shrink-0" />}
      <Icon className="size-3.5 shrink-0" strokeWidth={1.65} /><span className="truncate">{node.title}</span>
    </button>
    {directory && open && <ul className="ml-3 border-l border-border/50 pl-1">{node.children?.map((child) => <TreeNode key={child.path} node={child} selected={selected} onSelect={onSelect} />)}</ul>}
  </li>;
}
function DissectMarkdown({ content }: { content: string }) {
  const [limit, setLimit] = useState(500);
  const all = content.split("\n"); const lines = all.slice(0, limit);
  const blocks: React.ReactNode[] = [];
  const inline = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") ? <code key={index} className="rounded bg-muted px-1 font-mono text-sm">{part.slice(1, -1)}</code> : part);
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\|/.test(line) && /^\|[\s:|\-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) => row.replace(/^\||\|\s*$/g, "").split(/(?<!\\)\|/).map((value) => value.trim().replace(/\\\|/g, "|"));
      const headers = cells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(<div key={i} className="my-6 overflow-x-auto rounded border border-border"><table className="w-full border-collapse text-left font-sans text-sm leading-relaxed"><thead className="bg-muted/50"><tr>{headers.map((value, j) => <th key={j} className="border-b border-border px-3 py-2 font-medium">{inline(value)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j} className="border-b border-border/50 last:border-0">{row.map((value, k) => <td key={k} className="min-w-20 px-3 py-3 align-top">{inline(value)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(heading[1]!.length === 1 ? <h1 key={i} className="mb-8 mt-2 font-serif text-2xl font-medium">{inline(heading[2]!)}</h1> : <h2 key={i} className="mb-4 mt-8 font-serif text-xl font-medium">{inline(heading[2]!)}</h2>); i++; continue; }
    if (line.startsWith("```")) { const code: string[] = []; i++; while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!); i++; blocks.push(<pre key={i} className="my-4 overflow-auto rounded bg-muted p-4 font-mono text-sm">{code.join("\n")}</pre>); continue; }
    if (line.startsWith(">")) { const quote: string[] = []; while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, "")); blocks.push(<blockquote key={i} className="my-5 border-l-2 border-primary/25 pl-4 text-sm leading-loose text-muted-foreground">{inline(quote.join("\n"))}</blockquote>); continue; }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !/^(?:#{1,6}\s|\||>|```)/.test(lines[i]!)) paragraph.push(lines[i++]!);
    blocks.push(<p key={i} className="my-4 whitespace-pre-wrap font-serif text-base leading-loose">{inline(paragraph.join("\n"))}</p>);
  }
  return <article aria-label="拆书报告预览" className="h-full overflow-auto bg-card px-8 py-8 text-foreground"><div className="mx-auto max-w-3xl">{blocks}{all.length > limit && <Button variant="outline" onClick={() => setLimit(limit + 500)}>继续阅读后 500 行</Button>}</div></article>;
}
export function DissectLibraryPanel({ bookId, sidebarHost, fetchJson = defaultFetch, onSendToNarrator, onDirtyChange }: DissectLibraryPanelProps) {
  const base = `/api/books/${encodeURIComponent(bookId)}/dissect-library`;
  const [library, setLibrary] = useState<LibraryTree | null>(null);
  const [document, setDocument] = useState<{ path: string; title: string; content: string } | null>(null);
  const [draft, setDraft] = useState(""); const [editing, setEditing] = useState(false);
  const [drawer, setDrawer] = useState(false); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [category, setCategory] = useState("仙侠"); const [source, setSource] = useState(""); const [text, setText] = useState("");
  const [selection, setSelection] = useState<ChapterSelection>({ preset: "first5" });
  const [mode, setMode] = useState<"per-chapter" | "merged">("merged"); const [template, setTemplate] = useState<NonNullable<DissectBuildInput["template"]>>("full"); const [useModel, setUseModel] = useState(false);
  const request = useRef(0); const alive = useRef(true);
  const dirty = document !== null && draft !== document.content;
  useEffect(() => { onDirtyChange?.(dirty ? document.title : null); return () => onDirtyChange?.(null); }, [dirty, document?.title, onDirtyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const refresh = useCallback(async () => { const result = await fetchJson(`${base}/tree`) as LibraryTree; if (alive.current) setLibrary(result); }, [base, fetchJson]);
  useEffect(() => { setDocument(null); setDraft(""); setLibrary(null); void refresh().catch((e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : "读取拆书库失败"); }); }, [refresh]);
  const openDoc = async (node: DissectNode) => {
    if (dirty && !window.confirm("当前报告有未保存修改，放弃修改并切换？")) return;
    const seq = ++request.current; setError(null);
    try { const result = await fetchJson(`${base}/doc?path=${encodeURIComponent(node.path)}`) as { content: string }; if (alive.current && request.current === seq) { setDocument({ path: node.path, title: node.title, content: result.content }); setDraft(result.content); setEditing(false);
      const slug = node.path.split("/")[3];
      const entry = library?.tree.children?.find((child) => child.title === "小说")?.children?.find((child) => child.title === slug);
      if (entry?.meta) { setTitle(entry.meta.bookTitle); setCategory(entry.meta.category); if (entry.meta.sourceFile) setSource(entry.meta.sourceFile); const last = Math.max(0, ...entry.meta.analyzedRanges.map((range) => range.to)); if (last < entry.meta.totalChapters) setSelection({ preset: "range", from: last + 1, to: Math.min(last + 10, entry.meta.totalChapters) }); } } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "读取文档失败"); }
  };
  const save = async () => {
    if (!document) return; const snapshot = draft; const path = document.path; setSaving(true); setError(null);
    try { await fetchJson(`${base}/doc`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: snapshot }) }); if (alive.current) { setDocument((current) => current?.path === path ? { ...current, content: snapshot } : current); setNotice("报告已保存"); await refresh(); } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "保存失败，修改仍保留"); } finally { if (alive.current) setSaving(false); }
  };
  const build = async (mechanical = false) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await fetchJson(`${base}/build`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookTitle: title, category, ...(source ? { filePath: source } : { text }), chapterSelection: mechanical ? { preset: "all" } : selection, dissectMode: mode, template, useModel: mechanical ? false : useModel }) }) as { selectedRange: { from: number; to: number }; generatedDocuments: number; modelRefined: boolean };
      if (!alive.current) return;
      setNotice(`已建 ${result.generatedDocuments} 份文档；${result.modelRefined ? "已完成深度精炼" : "原文扫描证据已齐备，语义结论待核对"}。`); setSelection({ preset: "range", ...result.selectedRange }); setDrawer(false); await refresh();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "建库失败"); } finally { if (alive.current) setBusy(false); }
  };
  const remove = async () => {
    const slug = document?.path.split("/")[3]; if (!slug || !window.confirm(`删除《${slug}》的全部拆书文档？此操作不可撤销。`)) return;
    setBusy(true); try { await fetchJson(`${base}/books/${encodeURIComponent(slug)}`, { method: "DELETE" }); if (alive.current) { setDocument(null); setDraft(""); await refresh(); } } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); } finally { setBusy(false); }
  };
  const sidebar = <aside className="flex h-full min-h-0 flex-col bg-card" aria-label="拆书库目录">
    <header className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-sm font-medium"><BookMarked className="size-4" strokeWidth={1.65} />拆书库</span><Button variant="ghost" size="icon" aria-label="拆新书 / 增量拆解" onClick={() => setDrawer(true)}><Plus /></Button></header>
    <div className="min-h-0 flex-1 overflow-auto p-2">{library ? library.tree.children?.length ? <ul><TreeNode node={library.tree} selected={document?.path} onSelect={(node) => void openDoc(node)} /></ul> : <p className="px-3 py-6 text-xs leading-relaxed text-muted-foreground">把读过的好书，整理成自己的写作方法。点击 +，从一本书开始。</p> : <p className="p-3 text-xs text-muted-foreground">正在翻阅书架…</p>}</div>
    <p className="border-t border-border px-4 py-3 text-2xs text-muted-foreground">报告 · 结构卡 · 百章卷摘要</p>
  </aside>;
  return <section className="flex h-full min-h-0 bg-background" aria-label="拆书库工作面">
    {sidebarHost ? createPortal(sidebar, sidebarHost) : <div className="w-64 shrink-0 border-r border-border">{sidebar}</div>}
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3"><div><p className="text-2xs tracking-widest text-muted-foreground">读书有痕 · 写作有据</p><h2 className="mt-1 text-base font-medium">{document?.title ?? "拆书与精读"}</h2></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setDrawer(true)}><Plus />拆新书 / 增量拆解</Button>{document && <Button variant="ghost" size="icon" aria-label="删除此拆书条目" disabled={busy} onClick={() => void remove()}><Trash2 /></Button>}</div></header>
      {error && <p role="alert" className="border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">{error}</p>}{notice && <p role="status" className="border-b border-border px-5 py-2 text-xs text-muted-foreground">{notice}</p>}
      {document ? <><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2"><ToggleGroup value={[editing ? "edit" : "preview"]} onValueChange={(value) => { if (value[0]) setEditing(value[0] === "edit"); }} aria-label="报告显示方式"><ToggleGroupItem value="preview">预览</ToggleGroupItem><ToggleGroupItem value="edit">编辑</ToggleGroupItem></ToggleGroup><div className="flex items-center gap-2">{dirty && <Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存修改"}</Button>}<Button size="sm" variant="ghost" disabled={!onSendToNarrator} onClick={() => { void Promise.resolve(onSendToNarrator?.(`请和我讨论拆书报告《${document.title}》，用于本书的大纲与细纲设计。以下只是参考书分析，不能直接当成本书设定或照搬原句：\n\n${draft.slice(0, 6000)}`)).catch((e: unknown) => setError(e instanceof Error ? e.message : "发送失败")); }}><MessageSquare />和叙述者讨论此篇</Button></div></div>
      <div className="min-h-0 flex-1">{editing ? <Textarea aria-label="拆书报告正文" className="h-full resize-none rounded-none border-0 px-10 py-7 font-serif text-base leading-loose focus-visible:ring-0" value={draft} onChange={(event) => setDraft(event.target.value)} /> : <DissectMarkdown key={document.path} content={draft} />}</div></> : <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center"><BookMarked className="size-10 text-primary/60" strokeWidth={1.2} /><h3 className="font-serif text-xl">从读懂一本好书开始</h3><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">左侧选一篇报告，精读开篇、节奏与情绪钩子。<br />把阅读发现留成可编辑的 Markdown，带回自己的故事。</p><Button variant="outline" onClick={() => setDrawer(true)}>+ 拆新书</Button></div>}
    </main>
    <Sheet open={drawer} onOpenChange={(value) => { if (!busy) setDrawer(value); }}><SheetContent className="overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>拆新书 / 增量拆解</SheetTitle><SheetDescription>先用原文扫描建齐目录，再按章节精读。深度精炼使用设置中的默认模型。</SheetDescription></SheetHeader>
      <form className="flex flex-col gap-3 px-5 pb-5" onSubmit={(event) => { event.preventDefault(); void build(); }}>
        <div className="flex flex-col gap-2"><Label htmlFor="dissect-title">参考书名</Label><Input id="dissect-title" value={title} required maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：没钱修什么仙" /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="dissect-category">题材分类</Label><Input id="dissect-category" value={category} onChange={(event) => setCategory(event.target.value)} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="dissect-source">本书内的参考原文</Label><select id="dissect-source" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={source} onChange={(event) => setSource(event.target.value)}><option value="">粘贴原文</option>{library?.referenceFiles.map((file) => <option key={file.path} value={file.path}>{file.title}</option>)}</select>{!source && <Textarea aria-label="粘贴参考原文" rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴带「第 N 章」标题的原文…" />}</div>
        <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-sm font-medium">快捷选章</legend><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" aria-pressed={selection.preset === "first5"} onClick={() => setSelection({ preset: "first5" })}>前 5 章</Button><Button type="button" variant="outline" size="sm" aria-pressed={selection.preset === "first10"} onClick={() => setSelection({ preset: "first10" })}>前 10 章</Button><Button type="button" variant="outline" size="sm" onClick={() => setSelection(nextDissectSelection(selection))}>向后增选 10 章</Button></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">自定义区间</span><Input aria-label="起始章" className="w-20" type="number" min={1} value={selection.preset === "range" ? selection.from ?? 1 : 1} onChange={(event) => setSelection({ preset: "range", from: Number(event.target.value), to: selection.to ?? 10 })} /><span>—</span><Input aria-label="结束章" className="w-20" type="number" min={1} value={selection.preset === "first5" ? 5 : selection.preset === "first10" ? 10 : selection.to ?? 10} onChange={(event) => setSelection({ preset: "range", from: selection.from ?? 1, to: Number(event.target.value) })} /></div></fieldset>
        <div className="flex flex-col gap-2"><Label htmlFor="dissect-template">拆书预设模板</Label><select id="dissect-template" value={template} onChange={(event) => setTemplate(event.target.value as typeof template)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="full">黄金拆书全套</option><option value="chapter-outline">拆细纲章纲</option><option value="opening">黄金开篇点评</option><option value="rhythm-hooks">节奏与钩子评估</option></select></div>
        <ToggleGroup value={[mode]} onValueChange={(value) => { if (value[0]) setMode(value[0] as typeof mode); }} aria-label="拆书模式"><ToggleGroupItem value="per-chapter">分章拆</ToggleGroupItem><ToggleGroupItem value="merged">合并拆</ToggleGroupItem></ToggleGroup>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useModel} onChange={(event) => setUseModel(event.target.checked)} />对选中章节进行模型深度精炼</label>
        <p className="text-xs leading-relaxed text-muted-foreground">秒建库覆盖全书原文证据。选章与模板用于深度精炼；增量生成保留作者已编辑的报告。</p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !title.trim() || (!source && !text.trim())}>{busy && <Loader2 className="animate-spin" />}{busy ? "正在拆书…" : useModel ? "建库并精炼选中章节" : "建立完整扫描库"}</Button><Button type="button" variant="outline" disabled={busy || !title.trim() || (!source && !text.trim())} onClick={() => void build(true)}>全书秒建机械库</Button>
      </form>
    </SheetContent></Sheet>
  </section>;
}
