import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

describe("retired Tauri boundary", () => {
  it("keeps the production Studio bundle free of Tauri bridge code and dependencies", async () => {
    const studioRoot = process.cwd();
    const packageJson = JSON.parse(await readFile(join(studioRoot, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    const viteConfig = await readFile(join(studioRoot, "vite.config.ts"), "utf-8");

    expect(Object.keys(packageJson.dependencies ?? {}).filter((name) => name.startsWith("@tauri-apps/"))).toEqual([]);
    expect(viteConfig).not.toContain("@tauri-apps/");
    expect(existsSync(join(studioRoot, "src", "hooks", "tauri-api-bridge.ts"))).toBe(false);
    expect(existsSync(join(studioRoot, "src", "storage", "tauri-adapter.ts"))).toBe(false);
    expect(existsSync(join(studioRoot, "src", "ai", "relay-client.ts"))).toBe(false);
  });

  it("keeps current Studio source free of retired runtime markers", async () => {
    const studioRoot = process.cwd();
    const sourceFiles = await glob("src/**/*.{ts,tsx}", {
      cwd: studioRoot,
      ignore: ["src/retired-tauri-boundary.test.ts"],
      nodir: true,
    });

    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const source = await readFile(join(studioRoot, file), "utf-8");
      if (/(__TAURI_INTERNALS__|@tauri-apps\/|tauri-api-bridge|tauri-adapter|TauriStorageAdapter)/i.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
