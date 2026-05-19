import { cpus, totalmem, freemem, platform } from "node:os";
import { statfs } from "node:fs";
import { promisify } from "node:util";
import { execSync } from "node:child_process";

const statfsAsync = promisify(statfs);

const startedAt = Date.now();

export interface SystemMetrics {
  cpu: {
    usage: number; // 0-100
    cores: number;
  };
  memory: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercent: number; // 0-100
  };
  disk: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercent: number; // 0-100
  };
  timestamp: number;
  // Server info fields
  bunVersion?: string;
  nodeVersion?: string;
  port?: number;
  host?: string;
  platform?: string;
  uptime?: number;
  gitVersion?: string;
  rgVersion?: string;
  dbPath?: string;
  packageManager?: string;
}

let lastCpuUsage: { idle: number; total: number } | null = null;

function getCpuUsage(): number {
  const cpuInfo = cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpuInfo) {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  }

  if (!lastCpuUsage) {
    lastCpuUsage = { idle, total };
    return 0;
  }

  const idleDiff = idle - lastCpuUsage.idle;
  const totalDiff = total - lastCpuUsage.total;
  lastCpuUsage = { idle, total };

  return totalDiff === 0 ? 0 : Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

async function getDiskUsage(path: string): Promise<{ total: number; used: number; free: number; usagePercent: number }> {
  try {
    const stats = await statfsAsync(path);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    const usagePercent = total === 0 ? 0 : Math.round((used / total) * 100);
    return { total, used, free, usagePercent };
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 };
  }
}

export async function collectMetrics(projectRoot: string): Promise<SystemMetrics> {
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = totalMem === 0 ? 0 : Math.round((usedMem / totalMem) * 100);

  const disk = await getDiskUsage(projectRoot);

  // Server info
  const bunVersion = (process.versions as Record<string, string | undefined>).bun ?? undefined;
  const nodeVersion = process.version;
  const port = Number(process.env.PORT) || 1422;
  const host = process.env.HOST || "127.0.0.1";

  let gitVersion: string | undefined;
  try { gitVersion = execSync("git --version", { encoding: "utf-8", timeout: 3000 }).trim().replace("git version ", ""); } catch { /* */ }

  let rgVersion: string | undefined;
  try { rgVersion = execSync("rg --version", { encoding: "utf-8", timeout: 3000 }).split("\n")[0]?.trim(); } catch { /* */ }

  let packageManager: string | undefined;
  try {
    execSync("winget --version", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
    packageManager = "winget";
  } catch {
    try {
      execSync("scoop --version", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      packageManager = "scoop";
    } catch {
      try {
        execSync("choco --version", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
        packageManager = "choco";
      } catch {
        packageManager = undefined;
      }
    }
  }

  const uptime = Math.floor((Date.now() - startedAt) / 1000);

  return {
    cpu: {
      usage: getCpuUsage(),
      cores: cpus().length,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: memUsagePercent,
    },
    disk,
    timestamp: Date.now(),
    bunVersion,
    nodeVersion,
    port,
    host,
    platform: platform(),
    uptime,
    gitVersion,
    rgVersion,
    packageManager,
  };
}
