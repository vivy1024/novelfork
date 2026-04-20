import type { ToolCall } from "../../stores/windowStore";
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
