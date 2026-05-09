import { useState } from "react";
import { GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";

import { GitLogDialog } from "./GitLogDialog";

interface GitLogButtonProps {
  repoPath: string;
}

export function GitLogButton({ repoPath }: GitLogButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        title="Git 日志"
      >
        <GitBranch className="w-5 h-5" />
      </Button>
      {isOpen && <GitLogDialog repoPath={repoPath} onClose={() => setIsOpen(false)} />}
    </>
  );
}
