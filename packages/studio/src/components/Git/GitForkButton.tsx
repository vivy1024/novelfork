import { useState } from "react";
import { GitMerge } from "lucide-react";

import { Button } from "@/components/ui/button";

import { GitForkDialog } from "./GitForkDialog";

interface GitForkButtonProps {
  repoPath: string;
}

export function GitForkButton({ repoPath }: GitForkButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        title="Git Fork/合并"
      >
        <GitMerge className="w-5 h-5" />
      </Button>
      {isOpen && <GitForkDialog repoPath={repoPath} onClose={() => setIsOpen(false)} />}
    </>
  );
}
