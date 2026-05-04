import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRendererContext } from "./types";

export function CandidateCreatedCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const title = getString(data?.title, "候选稿已创建");
  const wordCount = getNumber(data?.wordCount);

  return (
    <section data-testid="tool-result-candidate">
      <h4>{title}</h4>
      {wordCount !== null ? <p>{wordCount} 字</p> : null}
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
