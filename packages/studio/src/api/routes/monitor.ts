/**
 * Monitor routes — WebSocket for real-time daemon logs and status.
 */

import { Hono } from "hono";
import type { RouterContext } from "./context.js";
import { WebSocketServer } from "ws";
import type { Server } from "http";
import { buildUnsupportedCapabilityResponse } from "../../lib/runtime-capabilities.js";

export function createMonitorRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  // HTTP endpoint for initial status
  app.get("/api/monitor/status", async (c) => {
    return c.json(
      buildUnsupportedCapabilityResponse("monitor.status", {
        status: "planned",
        reason: "当前没有已接入的 daemon/runtime 状态事实源，不能固定返回 stopped。",
      }),
      501,
    );
  });

  return app;
}

/**
 * Setup WebSocket server for monitor logs
 */
export function setupMonitorWebSocket(server: Server, ctx: RouterContext) {
  const wss = new WebSocketServer({ server, path: "/api/monitor/logs" });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
      type: "unsupported",
      ...buildUnsupportedCapabilityResponse("monitor.websocket.events", {
        status: "planned",
        reason: "Monitor WebSocket 尚未接入真实 daemon/runtime 事件订阅，不能伪造实时状态或日志。",
      }),
    }));
    ws.close(1013, "Monitor events unsupported");
  });

  return wss;
}
