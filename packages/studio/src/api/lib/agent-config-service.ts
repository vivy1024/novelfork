/**
 * Agent 配置服务
 * 管理 Agent 运行时配置（工作区、容器、端口等资源限制）
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { resolveRuntimeStoragePath } from "./runtime-storage-paths.js";

export interface AgentConfig {
  maxActiveWorkspaces: number;
  maxActiveContainers: number;
  workspaceSizeWarning: number; // MB
  autoSaveOnSleep: boolean;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface AgentResourceUsage {
  activeWorkspaces: number | null;
  activeContainers: number | null;
  totalWorkspaceSize: number | null; // MB
  availablePorts: number;
  source: "unknown" | "runtime";
}

interface AgentConfigState {
  version: 1;
  config: AgentConfig;
  reservedPorts: number[];
  updatedAt: string;
}

export interface AgentConfigServiceOptions {
  readonly storagePath?: string;
  readonly portHost?: string;
}

export interface PortAllocationResult {
  readonly port: number | null;
  readonly allocation?: "verified-free";
  readonly error?: string;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxActiveWorkspaces: 10,
  maxActiveContainers: 5,
  workspaceSizeWarning: 500, // 500MB
  autoSaveOnSleep: true,
  portRangeStart: 10000,
  portRangeEnd: 20000,
};

const DEFAULT_RESOURCE_USAGE: AgentResourceUsage = {
  activeWorkspaces: null,
  activeContainers: null,
  totalWorkspaceSize: null,
  availablePorts: DEFAULT_AGENT_CONFIG.portRangeEnd - DEFAULT_AGENT_CONFIG.portRangeStart + 1,
  source: "unknown",
};

export class AgentConfigService {
  private readonly storagePath: string;
  private readonly portHost: string;
  private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG };
  private resourceUsage: AgentResourceUsage = { ...DEFAULT_RESOURCE_USAGE };
  private readonly reservedPorts = new Set<number>();

  constructor(options: AgentConfigServiceOptions = {}) {
    this.storagePath = options.storagePath ?? resolveRuntimeStoragePath("agent-config.json");
    this.portHost = options.portHost ?? "127.0.0.1";
    this.loadState();
    this.refreshAvailablePortCount();
  }

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
    const nextConfig = { ...this.config, ...updates };
    const validation = this.validateConfig(nextConfig);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    this.config = nextConfig;
    for (const port of Array.from(this.reservedPorts)) {
      if (!this.isPortInRange(port)) {
        this.reservedPorts.delete(port);
      }
    }
    this.refreshAvailablePortCount();
    this.saveState();
    return { success: true, config: this.getAgentConfig() };
  }

  /**
   * 验证配置合法性
   */
  private validateConfig(config: AgentConfig): { valid: boolean; error?: string } {
    if (config.maxActiveWorkspaces < 1 || config.maxActiveWorkspaces > 100) {
      return { valid: false, error: "maxActiveWorkspaces must be between 1 and 100" };
    }

    if (config.maxActiveContainers < 1 || config.maxActiveContainers > 50) {
      return { valid: false, error: "maxActiveContainers must be between 1 and 50" };
    }

    if (config.workspaceSizeWarning < 10 || config.workspaceSizeWarning > 10000) {
      return { valid: false, error: "workspaceSizeWarning must be between 10 and 10000 MB" };
    }

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
    this.refreshAvailablePortCount();
    return { ...this.resourceUsage };
  }

  /**
   * 更新资源使用情况，仅供接入真实 runtime 事实源后写入。
   */
  updateResourceUsage(updates: Partial<Omit<AgentResourceUsage, "source">>): void {
    this.resourceUsage = { ...this.resourceUsage, ...updates, source: "runtime" };
    this.refreshAvailablePortCount();
  }

  /**
   * 检查是否可以创建新工作区
   */
  canCreateWorkspace(): { allowed: boolean; reason?: string } {
    if (this.resourceUsage.activeWorkspaces === null) {
      return { allowed: false, reason: "Active workspace usage is unknown because no runtime source is attached" };
    }

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
    if (this.resourceUsage.activeContainers === null) {
      return { allowed: false, reason: "Active container usage is unknown because no runtime source is attached" };
    }

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
   * 分配端口。每个候选端口都会通过本机 listen 探测，避免仅靠内存计数假定可用。
   */
  async allocatePort(): Promise<PortAllocationResult> {
    for (let port = this.config.portRangeStart; port <= this.config.portRangeEnd; port += 1) {
      if (this.reservedPorts.has(port)) continue;
      if (!(await this.isPortAvailable(port))) continue;

      this.reservedPorts.add(port);
      this.refreshAvailablePortCount();
      this.saveState();
      return { port, allocation: "verified-free" };
    }

    return { port: null, error: "No verified free ports in range" };
  }

  /**
   * 释放端口
   */
  releasePort(port: number): boolean {
    if (!this.isPortInRange(port)) {
      return false;
    }

    this.reservedPorts.delete(port);
    this.refreshAvailablePortCount();
    this.saveState();
    return true;
  }

  /**
   * 重置配置为默认值
   */
  resetToDefaults(): AgentConfig {
    this.config = { ...DEFAULT_AGENT_CONFIG };
    this.reservedPorts.clear();
    this.resourceUsage = { ...DEFAULT_RESOURCE_USAGE };
    this.saveState();
    return this.getAgentConfig();
  }

  /**
   * 获取配置统计信息
   */
  getConfigStats(): {
    workspaceUsagePercent: number | null;
    containerUsagePercent: number | null;
    portUsagePercent: number;
  } {
    this.refreshAvailablePortCount();
    const workspaceUsagePercent = this.resourceUsage.activeWorkspaces === null
      ? null
      : (this.resourceUsage.activeWorkspaces / this.config.maxActiveWorkspaces) * 100;
    const containerUsagePercent = this.resourceUsage.activeContainers === null
      ? null
      : (this.resourceUsage.activeContainers / this.config.maxActiveContainers) * 100;
    const totalPorts = this.config.portRangeEnd - this.config.portRangeStart + 1;
    const usedPorts = totalPorts - this.resourceUsage.availablePorts;
    const portUsagePercent = (usedPorts / totalPorts) * 100;

    return {
      workspaceUsagePercent: workspaceUsagePercent === null ? null : Math.round(workspaceUsagePercent),
      containerUsagePercent: containerUsagePercent === null ? null : Math.round(containerUsagePercent),
      portUsagePercent: Math.round(portUsagePercent),
    };
  }

  private loadState(): void {
    if (!existsSync(this.storagePath)) return;

    const parsed = JSON.parse(readFileSync(this.storagePath, "utf8")) as Partial<AgentConfigState>;
    const config = { ...DEFAULT_AGENT_CONFIG, ...(parsed.config ?? {}) };
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid persisted agent config: ${validation.error}`);
    }

    this.config = config;
    this.reservedPorts.clear();
    for (const port of parsed.reservedPorts ?? []) {
      if (Number.isInteger(port) && this.isPortInRange(port)) {
        this.reservedPorts.add(port);
      }
    }
  }

  private saveState(): void {
    const state: AgentConfigState = {
      version: 1,
      config: this.config,
      reservedPorts: Array.from(this.reservedPorts).sort((a, b) => a - b),
      updatedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.storagePath);
  }

  private isPortInRange(port: number): boolean {
    return port >= this.config.portRangeStart && port <= this.config.portRangeEnd;
  }

  private refreshAvailablePortCount(): void {
    const totalPorts = this.config.portRangeEnd - this.config.portRangeStart + 1;
    this.resourceUsage = {
      ...this.resourceUsage,
      availablePorts: Math.max(0, totalPorts - this.reservedPorts.size),
    };
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, this.portHost, () => {
        server.close(() => resolve(true));
      });
    });
  }
}

// 全局 Agent 配置服务实例
export const agentConfigService = new AgentConfigService();
