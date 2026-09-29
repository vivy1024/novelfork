import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

// 只执行公开启动脚本的配置逻辑。文件操作、进程、环境与退出均使用隔离替身；
// 不导入 Runtime，不读取真实环境中的连接串，不创建目录，不启动子进程。
const scriptDirectory = import.meta.dir;
const source = readFileSync(join(scriptDirectory, "start-isolated-verify.ts"), "utf8");
const executable = new Bun.Transpiler({ loader: "ts", target: "bun" })
  .transformSync(source)
  .replace(/^import\s+[^;]+\s+from\s+["']node:(?:fs|os|path)["'];?\s*$/gm, "")
  .replaceAll("import.meta.dir", "scriptDirectory");

async function captureChildEnvironment(ambient: Record<string, string>) {
  let environment: Record<string, string> | undefined;
  let spawnCount = 0;
  let exitCode: number | undefined;
  const parentEnvironment = { ...ambient };
  const root = resolve(scriptDirectory, "__offline_pg_contract__");
  const forbidden = () => { throw new Error("离线配置核查禁止真实文件操作或进程操作"); };
  await runInNewContext(`(async () => {\n${executable}\n})()`, {
    scriptDirectory,
    join,
    resolve,
    existsSync: () => true,
    mkdirSync: () => undefined,
    mkdtempSync: forbidden,
    rmSync: forbidden,
    tmpdir: forbidden,
    console: { log: () => undefined },
    process: {
      argv: ["offline-bun", "start-isolated-verify.ts", `--root=${root}`, "--port=4613"],
      env: parentEnvironment,
      execPath: "offline-bun",
      on: () => undefined,
      exit: (code: number) => { exitCode = code; },
    },
    Bun: {
      spawn: (args: string[], options: { env: Record<string, string> }) => {
        expect(Array.from(args)).toEqual(["offline-bun", "run", "main.ts"]);
        spawnCount += 1;
        environment = { ...options.env };
        return { exited: Promise.resolve(0), kill: forbidden };
      },
    },
  }, { timeout: 1000 });
  expect(spawnCount).toBe(1);
  expect(exitCode).toBe(0);
  expect(environment).toBeDefined();
  expect(parentEnvironment).toEqual(ambient);
  return { environment: environment!, root };
}

describe("隔离验证环境不继承 PostgreSQL 连接配置", () => {
  test("产品测试 preload 在导入 Runtime 之前清理继承的后端配置", () => {
    const preloadDirectory = resolve(scriptDirectory, "../packages/novelfork-product-runtime/src");
    const preload = new Bun.Transpiler({ loader: "ts", target: "bun" })
      .transformSync(readFileSync(join(preloadDirectory, "test-env.ts"), "utf8"))
      .replace(/^import\s+[^;]+\s+from\s+["']node:(?:fs|os|path)["'];?\s*$/gm, "")
      .replaceAll("import.meta.dir", "scriptDirectory");
    const environment: Record<string, string> = {
      NF_DATABASE_BACKEND: "postgres", NF_DATABASE_URL: "postgres://invalid.example/never-connect",
      DATABASE_URL: "postgres://invalid.example/never-connect", NF_READ_BACKEND: "postgres", NF_WRITE_BACKEND: "postgres",
    };
    runInNewContext(preload, {
      scriptDirectory: preloadDirectory, join, resolve,
      tmpdir: () => "offline-temp", mkdtempSync: () => "offline-temp/product-test", mkdirSync: () => undefined,
      process: { env: environment },
    }, { timeout: 1000 });
    expect(environment.NF_DATABASE_BACKEND).toBe("sqlite");
    for (const name of ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) {
      expect(Object.hasOwn(environment, name)).toBe(false);
    }
  });

  test("工作区测试的公开包与 Runtime 子进程都不继承外部连接", async () => {
    const workspace = new Bun.Transpiler({ loader: "ts", target: "bun" })
      .transformSync(readFileSync(join(scriptDirectory, "run-workspace-tests.ts"), "utf8"))
      .replace(/^import\s+[^;]+\s+from\s+["'][^"']+["'];?\s*$/gm, "")
      .replaceAll("import.meta.dir", "scriptDirectory");
    const children: Array<Record<string, string>> = [];
    const environment = { NF_DATABASE_BACKEND: "postgres", NF_DATABASE_URL: "postgres://invalid.example/never-connect", DATABASE_URL: "postgres://invalid.example/never-connect" };
    await runInNewContext(`(async () => {\n${workspace}\n})()`, {
      scriptDirectory, join, resolve, delimiter: ";",
      homedir: () => "offline-home", tmpdir: () => "offline-temp", mkdtempSync: () => "offline-temp/workspace-test",
      mkdirSync: () => undefined, rmSync: () => undefined, existsSync: () => true,
      readFileSync: () => JSON.stringify({ entries: [{}] }), statSync: () => ({ isFile: () => true, isDirectory: () => true }),
      prepareRuntimeExecutionRoot: () => ({ cleanup: () => undefined }),
      process: { env: environment, platform: "win32", execPath: "offline-bun", exit: () => { throw new Error("测试子进程不应失败"); } },
      Bun: { spawn: (_args: string[], options: { env: Record<string, string> }) => { children.push(options.env); return { exited: Promise.resolve(0) }; } },
    }, { timeout: 1000 });
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.NF_DATABASE_BACKEND).toBe("sqlite");
      for (const name of ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) expect(Object.hasOwn(child, name)).toBe(false);
    }
    expect(environment.NF_DATABASE_BACKEND).toBe("postgres");
  });

  test("宿主未选择后端时，验证子进程也显式选择 SQLite", async () => {
    const { environment } = await captureChildEnvironment({});
    expect(environment.NF_DATABASE_BACKEND).toBe("sqlite");
    for (const name of ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) {
      expect(Object.hasOwn(environment, name)).toBe(false);
    }
  });

  test("覆盖宿主 PostgreSQL 选择并删除主连接串，同时隔离本地路径", async () => {
    const ambient = {
      NOVELFORK_HOME: "不得使用的宿主目录",
      NOVELFORK_STORAGE_DB_PATH: "不得使用的宿主数据库",
      NF_DATABASE_BACKEND: "postgres",
      NF_DATABASE_URL: "postgres://offline:fixture@invalid.example:1/never-connect",
    };
    const { environment, root } = await captureChildEnvironment(ambient);
    expect(environment.NOVELFORK_HOME).toBe(root);
    expect(environment.NOVELFORK_STORAGE_DB_PATH).toBe(join(root, "novelfork.db"));
    expect(environment.NOVELFORK_RUNTIME_DIR).toBe(join(root, "runtime"));
    expect(environment.NOVELFORK_NO_BROWSER).toBe("1");
    expect(environment.NF_DATABASE_BACKEND).toBe("sqlite");
    expect(Object.hasOwn(environment, "NF_DATABASE_URL")).toBe(false);
  });

  test("删除继承的回退连接串和冲突读写选择器", async () => {
    const ambient = {
      NF_DATABASE_BACKEND: "postgres",
      DATABASE_URL: "postgresql://offline:fixture@invalid.example:1/never-connect",
      NF_READ_BACKEND: "sqlite",
      NF_WRITE_BACKEND: "sqlite",
    };
    const { environment } = await captureChildEnvironment(ambient);
    expect(environment.NF_DATABASE_BACKEND).toBe("sqlite");
    for (const name of ["DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) {
      expect(Object.hasOwn(environment, name)).toBe(false);
    }
  });
});
