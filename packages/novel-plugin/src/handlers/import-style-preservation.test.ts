import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeRuntimeDomainTool } from "./runtime-domain-tools.js";
import { createStylePreset } from "../engine/writing-layers/style-preset.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("导入正文不覆盖作者文风", () => {
  it.each(["style_profile.json", "style_preset.json"])("导入时保留 %s 的原始内容", async (filename) => {
    const root = await mkdtemp(join(tmpdir(), "nf-import-style-")); roots.push(root);
    await mkdir(join(root, "story"));
    const fingerprint = { avgSentenceLength: 18, sentenceLengthStdDev: 7, vocabularyDiversity: 0.65 };
    const value = filename === "style_preset.json" ? createStylePreset(fingerprint) : fingerprint;
    const original = JSON.stringify(value);
    await writeFile(join(root, "story", filename), original);
    const context = { projectRoot: root, runtimeProjectId: "test", sessionId: "test", projectType: "novel", enabledPluginIds: ["novel"], resourceBindings: {} } as Parameters<typeof executeRuntimeDomainTool>[3];
    const result = await executeRuntimeDomainTool("pipeline_import_chapters", {
      content: `第一章 归来\n${"她走过长街，停在家门口。".repeat(120)}`,
      autoSettle: false, extractBrief: false,
    }, { bookId: "book-a", root }, context);
    expect(result).toMatchObject({ ok: true, data: { importedChapters: 1 } });
    expect(await readFile(join(root, "story", filename), "utf8")).toBe(original);
    const chapters = JSON.parse(await readFile(join(root, "chapters", "index.json"), "utf8"));
    expect(chapters).toHaveLength(1);
  });
});
