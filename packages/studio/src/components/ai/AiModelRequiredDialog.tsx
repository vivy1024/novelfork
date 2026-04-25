import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AiModelRequiredDialogProps {
  open: boolean;
  message: string;
  onCancel: () => void;
  onConfigureModel: () => void;
}

export function AiModelRequiredDialog({ open, message, onCancel, onConfigureModel }: AiModelRequiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onCancel();
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-4 text-amber-500" />
            此功能需要配置 AI 模型
          </DialogTitle>
          <DialogDescription>
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" onClick={onConfigureModel}>
            配置模型
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
