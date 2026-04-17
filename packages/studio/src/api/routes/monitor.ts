/**
 * Monitor routes — WebSocket for real-time daemon logs and status.
 */

import { Hono } from "hono";
import type { RouterContext } from "./context.js";
import { WebSocketServer } from "ws";
import type { Server } from "http";

export function createMonitorRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  // HTTP endpoint for initial status
  app.get("/api/monitor/status", async (c) => {
    // TODO: 从 daemon 获取实际状态
    return c.json({
      status: "stopped",
      currentTask: undefined,
      progress: undefined,
      error: undefined,
    });
  });

  return app;
}

/**
 * Setup WebSocket server for monitor logs
 */
export function setupMonitorWebSocket(server: Server, ctx: RouterContext) {
  const wss = new WebSocketServer({ server, path: "/api/monitor/logs" });

  wss.on("connection", (ws) => {
    console.log("Monitor WebSocket client connected");

    // 发送初始状态
    ws.send(JSON.stringify({
      type: "status",
      status: "stopped",
    }));

    // 监听 daemon 事件并转发
    const handlers = {
      "daemon:started": () => {
        ws.send(JSON.stringify({
          type: "status",
          status: "running",
        }));
        ws.send(JSON.stringify({
          type: "log",
          message: `[${new Date().toISOString()}] Daemon started`,
        }));
      },
      "daemon:stopped": () => {
        ws.send(JSON.stringify({
          type: "status",
          status: "stopped",
        }));
        ws.send(JSON.stringify({
          type: "log",
          message: `[${new Date().toISOString()}] Daemon stopped`,
        }));
      },
      "daemon:chapter": (data: any) => {
        ws.send(JSON.stringify({
          type: "log",
          message: `[${new Date().toISOString()}] Chapter ${data.chapter} completed for book ${data.bookId}`,
        }));
      },
      "daemon:error": (data: any) => {
        ws.send(JSON.stringify({
          type: "status",
          status: "error",
          error: data.error,
        }));
        ws.send(JSON.stringify({
          type: "log",
          message: `[${new Date().toISOString()}] ERROR: ${data.error}`,
        }));
      },
    };

    // TODO: 注册事件监听器（需要 ctx 支持事件订阅）
    // 当前使用 ctx.broadcast，需要添加反向订阅机制

    ws.on("close", () => {
      console.log("Monitor WebSocket client disconnected");
      // TODO: 取消事件监听器
    });

    ws.on("error", (err) => {
      console.error("Monitor WebSocket error:", err);
    });
  });

  return wss;
}
