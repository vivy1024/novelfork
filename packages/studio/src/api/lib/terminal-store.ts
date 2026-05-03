/**
 * 终端进程内存追踪 — 为 Terminal 工具提供运行时状态管理。
 * 当前为纯内存 Map，进程重启后清空。后续可接入持久化。
 */

export interface TerminalInfo {
  id: string;
  name: string;
  status: "running" | "exited";
  cwd: string;
  createdAt: string;
  pid?: number;
}

export class TerminalStore {
  private readonly terminals = new Map<string, TerminalInfo>();

  /** 注册一个新终端 */
  register(info: TerminalInfo): void {
    this.terminals.set(info.id, { ...info });
  }

  /** 按 id 获取终端信息 */
  get(id: string): TerminalInfo | undefined {
    const entry = this.terminals.get(id);
    return entry ? { ...entry } : undefined;
  }

  /** 将终端标记为已退出 */
  markExited(id: string): boolean {
    const entry = this.terminals.get(id);
    if (!entry) return false;
    entry.status = "exited";
    return true;
  }

  /** 列出所有终端，按 running / exited 分组 */
  list(): { running: TerminalInfo[]; exited: TerminalInfo[] } {
    const running: TerminalInfo[] = [];
    const exited: TerminalInfo[] = [];
    for (const entry of this.terminals.values()) {
      const copy = { ...entry };
      if (copy.status === "running") {
        running.push(copy);
      } else {
        exited.push(copy);
      }
    }
    return { running, exited };
  }

  /** 删除一个已退出的终端记录。运行中的终端不允许直接删除。 */
  remove(id: string): { removed: boolean; reason?: string } {
    const entry = this.terminals.get(id);
    if (!entry) {
      return { removed: false, reason: "not_found" };
    }
    if (entry.status === "running") {
      return { removed: false, reason: "still_running" };
    }
    this.terminals.delete(id);
    return { removed: true };
  }

  /** 当前终端总数 */
  get size(): number {
    return this.terminals.size;
  }
}
