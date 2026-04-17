import { useState } from "react";
import { GitMerge } from "lucide-react";
import { GitForkDialog } from "./GitForkDialog";

interface GitForkButtonProps {
  repoPath: string;
}

export function GitForkButton({ repoPath }: GitForkButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        title="Git Fork/合并"
      >
        <GitMerge className="w-5 h-5" />
      </button>
      {isOpen && <GitForkDialog repoPath={repoPath} onClose={() => setIsOpen(false)} />}
    </>
  );
}
