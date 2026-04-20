import { Blocks, Bot, FileSearch, FileText, Globe, Pencil, Terminal } from "lucide-react";

import { getToolCallKind } from "./tool-call-utils";

interface ToolIconProps {
  name: string;
  size?: number;
  color?: string;
}

export function ToolIcon({ name, size = 16, color }: ToolIconProps) {
  const iconProps = { size, color };

  switch (getToolCallKind(name)) {
    case "bash":
      return <Terminal {...iconProps} />;
    case "read":
      return <FileText {...iconProps} />;
    case "write":
      return <Pencil {...iconProps} />;
    case "search":
      return <FileSearch {...iconProps} />;
    case "web":
      return <Globe {...iconProps} />;
    case "mcp":
      return <Blocks {...iconProps} />;
    case "agent":
      return <Bot {...iconProps} />;
    default:
      return <Blocks {...iconProps} />;
  }
}
