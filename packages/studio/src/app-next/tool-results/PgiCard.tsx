import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getStringArray, getToolResultData, type ToolResultRendererContext } from "./types";

export function PgiCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const questions = getStringArray(data?.questions);
  const answers = getStringArray(data?.answers);

  return (
    <section data-testid="tool-result-pgi">
      <h4>生成前追问</h4>
      <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
      {answers.length ? <p>已回答：{answers.join("、")}</p> : null}
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
