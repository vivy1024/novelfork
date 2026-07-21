import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";

export type WorkspaceSource = "none" | "new" | "existing";
export type WorkspaceCreateInput = { title: string; projectInit: { source: WorkspaceSource; workspaceRoot?: string; managedByNovelFork: boolean } };

export function WorkspaceCreateWizard({ open, onOpenChange, onSubmit, submitting = false }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onSubmit: (input: WorkspaceCreateInput) => Promise<void>; readonly submitting?: boolean }) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<WorkspaceSource>("none");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((source === "existing" || source === "new") && !workspaceRoot.trim()) {
      setError(source === "new" ? "请选择新建 workspace 目录" : "请选择已有 workspace 目录");
      return;
    }
    setError(null);
    const root = workspaceRoot.trim();
    // 用户选定的绝对路径即为 book_root；外部目录不可被默认当成受控托管目录。
    await onSubmit({
      title: title.trim() || "未命名作品",
      projectInit: {
        source,
        managedByNovelFork: source === "none" ? true : false,
        ...(root ? { workspaceRoot: root } : {}),
      },
    });
  };
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>新建作品</DialogTitle><DialogDescription>选择 workspace 目录后，作品文件会直接落在该目录（book_root = 所选路径）。「已有 workspace」不会复制或移动文件。</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <div className="space-y-2"><span className="text-sm font-medium">Workspace</span><div className="flex gap-2">{(["none", "new", "existing"] as const).map((item) => <button key={item} type="button" className={`rounded-md px-3 py-1.5 text-xs ${source === item ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setSource(item)}>{item === "none" ? "受控目录" : item === "new" ? "新建 workspace" : "已有 workspace"}</button>)}</div>{source !== "none" ? <div className="flex gap-2"><Input value={workspaceRoot} readOnly={source === "existing"} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="选择 workspace 目录（即 book_root）" /><Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>选择目录</Button></div> : <p className="text-xs text-muted-foreground">不选外部目录时，作品写入 ~/.novelfork/books/&lt;bookId&gt;</p>}</div>
        <label className="block space-y-1"><span className="text-sm font-medium">作品名称</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空则使用未命名作品" /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={submitting}>{submitting ? "创建中…" : "开始创作"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <DirectoryPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(path) => { setWorkspaceRoot(path); setPickerOpen(false); }} initialPath={workspaceRoot || undefined} />
  </>;
}
