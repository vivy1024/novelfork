import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { killProcessTree, processTreeKillCommands } from "./process-tree";

const repositoryRoot = join(import.meta.dir, "..");
const script = readFileSync(join(repositoryRoot, "scripts", "start-isolated-verify.ts"), "utf8");
const rootMain = readFileSync(join(repositoryRoot, "main.ts"), "utf8");
const claudeMd = readFileSync(join(repositoryRoot, "CLAUDE.md"), "utf8");

describe("隔离验证实例契约", () => {
  test("覆盖 main.ts 全部会落到用户家目录的数据路径变量", () => {
    // main.ts defaults these to ~/.novelfork. Overriding only a subset writes
    // verification accounts into the user's real Runtime database, which has
    // already happened more than once. Every variable must stay covered.
    const required = [
      "NOVELFORK_HOME",
      "NOVELFORK_PROJECT_ROOT",
      "NOVELFORK_BOOKS_ROOT",
      "NOVELFORK_RUNTIME_DIR",
      "NOVELFORK_SESSION_STORE_DIR",
      "NOVELFORK_STORAGE_DB_PATH",
    ];
    for (const variable of required) {
      expect(rootMain).toContain(variable);
      expect(script).toContain(variable);
    }
  });

  test("隔离数据路径全部落在同一个可丢弃目录内，不指向用户家目录", () => {
    expect(script).toContain("mkdtempSync(join(tmpdir(), \"novelfork-verify-\"))");
    expect(script).toContain("const runtimeDir = join(options.root, \"runtime\")");
    expect(script).toContain("NOVELFORK_HOME: options.root");
    expect(script).toContain("NOVELFORK_RUNTIME_DIR: runtimeDir");
    // Runtime 的 NARRAFORK_HOME 由 main.ts 推导；继承来的属于独立 NarraFork 宿主，隔离不能依赖它
    expect(script).not.toContain("NARRAFORK_HOME:");
    expect(script).toContain("NOVELFORK_STORAGE_DB_PATH: join(options.root, \"novelfork.db\")");
    expect(script).not.toContain("homedir()");
    expect(script).not.toContain(".novelfork\"");
  });

  test("默认不弹窗且默认清理临时数据", () => {
    expect(script).toContain('NOVELFORK_NO_BROWSER: "1"');
    expect(script).toContain("rmSync(options.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })");
  });

  test("子进程退出与外层收到信号都先结束整棵子进程树，再清理数据目录", () => {
    const dispose = script.slice(script.indexOf("function dispose(): void {"));
    expect(dispose.indexOf("killProcessTree(child.pid)")).toBeGreaterThan(0);
    expect(dispose.indexOf("killProcessTree(child.pid)")).toBeLessThan(dispose.indexOf("rmSync(options.root"));
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) expect(script).toContain(`"${signal}"`);
    // 信号处理与正常退出都调用 dispose；不再只 child.kill()（Windows 上会留下孤儿 bun main.ts）
    expect(script).not.toContain("child.kill()");
    expect(script.match(/dispose\(\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("Windows 用 taskkill /T /F 结束整棵树，参数按数组传、不经过 shell", () => {
    expect(processTreeKillCommands(1234, "win32")).toEqual([["taskkill", "/T", "/F", "/PID", "1234"]]);
    expect(processTreeKillCommands(1234, "linux")).toEqual([
      ["pkill", "-KILL", "-P", "1234"],
      ["kill", "-KILL", "1234"],
    ]);
    expect(processTreeKillCommands(0, "win32")).toEqual([]);
  });

  test("killProcessTree 真正结束子进程及其后代", async () => {
    // 子进程再拉起一个长睡的孙进程，模拟 bun run main.ts 的进程树。
    const grandchildScript = "setInterval(() => {}, 1000)";
    const parentScript = `const g = Bun.spawn([process.execPath, "-e", ${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "ignore", "ignore"] }); console.log(g.pid); setInterval(() => {}, 1000);`;
    const parent = Bun.spawn([process.execPath, "-e", parentScript], { stdout: "pipe", stderr: "ignore" });
    const reader = parent.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const grandchildPid = Number(new TextDecoder().decode(value).trim());
    expect(grandchildPid).toBeGreaterThan(0);

    killProcessTree(parent.pid);
    await parent.exited;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // 给系统一点时间回收孙进程
    for (let attempt = 0; attempt < 20 && alive(grandchildPid); attempt += 1) await Bun.sleep(100);
    expect(alive(grandchildPid)).toBe(false);
  }, 15_000);

  test("默认端口避开用户实例与开发 Runtime 端口", () => {
    // 4567 is the product default and 7778 the dev Runtime port; colliding with
    // either can attach verification traffic to the developer's own instance.
    // The generated range 41000-44999 excludes both by construction.
    expect(script).toContain("41000 + Math.floor(Math.random() * 4000)");
    expect(script).not.toMatch(/PORT: "(4567|7778)"/);
    expect(script).not.toMatch(/port = (4567|7778)\b/);
  });

  test("CLAUDE.md 把隔离验证固化为约定并说明部分覆盖不构成隔离", () => {
    expect(claudeMd).toContain("scripts/start-isolated-verify.ts");
    expect(claudeMd).toContain("只设 `NOVELFORK_PROJECT_ROOT` **不构成隔离**");
    expect(claudeMd).toContain("取得明确授权后");
  });
});
