import { getToolResultArtifact, type ToolResultRendererContext } from "./types";

export function ArtifactOpenButton({ result, onOpenArtifact }: Pick<ToolResultRendererContext, "result" | "onOpenArtifact">) {
  const artifact = getToolResultArtifact(result);
  if (!artifact || !onOpenArtifact) return null;

  return (
    <button type="button" onClick={() => onOpenArtifact(artifact)}>
      在画布打开
    </button>
  );
}
