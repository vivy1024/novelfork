import { ArtifactOpenButton } from "./ArtifactOpenButton";
import type { ToolResultRendererContext } from "./types";

export function GenericToolResultRenderer({ toolName, result, onOpenArtifact }: ToolResultRendererContext) {
  return (
    <section data-testid="tool-result-generic">
      <h4>{toolName}</h4>
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </section>
  );
}
