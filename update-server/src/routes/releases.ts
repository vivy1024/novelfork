/**
 * Releases API 路由
 */

import { Hono } from "hono";
import { getLatestRelease, getReleaseList } from "../github-proxy.js";

export function createReleasesRouter() {
  const app = new Hono();

  /**
   * GET /api/releases/latest?channel=stable&platform=windows-x64
   */
  app.get("/latest", async (c) => {
    const channel = c.req.query("channel") || "stable";
    const platform = c.req.query("platform") || "windows-x64";

    try {
      const release = await getLatestRelease(channel, platform);
      if (!release) {
        return c.json({ error: "No release found", channel, platform }, 404);
      }
      return c.json(release);
    } catch (error) {
      console.error("[releases/latest] Error:", error);
      return c.json({ error: "Failed to fetch release info" }, 502);
    }
  });

  /**
   * GET /api/releases?channel=stable&platform=windows-x64&limit=5
   */
  app.get("/", async (c) => {
    const channel = c.req.query("channel") || "stable";
    const platform = c.req.query("platform") || "windows-x64";
    const limit = Math.min(parseInt(c.req.query("limit") || "5", 10), 20);

    try {
      const releases = await getReleaseList(channel, platform, limit);
      return c.json({ releases, channel, platform });
    } catch (error) {
      console.error("[releases] Error:", error);
      return c.json({ error: "Failed to fetch releases" }, 502);
    }
  });

  return app;
}
