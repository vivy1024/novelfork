/**
 * 内置插件的产品路由：作者一键启用 narrator-team，不下 GitHub、不放目录。
 * 挂在 /api/plugins/bundled/*：产品路由先于 Runtime 的 /api/plugins/:pluginId 注册
 * （app.ts 挂载顺序），通配不会抢先。
 *
 * 安装会改动整个 Runtime 的插件台账（对所有用户生效），只允许管理员（T-04）；
 * 查询状态对所有登录用户开放。管理员判定写在处理函数里而不是挂中间件，
 * 以保持路由清单与 product-route-inventory 的精确快照一致。
 */

import { Hono } from "hono";
import { getPluginManager } from "@vivy1024/narrafork-runtime-bridge";

import { BUNDLED_NARRATOR_TEAM } from "../plugins/bundled-narrator-team";
import {
  bundledNarratorTeamState,
  installBundledNarratorTeam,
  type BundledPluginManager,
} from "../plugins/bundled-narrator-team-service";
import { denyUnlessAdmin } from "./admin-write-guard";
import { forwardErrorsToParent } from "./forward-errors";

export interface BundledPluginRouteDeps {
  /** 测试注入点：插件管理器，默认为 Runtime 的单例。 */
  readonly getManager?: () => Promise<BundledPluginManager>;
}

export function createBundledPluginRoutes(deps: BundledPluginRouteDeps = {}): Hono {
  const getManager = deps.getManager ?? (async () => (await getPluginManager()) as BundledPluginManager);
  // 异常交回 Runtime 父应用的 onError 统一序列化成 JSON（见 forward-errors.ts）。
  const routes = forwardErrorsToParent(new Hono());

  routes.get("/narrator-team/status", async (c) => {
    const state = await bundledNarratorTeamState(await getManager());
    return c.json({
      pluginId: BUNDLED_NARRATOR_TEAM.pluginId,
      bundledVersion: BUNDLED_NARRATOR_TEAM.version,
      installed: state.installed,
      runtimeState: state.runtimeState,
    });
  });

  routes.post("/narrator-team/install", async (c) => {
    const denied = await denyUnlessAdmin(c);
    if (denied) return denied;
    const result = await installBundledNarratorTeam(await getManager());
    return c.json({ pluginId: BUNDLED_NARRATOR_TEAM.pluginId, ...result }, result.status === "installed" ? 201 : 200);
  });

  return routes;
}

export const bundledPluginRoutes = createBundledPluginRoutes();
