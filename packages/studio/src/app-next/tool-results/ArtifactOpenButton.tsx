import { Button } from "@/components/ui/button";
import { getToolResultArtifact, type ToolResultRendererContext } from "./types";

export function ArtifactOpenButton({ result, onOpenArtifact }: Pick<ToolResultRendererContext, "result" | "onOpenArtifact">) {
  const artifact = getToolResultArtifact(result);
  if (!artifact || !onOpenArtifact) return null;

  return (
    <Button variant="ghost" size="sm" onClick={() => onOpenArtifact(artifact)}>
      在画布打开
    </Button>
  );
}
