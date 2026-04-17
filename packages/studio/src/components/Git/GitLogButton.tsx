import { useState } from "react";
import { GitBranch } from "lucide-react";
import { GitLogDialog } from "./GitLogDialog";

interface GitLogButtonProps {
  repoPath: string;
}

export function GitLogButton({ repoPath }: GitLogButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        title="Git 日志"
      >
        <GitBranch className="w-5 h-5" />
      </button>
      {isOpen && <GitLogDialog repoPath={repoPath} onClose={() => setIsOpen(false)} />}
    </>
  );
}
