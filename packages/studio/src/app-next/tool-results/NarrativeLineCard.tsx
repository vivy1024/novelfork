import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getString, getStringArray, getToolResultData, type ToolResultRendererContext } from "./types";

export function NarrativeLineCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const title = getString(data?.title, "叙事线快照");
  const arcs = getStringArray(data?.arcs);

  return (
    <section data-testid="tool-result-narrative">
      <h4>{title}</h4>
      <ul>{arcs.map((arc) => <li key={arc}>{arc}</li>)}</ul>
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
