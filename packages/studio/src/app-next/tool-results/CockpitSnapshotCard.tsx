import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { asRecord, getString, getToolResultData, type ToolResultRendererContext } from "./types";

export function CockpitSnapshotCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const title = getString(data?.bookTitle, "驾驶舱快照");
  const focus = getString(data?.currentFocus, "未设置焦点");
  const risk = getString(data?.risk, "未知风险");

  return (
    <section data-testid="tool-result-cockpit">
      <h4>{title}</h4>
      <p>当前焦点：{focus}</p>
      <p>风险：{risk}</p>
      <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} />
    </section>
  );
}
