import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { WORKFLOW_RECIPES_RELATIVE_PATH } from "../engine/workflows/workflow-store.js";
import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

let storage: StorageDatabase;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

type ToolResult = { ok: boolean; error?: string; summary?: string; data?: Record<string, any> };

async function call(toolName: string, input: Record<string, unknown>, sessionId = "narrator-1"): Promise<ToolResult> {
  const context = {
    runtimeProjectId: "project-1",
    projectRoot: testDir,
    projectType: "novel",
    enabledPluginIds: ["novel"],
    resourceBindings: {},
    sessionId,
  } as unknown as Parameters<typeof executeRuntimeDomainTool>[3];
  const result = await executeRuntimeDomainTool(toolName, input, binding, context);
  if (!result) throw new Error(`${toolName} 没有被分派`);
  return result as ToolResult;
}

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-recipe-tools-${crypto.randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  await writeFile(join(testDir, "book.json"), JSON.stringify({ id: "book-1", chapterWordCount: 2000 }), "utf8");
  storage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => storage);
  binding = { bookId: "book-1", root: testDir };
});

afterEach(async () => {
  vi.restoreAllMocks();
  storage.close();
  await rm(testDir, { recursive: true, force: true });
});

const buildOps = [
  { op: "add_node", node: { type: "step", id: "plan", label: "写蓝图", kind: "guided-plan", tools: ["scene.spec"] } },
  { op: "add_node", node: { type: "step", id: "draft", label: "起草", kind: "writer-generate", requiresApproval: true } },
  { op: "connect", source: "start", target: "plan" },
  { op: "connect", source: "plan", target: "draft" },
  { op: "connect", source: "draft", target: "end" },
  { op: "connect", source: "draft", target: "plan", kind: "reject" },
];

describe("工作流方案工具（叙述者侧）", () => {
  it("列出方案：未配置时就是三个内置方案，都已发布", async () => {
    const listed = await call("workflow_list_recipes", {});
    expect(listed.ok).toBe(true);
    expect(listed.data!.recipes).toHaveLength(3);
    expect(listed.data!.recipes.every((recipe: { status: string; issueCount: number }) => recipe.status === "published" && recipe.issueCount === 0)).toBe(true);
  });

  it("用编辑指令从空白建一份草稿：标为叙述者所建，结构完整，给模型的结构里没有画布位置", async () => {
    const created = await call("workflow.edit_recipe", { name: "快写流", recipeId: "quick", ops: buildOps });
    expect(created.ok).toBe(true);
    expect(created.summary).toContain("确认发布");
    expect(created.data!.recipe).toMatchObject({ id: "quick", status: "draft", revision: 1, createdBy: "narrator", issues: [] });
    expect(created.data!.recipe).not.toHaveProperty("layout");

    const onDisk = JSON.parse(await readFile(join(testDir, WORKFLOW_RECIPES_RELATIVE_PATH), "utf8")) as Array<{ id: string }>;
    expect(onDisk.map((recipe) => recipe.id)).toContain("quick");

    const fetched = await call("workflow_get_recipe", { recipeId: "quick" });
    expect(fetched.data!.recipe.edges.filter((edge: { kind: string }) => edge.kind === "reject")).toHaveLength(1);
  });

  it("已发布的方案不能直接改，要用 copyFrom 另建草稿", async () => {
    const denied = await call("workflow_edit_recipe", { recipeId: "fanqie-xuanhuan-serial", ops: [{ op: "set_meta", patch: { name: "乱改" } }] });
    expect(denied).toMatchObject({ ok: false, error: "recipe-published" });
    expect(denied.summary).toContain("copyFrom");

    const copied = await call("workflow_edit_recipe", {
      copyFrom: "fanqie-xuanhuan-serial",
      ops: [{ op: "disconnect", source: "step-adversarial-audit", target: "step-settlement" }],
    });
    expect(copied.ok).toBe(true);
    expect(copied.data!.recipe).toMatchObject({ id: "fanqie-xuanhuan-serial-draft", status: "draft", createdBy: "narrator" });
    // 改到一半断开了流程：草稿照存，结构问题如实返回，发布前要修好。
    expect(copied.data!.recipe.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(["step-dangling", "step-unreached"]));
    expect(copied.summary).toContain("结构问题");
  });

  it("一批指令里有一条不合法：整批不生效、不落盘，并指出第几条", async () => {
    const rejected = await call("workflow_edit_recipe", { name: "坏流程", ops: [...buildOps, { op: "connect", source: "draft", target: "不存在" }] });
    expect(rejected).toMatchObject({ ok: false, error: "ops-rejected" });
    expect(rejected.data!.failedIndex).toBe(6);
    const listed = await call("workflow_list_recipes", {});
    expect(listed.data!.recipes).toHaveLength(3);
  });

  it("按旧版本号修改草稿会被拒，提示重新读取", async () => {
    await call("workflow_edit_recipe", { name: "快写流", recipeId: "quick", ops: buildOps });
    await call("workflow_edit_recipe", { recipeId: "quick", expectedRevision: 1, ops: [{ op: "set_meta", patch: { description: "第二版" } }] });
    const stale = await call("workflow_edit_recipe", { recipeId: "quick", expectedRevision: 1, ops: [{ op: "set_meta", patch: { description: "过期修改" } }] });
    expect(stale).toMatchObject({ ok: false, error: "revision-conflict" });
    expect(stale.summary).toContain("重新读取");
  });

  it("启动运行：草稿不能运行；已发布方案启动后返回进度卡与简报", async () => {
    await call("workflow_edit_recipe", { name: "快写流", recipeId: "quick", ops: buildOps });
    const draftRun = await call("workflow_start_run", { recipeId: "quick", chapterNumber: 2 });
    expect(draftRun).toMatchObject({ ok: false, error: "recipe-not-published" });
    expect(draftRun.summary).toContain("画布");

    const started = await call("workflow_start_run", { recipeId: "fanqie-xuanhuan-serial", chapterNumber: 2 });
    expect(started.ok).toBe(true);
    expect(started.data).toMatchObject({ runStatus: "running", currentStepId: "step-context" });
    expect(String(started.data!.brief)).toContain("▶ 工序 1");
  });
});
