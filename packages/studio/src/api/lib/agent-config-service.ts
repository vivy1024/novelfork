/**
 * Agent 配置服务
 * 管理 Agent 运行时配置（工作区、容器、端口等资源限制）
 */

export interface AgentConfig {
  maxActiveWorkspaces: number;
  maxActiveContainers: number;
  workspaceSizeWarning: number; // MB
  autoSaveOnSleep: boolean;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface AgentResourceUsage {
  activeWorkspaces: number;
  activeContainers: number;
  totalWorkspaceSize: number; // MB
  availablePorts: number;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxActiveWorkspaces: 10,
  maxActiveContainers: 5,
  workspaceSizeWarning: 500, // 500MB
  autoSaveOnSleep: true,
  portRangeStart: 10000,
  portRangeEnd: 20000,
};

class AgentConfigService {
  private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG };
  private resourceUsage: AgentResourceUsage = {
    activeWorkspaces: 0,
    activeContainers: 0,
    totalWorkspaceSize: 0,
    availablePorts: 10000,
  };

  /**
   * 获取 Agent 配置
   */
  getAgentConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * 更新 Agent 配置
   */
  updateAgentConfig(updates: Partial<AgentConfig>): { success: boolean; config?: AgentConfig; error?: string } {
    // 验证配置合法性
    const validation = this.validateConfig({ ...this.config, ...updates });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    this.config = { ...this.config, ...updates };
    return { success: true, config: this.config };
  }

  /**
   * 验证配置合法性
   */
  private validateConfig(config: AgentConfig): { valid: boolean; error?: string } {
    // 验证工作区数量
    if (config.maxActiveWorkspaces < 1 || config.maxActiveWorkspaces > 100) {
      return { valid: false, error: "maxActiveWorkspaces must be between 1 and 100" };
    }

    // 验证容器数量
    if (config.maxActiveContainers < 1 || config.maxActiveContainers > 50) {
      return { valid: false, error: "maxActiveContainers must be between 1 and 50" };
    }

    // 验证工作区大小警告阈值
    if (config.workspaceSizeWarning < 10 || config.workspaceSizeWarning > 10000) {
      return { valid: false, error: "workspaceSizeWarning must be between 10 and 10000 MB" };
    }

    // 验证端口范围
    if (config.portRangeStart < 1024 || config.portRangeStart > 65535) {
      return { valid: false, error: "portRangeStart must be between 1024 and 65535" };
    }

    if (config.portRangeEnd < 1024 || config.portRangeEnd > 65535) {
      return { valid: false, error: "portRangeEnd must be between 1024 and 65535" };
    }

    if (config.portRangeStart >= config.portRangeEnd) {
      return { valid: false, error: "portRangeStart must be less than portRangeEnd" };
    }

    const portRange = config.portRangeEnd - config.portRangeStart;
    if (portRange < 100) {
      return { valid: false, error: "Port range must be at least 100 ports" };
    }

    return { valid: true };
  }

  /**
   * 获取资源使用情况
   */
  getResourceUsage(): AgentResourceUsage {
    return { ...this.resourceUsage };
  }

  /**
   * 更新资源使用情况
   */
  updateResourceUsage(updates: Partial<AgentResourceUsage>): void {
    this.resourceUsage = { ...this.resourceUsage, ...updates };
  }

  /**
   * 检查是否可以创建新工作区
   */
  canCreateWorkspace(): { allowed: boolean; reason?: string } {
    if (this.resourceUsage.activeWorkspaces >= this.config.maxActiveWorkspaces) {
      return {
        allowed: false,
        reason: `Maximum active workspaces reached (${this.config.maxActiveWorkspaces})`,
      };
    }

    return { allowed: true };
  }

  /**
   * 检查是否可以创建新容器
   */
  canCreateContainer(): { allowed: boolean; reason?: string } {
    if (this.resourceUsage.activeContainers >= this.config.maxActiveContainers) {
      return {
        allowed: false,
        reason: `Maximum active containers reached (${this.config.maxActiveContainers})`,
      };
    }

    return { allowed: true };
  }

  /**
   * 检查工作区大小是否超过警告阈值
   */
  checkWorkspaceSize(sizeInMB: number): { warning: boolean; message?: string } {
    if (sizeInMB >= this.config.workspaceSizeWarning) {
      return {
        warning: true,
        message: `Workspace size (${sizeInMB}MB) exceeds warning threshold (${this.config.workspaceSizeWarning}MB)`,
      };
    }

    return { warning: false };
  }

  /**
   * 分配端口
   */
  allocatePort(): { port: number | null; error?: string } {
    const availablePorts = this.config.portRangeEnd - this.config.portRangeStart;
    if (this.resourceUsage.availablePorts >= availablePorts) {
      return { port: null, error: "No available ports in range" };
    }

    // 简单的顺序分配（实际应该维护已使用端口列表）
    const port = this.config.portRangeStart + this.resourceUsage.availablePorts;
    this.resourceUsage.availablePorts++;

    return { port };
  }

  /**
   * 释放端口
   */
  releasePort(port: number): boolean {
    if (port < this.config.portRangeStart || port > this.config.portRangeEnd) {
      return false;
    }

    if (this.resourceUsage.availablePorts > 0) {
      this.resourceUsage.availablePorts--;
    }

    return true;
  }

  /**
   * 重置配置为默认值
   */
  resetToDefaults(): AgentConfig {
    this.config = { ...DEFAULT_AGENT_CONFIG };
    return this.config;
  }

  /**
   * 获取配置统计信息
   */
  getConfigStats(): {
    workspaceUsagePercent: number;
    containerUsagePercent: number;
    portUsagePercent: number;
  } {
    const workspaceUsagePercent = (this.resourceUsage.activeWorkspaces / this.config.maxActiveWorkspaces) * 100;
    const containerUsagePercent = (this.resourceUsage.activeContainers / this.config.maxActiveContainers) * 100;
    const totalPorts = this.config.portRangeEnd - this.config.portRangeStart;
    const portUsagePercent = (this.resourceUsage.availablePorts / totalPorts) * 100;

    return {
      workspaceUsagePercent: Math.round(workspaceUsagePercent),
      containerUsagePercent: Math.round(containerUsagePercent),
      portUsagePercent: Math.round(portUsagePercent),
    };
  }
}

// 全局 Agent 配置服务实例
export const agentConfigService = new AgentConfigService();
