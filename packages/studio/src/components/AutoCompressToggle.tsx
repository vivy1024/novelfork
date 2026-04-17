/**
 * AutoCompressToggle — Toggle for automatic context compression
 */

import { useState, useEffect } from "react";
import { Switch } from "./ui/switch";

interface AutoCompressToggleProps {
  readonly bookId: string;
  readonly onCompress: () => void;
}

export function AutoCompressToggle({ bookId, onCompress }: AutoCompressToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [lastCheck, setLastCheck] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const checkAndCompress = async () => {
      try {
        const response = await fetch(`/api/context/${bookId}/usage`);
        const data = await response.json();

        if (data.percentage > 80) {
          onCompress();
          setLastCheck(Date.now());
        }
      } catch (e) {
        console.error("Auto-compress check failed:", e);
      }
    };

    // Check every 30 seconds
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastCheck > 30000) {
        checkAndCompress();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [enabled, bookId, onCompress, lastCheck]);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-border/30">
      <Switch checked={enabled} onCheckedChange={setEnabled} />
      <span className="text-xs text-muted-foreground">
        自动压缩（超过 80%）
      </span>
    </div>
  );
}
