/**
 * 权限管理器
 * 处理工具调用的权限请求、批准/拒绝、规则匹配
 */

export interface PermissionRule {
  toolName: string;
  pattern?: string; // 参数匹配模式（正则表达式）
  action: "allow" | "deny" | "prompt";
  reason?: string;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "approved" | "denied";
  reason?: string;
}

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  // 允许读取操作
  { toolName: "Read", action: "allow" },
  { toolName: "Glob", action: "allow" },
  { toolName: "Grep", action: "allow" },

  // 写入和删除需要确认
  { toolName: "Write", action: "prompt" },
  { toolName: "Edit", action: "prompt" },

  // 危险的 Bash 命令需要确认
  {
    toolName: "Bash",
    pattern: "(rm|del|format|mkfs|dd|>)",
    action: "prompt",
    reason: "Potentially destructive command",
  },
];

export class PermissionManager {
  private rules: PermissionRule[] = [];
  private requests = new Map<string, PermissionRequest>();
  private callbacks = new Map<string, (approved: boolean, reason?: string) => void>();

  /**
   * 添加权限规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * 批量添加规则
   */
  addRules(rules: PermissionRule[]): void {
    this.rules.push(...rules);
  }

  /**
   * 清除所有规则
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * 获取所有规则
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * 匹配权限规则
   */
  getMatchingRule(toolName: string, params: Record<string, unknown>): PermissionRule | null {
    for (let index = this.rules.length - 1; index >= 0; index -= 1) {
      const rule = this.rules[index]!;
      if (rule.toolName !== toolName && rule.toolName !== "*") {
        continue;
      }

      // 如果没有模式，直接匹配工具名
      if (!rule.pattern) {
        return rule;
      }

      // 检查参数是否匹配模式
      const paramsStr = JSON.stringify(params);
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(paramsStr)) {
          return rule;
        }
      } catch {
        // 忽略无效的正则表达式
      }
    }

    return null;
  }

  /**
   * 检查权限
   * @returns "allow" | "deny" | "prompt"
   */
  checkPermission(toolName: string, params: Record<string, unknown>): "allow" | "deny" | "prompt" {
    const rule = this.getMatchingRule(toolName, params);
    if (rule) {
      return rule.action;
    }

    // 默认需要提示
    return "prompt";
  }

  /**
   * 请求权限
   * @returns Promise<boolean> - true 表示批准，false 表示拒绝
   */
  async requestPermission(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<{ approved: boolean; reason?: string }> {
    const action = this.checkPermission(toolName, params);

    if (action === "allow") {
      return { approved: true };
    }

    if (action === "deny") {
      const rule = this.getMatchingRule(toolName, params);
      return { approved: false, reason: rule?.reason || "Permission denied by rule" };
    }

    // 需要用户确认
    const requestId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: PermissionRequest = {
      id: requestId,
      toolName,
      params,
      timestamp: Date.now(),
      status: "pending",
    };

    this.requests.set(requestId, request);

    // 等待用户响应
    return new Promise((resolve) => {
      this.callbacks.set(requestId, (approved: boolean, reason?: string) => {
        request.status = approved ? "approved" : "denied";
        request.reason = reason;
        resolve({ approved, reason });
      });
    });
  }

  /**
   * 批准权限请求
   */
  approve(requestId: string, reason?: string): boolean {
    const callback = this.callbacks.get(requestId);
    if (!callback) {
      return false;
    }

    callback(true, reason);
    this.callbacks.delete(requestId);
    return true;
  }

  /**
   * 拒绝权限请求
   */
  deny(requestId: string, reason?: string): boolean {
    const callback = this.callbacks.get(requestId);
    if (!callback) {
      return false;
    }

    callback(false, reason);
    this.callbacks.delete(requestId);
    return true;
  }

  /**
   * 获取待处理的权限请求
   */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.requests.values()).filter((req) => req.status === "pending");
  }

  /**
   * 获取权限请求
   */
  getRequest(requestId: string): PermissionRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * 清理已完成的请求（超过 1 小时）
   */
  cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const [id, request] of this.requests.entries()) {
      if (request.status !== "pending" && now - request.timestamp > oneHour) {
        this.requests.delete(id);
        this.callbacks.delete(id);
      }
    }
  }
}

export function createDefaultPermissionManager(): PermissionManager {
  const manager = new PermissionManager();
  manager.addRules(DEFAULT_PERMISSION_RULES);
  return manager;
}

// 全局权限管理器实例
export const permissionManager = createDefaultPermissionManager();
