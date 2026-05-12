import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DirectoryPickerDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (path: string) => void;
  readonly initialPath?: string;
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

interface Shortcut {
  name: string;
  path: string;
  icon: string;
}

function FolderIcon({ className }: { readonly className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

function ShortcutIcon({ icon, className }: { readonly icon: string; readonly className?: string }) {
  switch (icon) {
    case "home":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "monitor":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
        </svg>
      );
    case "file-text":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><line x1="10" x2="8" y1="9" y2="9" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" />
        </svg>
      );
    case "download":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      );
    case "hard-drive":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <line x1="22" x2="2" y1="12" y2="12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><line x1="6" x2="6.01" y1="16" y2="16" /><line x1="10" x2="10.01" y1="16" y2="16" />
        </svg>
      );
    default:
      return <FolderIcon className={className} />;
  }
}

export function DirectoryPickerDialog({ open, onClose, onSelect, initialPath }: DirectoryPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [addressInput, setAddressInput] = useState(initialPath || "");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelectedEntry(null);
    try {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      const res = await fetch(`/api/fs/browse?${params.toString()}`);
      const data = (await res.json()) as BrowseResult;
      if (!res.ok || data.error) {
        setError(data.error || "无法访问该目录");
        return;
      }
      setCurrentPath(data.path);
      setAddressInput(data.path);
      setParentPath(data.parent);
      setEntries(data.entries);
    } catch {
      setError("请求失败，请检查服务器连接");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadShortcuts = useCallback(async () => {
    try {
      const res = await fetch("/api/fs/shortcuts");
      if (res.ok) {
        const data = (await res.json()) as { shortcuts: Shortcut[] };
        setShortcuts(data.shortcuts);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      loadShortcuts();
      browse(initialPath || "");
    }
  }, [open, initialPath, browse, loadShortcuts]);

  useEffect(() => {
    if (newFolderMode && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [newFolderMode]);

  const handleNavigateUp = () => {
    if (parentPath !== null) {
      browse(parentPath);
    } else if (currentPath) {
      // Go to drive list
      browse("");
    }
  };

  const handleNavigateHome = () => {
    const homeShortcut = shortcuts.find((s) => s.icon === "home");
    if (homeShortcut) browse(homeShortcut.path);
  };

  const handleAddressKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      browse(addressInput);
    }
  };

  const handleEntryDoubleClick = (entry: DirEntry) => {
    browse(entry.path);
  };

  const handleEntryClick = (entry: DirEntry) => {
    setSelectedEntry(entry.path);
  };

  const handleSelect = () => {
    const target = selectedEntry || currentPath;
    if (target) {
      onSelect(target);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentPath) return;
    try {
      const newPath = currentPath + "\\" + newFolderName.trim();
      const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(newPath)}`);
      if (res.ok) {
        // Folder already exists or was created, navigate to parent to refresh
        setNewFolderMode(false);
        setNewFolderName("");
        browse(currentPath);
        return;
      }
      // If browse fails, the folder doesn't exist — we can't create it from the browse API
      // Just refresh the listing
      setNewFolderMode(false);
      setNewFolderName("");
      setError("无法创建文件夹（目录不存在）");
    } catch {
      setNewFolderMode(false);
      setNewFolderName("");
      setError("创建文件夹失败");
    }
  };

  const handleNewFolderKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleCreateFolder();
    if (e.key === "Escape") { setNewFolderMode(false); setNewFolderName(""); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>选择目录</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 pb-2 border-b">
          <Button type="button" variant="ghost" size="icon" className="size-8" title="主目录" onClick={handleNavigateHome}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" title="上级目录" onClick={handleNavigateUp} disabled={parentPath === null && !currentPath}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" title="刷新" onClick={() => browse(currentPath)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
            </svg>
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" title="新建文件夹" onClick={() => setNewFolderMode(true)} disabled={!currentPath}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <path d="M12 10v6" /><path d="M9 13h6" /><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
          </Button>
          <Input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder="输入路径后按 Enter 导航"
            className="flex-1 h-8 text-xs"
          />
        </div>

        {/* Main content area */}
        <div className="flex flex-1 min-h-0">
          {/* Shortcuts sidebar */}
          <div className="w-44 border-r overflow-y-auto py-2 shrink-0">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.path}
                type="button"
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors truncate"
                onClick={() => browse(shortcut.path)}
                title={shortcut.path}
              >
                <ShortcutIcon icon={shortcut.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{shortcut.name}</span>
              </button>
            ))}
          </div>

          {/* Directory listing */}
          <div className="flex-1 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground animate-pulse">加载中…</p>
              </div>
            )}
            {error && !loading && (
              <div className="flex items-center justify-center h-full px-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            {!loading && !error && entries.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">此目录为空</p>
              </div>
            )}
            {!loading && !error && (
              <div className="space-y-0">
                {newFolderMode && (
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <FolderIcon className="size-4 text-muted-foreground shrink-0" />
                    <Input
                      ref={newFolderInputRef}
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={handleNewFolderKeyDown}
                      onBlur={() => { setNewFolderMode(false); setNewFolderName(""); }}
                      placeholder="新文件夹名称"
                      className="h-6 text-xs flex-1"
                    />
                  </div>
                )}
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors truncate ${selectedEntry === entry.path ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    title={entry.path}
                  >
                    <FolderIcon className="size-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground truncate max-w-[60%]" title={selectedEntry || currentPath}>
            {selectedEntry || currentPath || "选择一个目录"}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>取消</Button>
            <Button type="button" size="sm" onClick={handleSelect} disabled={!currentPath && !selectedEntry}>选择此目录</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
