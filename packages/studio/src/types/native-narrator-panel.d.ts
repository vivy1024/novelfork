declare module "@frontend/components/narrator/NovelForkNarratorPanelHost" {
  import type { ReactNode } from "react";

  export interface RuntimeToolResultRendererInput {
    readonly toolName: string;
    readonly renderer: string;
    readonly result: unknown;
  }

  export interface NovelForkNarratorPanelHostProps {
    narratorId: string;
    compact?: boolean;
    highlightMessageId?: string;
    toolResultRenderer?: (input: RuntimeToolResultRendererInput) => ReactNode;
  }

  export function NovelForkNarratorPanelHost(
    props: NovelForkNarratorPanelHostProps,
  ): ReactNode;
}
