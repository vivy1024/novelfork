/** 子代理一览（只读）：内置的几位帮手各管什么、能用哪些工具。工具显示中文名，不显示内部 id。 */

import { Bot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { NOVEL_SUBAGENT_ROSTER } from "../../engine/agents/roster.js";
import { toolDisplayName } from "./workflow-step-list-model";

const SUBMITS = "workflow.submit_step_output";

export function WorkflowSubagentRoster() {
  return (
    <section className="space-y-2" aria-label="子代理一览" data-testid="workflow-subagent-roster">
      <p className="text-xs text-muted-foreground">
        工序可以委派给下面这些帮手。它们只读资料、把产物交给工作流，不会直接改正文或设定；需要你确认的工序仍会停下来等你。
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {NOVEL_SUBAGENT_ROSTER.map((template) => (
          <li key={template.id} className="space-y-1.5 rounded-lg border bg-card p-3" data-testid={`workflow-subagent-${template.id}`}>
            <div className="flex items-center gap-1.5">
              <Bot className="size-4 text-primary" aria-hidden />
              <span className="text-sm font-medium">{template.nameZh}</span>
              {template.tools.includes(SUBMITS) ? <Badge variant="outline">交产物</Badge> : <Badge variant="secondary">只给建议</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{template.description}</p>
            <div className="flex flex-wrap gap-1" aria-label={`${template.nameZh}可用的工具`}>
              {[...new Set(template.tools.map(toolDisplayName))].map((name) => (
                <span key={name} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{name}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
