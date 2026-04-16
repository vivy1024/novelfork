import { cpus, totalmem, freemem } from "node:os";
import { statfs } from "node:fs";
import { promisify } from "node:util";

const statfsAsync = promisify(statfs);

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
  };
}
