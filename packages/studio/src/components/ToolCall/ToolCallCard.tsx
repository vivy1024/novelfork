import type { ToolCall } from "../../shared/session-types";
import { ToolCallBlock } from "./ToolCallBlock";

interface ToolCallCardProps {
  toolCall: ToolCall;
  theme: {
    text: string;
    textSecondary: string;
    bg: string;
    bgSecondary: string;
    border: string;
    accent: string;
  };
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  return <ToolCallBlock toolCall={toolCall} />;
}
