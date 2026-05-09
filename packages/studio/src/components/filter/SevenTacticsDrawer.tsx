import { useState } from "react";
import { Button } from "@/components/ui/button";

import type { SevenTacticView } from "./types";

export function SevenTacticsDrawer({ suggestions }: { suggestions: SevenTacticView[] }) {
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  return (
    <aside className="space-y-3 rounded-2xl border border-border/50 bg-card/70 p-4">
      <h3 className="font-semibold">消 AI 味 7 招</h3>
      {suggestions.map((suggestion) => (
        <div key={suggestion.tacticId} className="rounded-xl border border-border/40 p-3">
          <div className="font-bold">{suggestion.name}</div>
          <Button size="xs" onClick={() => setActiveTemplate(suggestion.template)} className="mt-2">
            应用第 {suggestion.tacticId} 招
          </Button>
        </div>
      ))}
      {activeTemplate && <pre className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">{activeTemplate}</pre>}
    </aside>
  );
}
