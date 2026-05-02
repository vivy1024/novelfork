import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI current wording contracts", () => {
  it("does not present project config set as an API key storage path", async () => {
    const source = await readFile(join(process.cwd(), "src", "commands", "config.ts"), "utf-8");

    expect(source).toContain("Config key (e.g., llm.model)");
    expect(source).not.toContain("Config key (e.g., llm.apiKey)");
  });

  it("uses only supported platform values in English init next steps", async () => {
    const source = await readFile(join(process.cwd(), "src", "commands", "init.ts"), "utf-8");

    expect(source).toContain("--platform other --lang en");
    expect(source).not.toContain("--platform royalroad");
  });

  it("aligns doctor runtime requirement with package engines", async () => {
    const source = await readFile(join(process.cwd(), "src", "commands", "doctor.ts"), "utf-8");

    expect(source).toContain('name: "Node.js >= 22"');
    expect(source).toContain("ok: major >= 22");
    expect(source).not.toContain('name: "Node.js >= 20"');
  });
});
