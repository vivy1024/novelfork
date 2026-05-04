import type { ReactNode } from "react";

export interface ToolResultRendererContext {
  toolName: string;
  result: unknown;
}

export type ToolResultRenderer = (context: ToolResultRendererContext) => ReactNode;

const renderers = new Map<string, ToolResultRenderer>();

export const RESERVED_TOOL_RESULT_RENDERERS = ["cockpit", "questionnaire", "pgi", "guided", "candidate", "narrative"] as const;

const TOOL_PREFIX_TO_RENDERER: Record<string, (typeof RESERVED_TOOL_RESULT_RENDERERS)[number]> = {
  cockpit: "cockpit",
  questionnaire: "questionnaire",
  pgi: "pgi",
  guided: "guided",
  candidate: "candidate",
  narrative: "narrative",
};

function rendererFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [prefix] = value.split(".");
  if (prefix && prefix in TOOL_PREFIX_TO_RENDERER) return TOOL_PREFIX_TO_RENDERER[prefix];
  return prefix || null;
}

export function resolveToolResultRendererKey(context: ToolResultRendererContext): string {
  if (context.result && typeof context.result === "object") {
    const renderer = rendererFromValue((context.result as Record<string, unknown>).renderer);
    if (renderer) return renderer;
  }

  return rendererFromValue(context.toolName) ?? "generic";
}

export function registerToolResultRenderer(key: string, renderer: ToolResultRenderer) {
  renderers.set(key, renderer);
}

export function getToolResultRenderer(key: string): ToolResultRenderer {
  return renderers.get(key) ?? GenericToolResultRenderer;
}

export function renderToolResult(context: ToolResultRendererContext): ReactNode {
  const key = resolveToolResultRendererKey(context);
  const renderer = getToolResultRenderer(key);
  return renderer(context);
}

export function GenericToolResultRenderer({ toolName, result }: ToolResultRendererContext) {
  return (
    <section data-testid="tool-result-generic">
      <h4>{toolName}</h4>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </section>
  );
}
