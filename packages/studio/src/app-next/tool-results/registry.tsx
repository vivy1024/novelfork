import type { ReactNode } from "react";

export interface ToolResultRendererContext {
  toolName: string;
  result: unknown;
}

export type ToolResultRenderer = (context: ToolResultRendererContext) => ReactNode;

const renderers = new Map<string, ToolResultRenderer>();

export const RESERVED_TOOL_RESULT_RENDERERS = [
  "cockpit.snapshot",
  "questionnaire.session",
  "pgi.questions",
  "guided.session",
  "candidate.chapter",
  "narrative.line",
] as const;

export function registerToolResultRenderer(key: string, renderer: ToolResultRenderer) {
  renderers.set(key, renderer);
}

export function getToolResultRenderer(key: string): ToolResultRenderer {
  return renderers.get(key) ?? GenericToolResultRenderer;
}

export function GenericToolResultRenderer({ toolName, result }: ToolResultRendererContext) {
  return (
    <section data-testid="generic-tool-result-renderer">
      <h4>{toolName}</h4>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </section>
  );
}
