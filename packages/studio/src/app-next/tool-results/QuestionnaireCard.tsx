import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getString, getStringArray, getToolResultData, type ToolResultRendererContext } from "./types";

export function QuestionnaireCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const title = getString(data?.title, "问卷");
  const questions = getStringArray(data?.questions);

  return (
    <section data-testid="tool-result-questionnaire">
      <h4>{title}</h4>
      <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
