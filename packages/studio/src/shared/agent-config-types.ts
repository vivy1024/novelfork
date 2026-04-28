export interface AgentConfig {
  maxActiveWorkspaces: number;
  maxActiveContainers: number;
  workspaceSizeWarning: number;
  autoSaveOnSleep: boolean;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface AgentResourceUsage {
  activeWorkspaces: number | null;
  activeContainers: number | null;
  totalWorkspaceSize: number | null;
  availablePorts: number;
  source: "unknown" | "runtime";
}
