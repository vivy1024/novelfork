import { Hono } from "hono";
import { execSync } from "node:child_process";
import { platform, release, arch } from "node:os";

interface RuntimeCheck {
  name: string;
  status: "ok" | "unavailable";
  version?: string;
  error?: string;
}

export function createRuntimeStatusRouter() {
  const app = new Hono();

  app.get("/status", (c) => {
    const checks: RuntimeCheck[] = [];

    // Git
    try {
      const version = execSync("git --version", { encoding: "utf-8", timeout: 5000 }).trim();
      checks.push({ name: "Git", status: "ok", version });
    } catch {
      checks.push({ name: "Git", status: "unavailable", error: "git not found" });
    }

    // Terminal (check if shell is available)
    try {
      const shell = process.env.SHELL || process.env.COMSPEC || "unknown";
      checks.push({ name: "Terminal", status: "ok", version: shell });
    } catch {
      checks.push({ name: "Terminal", status: "unavailable", error: "no shell available" });
    }

    // Bun/Node runtime
    const bunVersion = (process.versions as Record<string, string | undefined>).bun;
    checks.push({
      name: "Runtime",
      status: "ok",
      version: `Bun ${bunVersion ?? "N/A"} / Node ${process.version}`,
    });

    // OS
    checks.push({
      name: "OS",
      status: "ok",
      version: `${platform()} ${release()} ${arch()}`,
    });

    return c.json({ checks });
  });

  return app;
}
