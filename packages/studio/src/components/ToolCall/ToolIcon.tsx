import { Terminal, FileText, Edit, Search, Code } from "lucide-react";

interface ToolIconProps {
  name: string;
  size?: number;
  color?: string;
}

export function ToolIcon({ name, size = 16, color }: ToolIconProps) {
  const iconProps = { size, color };

  switch (name.toLowerCase()) {
    case "bash":
      return <Terminal {...iconProps} />;
    case "read":
      return <FileText {...iconProps} />;
    case "write":
    case "edit":
      return <Edit {...iconProps} />;
    case "grep":
      return <Search {...iconProps} />;
    default:
      return <Code {...iconProps} />;
  }
}
