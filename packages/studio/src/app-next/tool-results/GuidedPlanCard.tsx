import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getString, getStringArray, getToolResultData, type ToolResultRendererContext } from "./types";

export function GuidedPlanCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const title = getString(data?.title, "引导式计划");
  const steps = getStringArray(data?.steps);

  return (
    <section data-testid="tool-result-guided">
      <h4>{title}</h4>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
