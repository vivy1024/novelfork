/**
 * Routines API 路由
 */

import { Hono } from "hono";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawn, exec } from "node:child_process";
import {
  loadGlobalRoutines,
  saveGlobalRoutines,
  loadProjectRoutines,
  saveProjectRoutines,
  mergeRoutines,
  resetRoutines,
} from "../lib/routines-service.js";
import type { Routines } from "../../types/routines.js";

export function createRoutinesRouter() {
  const app = new Hono();

  /**
   * GET /api/routines/global
   * 获取全局配置
   */
  app.get("/global", async (c) => {
    try {
      const routines = await loadGlobalRoutines();
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to load global routines:", error);
      return c.json({ error: "Failed to load global routines" }, 500);
    }
  });

  /**
   * PUT /api/routines/global
   * 保存全局配置
   */
  app.put("/global", async (c) => {
    try {
      const routines = await c.req.json<Routines>();
      await saveGlobalRoutines(routines);
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to save global routines:", error);
      return c.json({ error: "Failed to save global routines" }, 500);
    }
  });

  /**
   * GET /api/routines/project
   * 获取项目配置
   */
  app.get("/project", async (c) => {
    try {
      const projectRoot = c.req.query("root");
      if (!projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await loadProjectRoutines(projectRoot);
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to load project routines:", error);
      return c.json({ error: "Failed to load project routines" }, 500);
    }
  });

  /**
   * PUT /api/routines/project
   * 保存项目配置
   */
  app.put("/project", async (c) => {
    try {
      const projectRoot = c.req.query("root");
      if (!projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await c.req.json<Routines>();
      await saveProjectRoutines(projectRoot, routines);
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to save project routines:", error);
      return c.json({ error: "Failed to save project routines" }, 500);
    }
  });

  /**
   * GET /api/routines/merged
   * 获取合并后的配置（全局 + 项目）
   */
  app.get("/merged", async (c) => {
    try {
      const projectRoot = c.req.query("root");

      const globalRoutines = await loadGlobalRoutines();
      const projectRoutines = projectRoot
        ? await loadProjectRoutines(projectRoot)
        : null;

      const merged = mergeRoutines(globalRoutines, projectRoutines);
      return c.json({ routines: merged });
    } catch (error) {
      console.error("Failed to load merged routines:", error);
      return c.json({ error: "Failed to load merged routines" }, 500);
    }
  });

  /**
   * POST /api/routines/reset
   * 重置配置为默认值
   */
  app.post("/reset", async (c) => {
    try {
      const body = await c.req.json<{ scope: "global" | "project"; projectRoot?: string }>();
      const { scope, projectRoot } = body;

      if (scope !== "global" && scope !== "project") {
        return c.json({ error: "Invalid scope" }, 400);
      }

      if (scope === "project" && !projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await resetRoutines(scope, projectRoot);
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to reset routines:", error);
      return c.json({ error: "Failed to reset routines" }, 500);
    }
  });

  /**
   * POST /api/routines/hooks/test
   * 测试执行一个 hook 命令，返回 stdout + exitCode
   */
  app.post("/hooks/test", async (c) => {
    try {
      const body = await c.req.json<{ command: string; toolName?: string; file?: string }>();
      const { command, toolName, file } = body;

      if (!command || typeof command !== "string") {
        return c.json({ error: "command is required" }, 400);
      }

      const workDir = process.cwd();
      const timeout = 10_000;

      // 通过环境变量传递上下文（避免命令注入）
      const hookEnv = {
        ...process.env,
        HOOK_TOOL: toolName ?? "",
        HOOK_FILE: file ?? "",
        HOOK_WORKDIR: workDir,
      };

      // 替换占位符为环境变量引用
      const resolvedCommand = command
        .replaceAll("{tool}", process.platform === "win32" ? "%HOOK_TOOL%" : "$HOOK_TOOL")
        .replaceAll("{file}", process.platform === "win32" ? "%HOOK_FILE%" : "$HOOK_FILE");

      const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
        const shellArgs = process.platform === "win32" ? ["/c", resolvedCommand] : ["-c", resolvedCommand];

        const proc = spawn(shell, shellArgs, {
          cwd: workDir,
          env: hookEnv,
          stdio: ["ignore", "pipe", "pipe"],
          timeout,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on("error", (err: Error) => {
          resolve({ exitCode: 1, stdout, stderr: stderr || err.message });
        });

        proc.on("close", (code: number | null) => {
          resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
        });
      });

      return c.json({ ok: true, ...result });
    } catch (error) {
      return c.json({ error: "Hook test execution failed" }, 500);
    }
  });

  /**
   * GET /api/routines/disk-skills
   * 扫描磁盘上的 skill 文件（.novelfork/skills/、.claude/skills/、.kiro/skills/）
   */
  app.get("/disk-skills", async (c) => {
    try {
      const workDir = process.cwd();
      const { homedir } = await import("node:os");
      const skillDirs = [
        // 项目级
        { path: join(workDir, ".novelfork", "skills"), scope: "project" as const },
        { path: join(workDir, ".claude", "skills"), scope: "project" as const },
        { path: join(workDir, ".kiro", "skills"), scope: "project" as const },
        // 全局级
        { path: join(homedir(), ".novelfork", "skills"), scope: "global" as const },
      ];

      const skills: Array<{ name: string; path: string; scope: string; size: number; preview: string }> = [];

      for (const { path: dir, scope } of skillDirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = await readdir(dir);
          for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const fullPath = join(dir, file);
            const fileStat = await stat(fullPath);
            const content = await readFile(fullPath, "utf-8");
            const name = file.replace(/\.md$/, "");
            // 提取第一行作为标题（去掉 # 前缀）
            const firstLine = content.split("\n").find(l => l.trim())?.replace(/^#+\s*/, "").trim() ?? name;
            skills.push({
              name,
              path: fullPath,
              scope,
              size: fileStat.size,
              preview: firstLine,
            });
          }
        } catch { /* directory read failure — skip */ }
      }

      return c.json({ ok: true, skills });
    } catch (error) {
      return c.json({ ok: false, error: "Failed to scan disk skills" }, 500);
    }
  });

  /**
   * POST /api/routines/commands/:name/execute
   * 执行用户自定义命令：运行 preCommand、替换模板变量、返回最终 prompt
   */
  app.post("/commands/:name/execute", async (c) => {
    try {
      const commandName = c.req.param("name");
      const body = await c.req.json<{ args?: Record<string, string> }>().catch(() => ({}));
      const args = (body as { args?: Record<string, string> }).args ?? {};

      // 加载合并后的配置找到命令
      const globalRoutines = await loadGlobalRoutines();
      const projectRoot = c.req.query("root");
      const projectRoutines = projectRoot ? await loadProjectRoutines(projectRoot) : null;
      const merged = mergeRoutines(globalRoutines, projectRoutines);

      const command = merged.commands.find(cmd => cmd.name === commandName && cmd.enabled);
      if (!command) {
        return c.json({ ok: false, error: `Command "${commandName}" not found or disabled` }, 404);
      }

      // 执行 preCommand（如果有）
      let preCommandOutput = "";
      if (command.preCommand) {
        preCommandOutput = await new Promise<string>((resolve, reject) => {
          exec(command.preCommand!, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`preCommand failed: ${error.message}\nstderr: ${stderr}`));
            } else {
              resolve(stdout.trim());
            }
          });
        });
      }

      // 模板变量替换
      let prompt = command.prompt;
      // {output} → preCommand 输出
      prompt = prompt.replace(/\{output\}/g, preCommandOutput);
      // {arg.xxx} → args 中对应的值
      prompt = prompt.replace(/\{arg\.(\w+)\}/g, (_match, argName: string) => {
        return args[argName] ?? "";
      });
      // 兼容 {{input}} / {{args}} 格式
      const argsStr = Object.values(args).join(" ");
      prompt = prompt.replace(/\{\{input\}\}/g, argsStr);
      prompt = prompt.replace(/\{\{args\}\}/g, argsStr);

      return c.json({
        ok: true,
        prompt,
        ...(command.modelOverride ? { modelOverride: command.modelOverride } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command execution failed";
      console.error("Failed to execute command:", error);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  return app;
}
