/**
 * 内置插件的产品路由：作者一键启用 narrator-team，不下 GitHub、不放目录。
 * 挂在 /api/plugins/bundled/*：产品路由先于 Runtime 的 /api/plugins/:pluginId 注册
 * （app.ts 挂载顺序），通配不会抢先。
 */

import { Hono } from "hono";
import { getPluginManager } from "@vivy1024/narrafork-runtime-bridge";

import { BUNDLED_NARRATOR_TEAM } from "../plugins/bundled-narrator-team";
import { bundledNarratorTeamState, installBundledNarratorTeam } from "../plugins/bundled-narrator-team-service";

export const bundledPluginRoutes = new Hono();

bundledPluginRoutes.get("/narrator-team/status", async (c) => {
  const state = await bundledNarratorTeamState(await getPluginManager());
  return c.json({
    pluginId: BUNDLED_NARRATOR_TEAM.pluginId,
    bundledVersion: BUNDLED_NARRATOR_TEAM.version,
    installed: state.installed,
    runtimeState: state.runtimeState,
  });
});

bundledPluginRoutes.post("/narrator-team/install", async (c) => {
  const result = await installBundledNarratorTeam(await getPluginManager());
  return c.json({ pluginId: BUNDLED_NARRATOR_TEAM.pluginId, ...result }, result.status === "installed" ? 201 : 200);
});
