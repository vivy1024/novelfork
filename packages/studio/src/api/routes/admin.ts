/**
 * Admin 管理面板 API
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { Hono } from "hono";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as os from "node:os";
import { providerManager } from "../lib/provider-manager.js";

// --- 用户管理 ---

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
  lastLogin: Date;
}

// 内存存储（生产环境应使用数据库）
const users: User[] = [
  {
    id: "1",
    username: "admin",
    email: "admin@inkos.local",
    role: "admin",
    createdAt: new Date("2026-01-01"),
    lastLogin: new Date(),
  },
];

// --- 请求日志 ---

interface RequestLog {
  id: string;
  timestamp: Date;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
}

const requestLogs: RequestLog[] = [];
let logIdCounter = 1;

export function logRequest(log: Omit<RequestLog, "id">) {
  requestLogs.push({ id: String(logIdCounter++), ...log });
  // 保留最近 1000 条
  if (requestLogs.length > 1000) {
    requestLogs.shift();
  }
}

// --- 资源监控 ---

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  network: { sent: number; received: number };
}

let networkStats = { sent: 0, received: 0 };

function getResourceStats(): ResourceStats {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // CPU 使用率（简化计算）
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = 100 - (100 * totalIdle) / totalTick;

  return {
    cpu: { usage: Math.round(cpuUsage * 10) / 10, cores: cpus.length },
    memory: { used: totalMem - freeMem, total: totalMem },
    disk: { used: 0, total: 0 }, // 需要额外库支持
    network: networkStats,
  };
}

// --- Router ---

export function createAdminRouter() {
  const app = new Hono();

  // ===== 用户管理 =====

  app.get("/users", (c) => {
    return c.json({ users });
  });

  app.get("/users/:id", (c) => {
    const id = c.req.param("id");
    const user = users.find((u) => u.id === id);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }
    return c.json({ user });
  });

  app.post("/users", async (c) => {
    const body = await c.req.json<Omit<User, "id" | "createdAt" | "lastLogin">>();
    const newUser: User = {
      id: String(users.length + 1),
      ...body,
      createdAt: new Date(),
      lastLogin: new Date(),
    };
    users.push(newUser);
    return c.json({ user: newUser }, 201);
  });

  app.put("/users/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<Partial<User>>();
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      return c.json({ error: "User not found" }, 404);
    }
    users[index] = { ...users[index], ...updates };
    return c.json({ user: users[index] });
  });

  app.delete("/users/:id", (c) => {
    const id = c.req.param("id");
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      return c.json({ error: "User not found" }, 404);
    }
    users.splice(index, 1);
    return c.json({ success: true });
  });

  // ===== API 供应商管理（复用 providerManager）=====

  app.get("/providers", (c) => {
    const providers = providerManager.listProviders();
    return c.json({ providers });
  });

  // ===== 资源监控 =====

  app.get("/resources", (c) => {
    const stats = getResourceStats();
    return c.json({ stats });
  });

  // ===== 请求历史 =====

  app.get("/requests", (c) => {
    const limit = parseInt(c.req.query("limit") || "100");
    const logs = requestLogs.slice(-limit).reverse();
    return c.json({ logs, total: requestLogs.length });
  });

  return app;
}

// --- WebSocket 实时监控 ---

export function setupAdminWebSocket(server: ReturnType<typeof createServer>) {
  const wss = new WebSocketServer({ server, path: "/api/admin/resources/ws" });

  wss.on("connection", (ws) => {
    console.log("Admin WebSocket client connected");

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        const stats = getResourceStats();
        ws.send(JSON.stringify(stats));
      }
    }, 1000);

    ws.on("close", () => {
      clearInterval(interval);
      console.log("Admin WebSocket client disconnected");
    });
  });

  return wss;
}
