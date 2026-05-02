import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) return [path];
    return [];
  }));
  return nested.flat();
}

describe("Studio Next UI completion audit", () => {
  it("does not expose unimplemented feature copy in user-facing app-next source", async () => {
    const root = join(process.cwd(), "src", "app-next");
    const files = await collectSourceFiles(root);
    const offenders: string[] = [];
    const forbiddenPatterns = [
      /后续接入|暂未接入|即将推出|未接入|UnsupportedCapability/,
      /OpenAI-compatible|Anthropic-compatible/,
      /runtimeControls\.toolAccess/,
      />\{agent\.status\}<|>\{run\.status\}</,
    ];

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const relative = file.replace(root, "app-next");
      if (relative.endsWith("lib\\display-labels.ts") || relative.endsWith("lib/display-labels.ts")) continue;
      if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps shared visible UI copy localized to Chinese", async () => {
    const root = join(process.cwd(), "src", "components");
    const files = await collectSourceFiles(root);
    const offenders: string[] = [];
    const forbiddenPatterns = [
      />\s*(?:Copied|Copy|Save|Cancel|Running|Stopped|Interrupted|Error|All|Chapters|Settings|Messages|Files)\s*</,
      /placeholder=["'](?:Edit message\.\.\.|Search tools\.\.\.|Search chapters, settings, messages\.\.\.)["']/,
      /title=["'](?:Save \(Ctrl\+Enter\)|Cancel \(Esc\)|Clear conversation|Close panel|Configure provider)["']/,
      /\b(?:No tools found matching|No results found for|Start typing to search|Enable or disable optional tools|Core tools|are always available)\b/,
      /\b(?:New Command|Add Command|Delete Command|Define custom commands|No custom commands defined|What does this command do\?|Instructions for the AI\.\.\.)\b/,
      /\b(?:Global Prompts|System Prompts|Add Prompt|Delete Prompt|Prompts injected into all conversations|System-level prompts that define AI behavior|Prompt content\.\.\.|No (?:global|system) prompts defined)\b/,
      /\b(?:Global Skills|Project Skills|Add Skill|Delete Skill|Skills available across all projects|Skills specific to this project|What does this skill do\?|Step-by-step instructions for this skill\.\.\.|No (?:global|project) skills defined)\b/,
      /\b(?:New Agent|Add Sub-agent|Delete Sub-agent|Define custom sub-agents|General Purpose|Specialized|System Prompt|System prompt for this agent\.\.\.|No custom sub-agents defined)\b/,
      /\b(?:Search MCP tools\.\.\.|Manage MCP \(Model Context Protocol\)|No MCP tools found matching|No MCP tools configured|Approve|Deny)\b/,
      /\b(?:Ask about your novel|Press Enter to send|Shift\+Enter for new line|How shall we proceed today\?|Type a command below|Unknown error|Acknowledged|Initializing\.\.\.)\b/,
      /description: "(?:Execute shell commands|Read file contents|Write files|Edit existing files|Search file contents|Find files by pattern|Enter git worktree|Exit git worktree|Write todo lists|Fetch web content|Search the web|Interact with persistent terminals|Search previous NarraFork conversations|Control a browser for multi-step interactions|Generate temporary download links|Fork an independent narrator workstream|Manage NarraFork server settings|Create agent teams|Delete agent teams|Monitor processes|Send messages|Push notifications)"/,
    ];

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const relative = file.replace(root, "components");
      if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });
});
