import { Hono } from "hono";

import {
  createAggregation,
  deleteAggregation,
  listAggregations,
  updateAggregation,
} from "../lib/model-aggregation-service.js";
import type { ModelAggregation } from "../../types/settings.js";

export function createAggregationsRouter() {
  const app = new Hono();

  // GET /api/models/aggregations — 列出所有聚合
  app.get("/", async (c) => {
    try {
      const aggregations = await listAggregations();
      return c.json({ aggregations });
    } catch (error) {
      console.error("Failed to list aggregations:", error);
      return c.json({ error: "Failed to list aggregations" }, 500);
    }
  });

  // POST /api/models/aggregations — 创建聚合
  app.post("/", async (c) => {
    try {
      const body = await c.req.json<Partial<ModelAggregation>>();
      if (!body.displayName || !Array.isArray(body.members) || body.members.length === 0) {
        return c.json({ error: "Missing required fields: displayName, members (non-empty)" }, 400);
      }
      if (body.routingStrategy && body.routingStrategy !== "priority" && body.routingStrategy !== "round-robin" && body.routingStrategy !== "random") {
        return c.json({ error: "Invalid routingStrategy, must be priority | round-robin | random" }, 400);
      }
      const aggregation = await createAggregation({
        id: body.id,
        displayName: body.displayName,
        members: body.members,
        routingStrategy: body.routingStrategy ?? "priority",
      });
      return c.json({ aggregation }, 201);
    } catch (error) {
      if (error instanceof Error && /already exists/i.test(error.message)) {
        return c.json({ error: error.message }, 409);
      }
      console.error("Failed to create aggregation:", error);
      return c.json({ error: "Failed to create aggregation" }, 500);
    }
  });

  // PUT /api/models/aggregations/:id — 更新聚合
  app.put("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<Partial<Omit<ModelAggregation, "id">>>();
      const aggregation = await updateAggregation(id, body);
      return c.json({ aggregation });
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return c.json({ error: error.message }, 404);
      }
      console.error("Failed to update aggregation:", error);
      return c.json({ error: "Failed to update aggregation" }, 500);
    }
  });

  // DELETE /api/models/aggregations/:id — 删除聚合
  app.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      await deleteAggregation(id);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return c.json({ error: error.message }, 404);
      }
      console.error("Failed to delete aggregation:", error);
      return c.json({ error: "Failed to delete aggregation" }, 500);
    }
  });

  return app;
}
