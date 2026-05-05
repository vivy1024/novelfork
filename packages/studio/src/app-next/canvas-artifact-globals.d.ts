import type { CanvasArtifact } from "@/shared/agent-native-workspace";

declare global {
  interface Window {
    __NOVELFORK_OPEN_CANVAS_ARTIFACT__?: (artifact: CanvasArtifact) => void;
  }
}

export {};
