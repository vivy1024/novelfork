/**
 * AI 提供商管理 API
 * 提供商 CRUD、排序、启用/禁用、模型池、连通性测试
 */

import { Hono } from "hono";
import { providerManager } from "../lib/provider-manager.js";
import type { AIProvider } from "../lib/provider-manager.js";

export function createProvidersRouter() {
  const app = new Hono();

  /**
   * GET /api/providers
   * 列出所有提供商
   */
  app.get("/", async (c) => {
    try {
      const providers = providerManager.listProviders();
      return c.json({ providers });
    } catch (error) {
      console.error("Failed to list providers:", error);
      return c.json({ error: "Failed to list providers" }, 500);
    }
  });

  /**
   * GET /api/providers/status
   * 获取当前默认模型可用状态
   */
  app.get("/status", async (c) => {
    try {
      const status = providerManager.getRuntimeStatus();
      return c.json({ status });
    } catch (error) {
      console.error("Failed to get provider status:", error);
      return c.json({ error: "Failed to get provider status" }, 500);
    }
  });

  /**
   * POST /api/providers/:id/models/refresh
   * 刷新供应商模型列表，保存模型级刷新状态
   */
  app.post("/:id/models/refresh", async (c) => {
    try {
      const id = c.req.param("id");
      const body: { models?: AIProvider["models"] } = await c.req.json<{ models?: AIProvider["models"] }>().catch(() => ({}));
      const provider = providerManager.refreshProviderModels(id, Array.isArray(body.models) ? body.models : undefined);

      if (!provider) {
        return c.json({ error: "Provider not found" }, 404);
      }

      return c.json({ provider, models: provider.models });
    } catch (error) {
      console.error("Failed to refresh provider models:", error);
      return c.json({ error: "Failed to refresh provider models" }, 500);
    }
  });

  /**
   * PATCH /api/providers/:id/models/:modelId
   * 更新单模型开关与上下文长度等设置
   */
  app.patch("/:id/models/:modelId", async (c) => {
    try {
      const id = c.req.param("id");
      const modelId = c.req.param("modelId");
      const updates = await c.req.json<Partial<AIProvider["models"][number]>>();
      const model = providerManager.updateModel(id, modelId, updates);

      if (!model) {
        return c.json({ error: "Model not found" }, 404);
      }

      return c.json({ model });
    } catch (error) {
      console.error("Failed to update provider model:", error);
      return c.json({ error: "Failed to update provider model" }, 500);
    }
  });

  /**
   * POST /api/providers/:id/models/:modelId/test
   * 测试单个模型并写回模型级状态
   */
  app.post("/:id/models/:modelId/test", async (c) => {
    try {
      const id = c.req.param("id");
      const modelId = c.req.param("modelId");
      const result = await providerManager.testModelConnection(id, modelId);

      if (!result.success) {
        return c.json({ success: false, error: result.error, model: result.model }, 400);
      }

      return c.json({ success: true, latency: result.latency, model: result.model });
    } catch (error) {
      console.error("Failed to test provider model:", error);
      return c.json({ error: "Failed to test provider model" }, 500);
    }
  });

  /**
   * GET /api/providers/:id
   * 获取单个提供商
   */
  app.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const provider = providerManager.getProvider(id);

      if (!provider) {
        return c.json({ error: "Provider not found" }, 404);
      }

      return c.json({ provider });
    } catch (error) {
      console.error("Failed to get provider:", error);
      return c.json({ error: "Failed to get provider" }, 500);
    }
  });

  /**
   * PUT /api/providers/:id
   * 更新提供商配置
   */
  app.put("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const updates = await c.req.json<Partial<AIProvider>>();

      const updated = providerManager.updateProvider(id, updates);

      if (!updated) {
        return c.json({ error: "Provider not found" }, 404);
      }

      return c.json({ provider: updated });
    } catch (error) {
      console.error("Failed to update provider:", error);
      return c.json({ error: "Failed to update provider" }, 500);
    }
  });

  /**
   * POST /api/providers/:id/toggle
   * 启用/禁用提供商
   */
  app.post("/:id/toggle", async (c) => {
    try {
      const id = c.req.param("id");
      const { enabled } = await c.req.json<{ enabled: boolean }>();

      const success = providerManager.toggleProvider(id, enabled);

      if (!success) {
        return c.json({ error: "Provider not found" }, 404);
      }

      const provider = providerManager.getProvider(id);
      return c.json({ provider });
    } catch (error) {
      console.error("Failed to toggle provider:", error);
      return c.json({ error: "Failed to toggle provider" }, 500);
    }
  });

  /**
   * POST /api/providers/reorder
   * 拖拽排序提供商
   */
  app.post("/reorder", async (c) => {
    try {
      const { orderedIds } = await c.req.json<{ orderedIds: string[] }>();

      if (!Array.isArray(orderedIds)) {
        return c.json({ error: "orderedIds must be an array" }, 400);
      }

      const success = providerManager.reorderProviders(orderedIds);

      if (!success) {
        return c.json({ error: "Invalid provider IDs" }, 400);
      }

      const providers = providerManager.listProviders();
      return c.json({ providers });
    } catch (error) {
      console.error("Failed to reorder providers:", error);
      return c.json({ error: "Failed to reorder providers" }, 500);
    }
  });

  /**
   * GET /api/providers/models
   * 获取模型池（所有可用模型）
   */
  app.get("/models", async (c) => {
    try {
      const modelPool = providerManager.getModelPool();
      return c.json({ models: modelPool });
    } catch (error) {
      console.error("Failed to get model pool:", error);
      return c.json({ error: "Failed to get model pool" }, 500);
    }
  });

  /**
   * POST /api/providers/:id/test
   * 测试提供商连通性
   */
  app.post("/:id/test", async (c) => {
    try {
      const id = c.req.param("id");
      const result = await providerManager.testProviderConnection(id);

      if (!result.success) {
        return c.json({ success: false, error: result.error }, 400);
      }

      return c.json({ success: true, latency: result.latency });
    } catch (error) {
      console.error("Failed to test provider:", error);
      return c.json({ error: "Failed to test provider" }, 500);
    }
  });

  /**
   * POST /api/providers
   * 添加自定义提供商
   */
  app.post("/", async (c) => {
    try {
      const providerData = await c.req.json<Omit<AIProvider, "priority">>();

      // 验证必需字段
      if (!providerData.id || !providerData.name || !providerData.type) {
        return c.json({ error: "Missing required fields: id, name, type" }, 400);
      }

      const provider = providerManager.addProvider(providerData);
      return c.json({ provider }, 201);
    } catch (error) {
      console.error("Failed to add provider:", error);
      return c.json({ error: "Failed to add provider" }, 500);
    }
  });

  /**
   * DELETE /api/providers/:id
   * 删除提供商
   */
  app.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const success = providerManager.removeProvider(id);

      if (!success) {
        return c.json({ error: "Provider not found" }, 404);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to delete provider:", error);
      return c.json({ error: "Failed to delete provider" }, 500);
    }
  });

  return app;
}
