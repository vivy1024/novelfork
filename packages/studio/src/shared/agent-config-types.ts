export interface AgentConfig {
  maxActiveWorkspaces: number;
  maxActiveContainers: number;
  workspaceSizeWarning: number;
  autoSaveOnSleep: boolean;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface AgentResourceUsage {
  activeWorkspaces: number;
  activeContainers: number;
  totalWorkspaceSize: number;
  availablePorts: number;
}
