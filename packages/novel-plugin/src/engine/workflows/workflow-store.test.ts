import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE } from "./novel-workflows.js";
import type { WorkflowGraphRecipe } from "./workflow-graph.js";
import {
  deleteWorkflowRecipe,
  readWorkflowRecipes,
  saveWorkflowRecipe,
  WORKFLOW_RECIPES_RELATIVE_PATH,
  WorkflowStoreError,
} from "./workflow-store.js";

let bookRoot = "";

beforeEach(async () => {
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-workflow-store-"));
});

afterEach(async () => {
  await rm(bookRoot, { recursive: true, force: true });
});

const filePath = () => join(bookRoot, WORKFLOW_RECIPES_RELATIVE_PATH);

function draft(patch: Partial<WorkflowGraphRecipe> = {}): WorkflowGraphRecipe {
  return {
    schemaVersion: 2,
    id: "my-flow",
    name: "我的流程",
    commandId: "/novel:mine",
    description: "",
    status: "draft",
    revision: 0,
    nodes: [
      { id: "start", type: "start", label: "开始" },
      { id: "a", type: "step", label: "写", kind: "writer-generate", enabled: true },
      { id: "end", type: "end", label: "完成" },
    ],
    edges: [
      { id: "e1", source: "start", target: "a", kind: "next" },
      { id: "e2", source: "a", target: "end", kind: "next" },
    ],
    resultStrategy: "formal-chapter",
    maxRetries: 1,
    ...patch,
  };
}

async function expectStoreError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WorkflowStoreError);
  expect((error as WorkflowStoreError).code).toBe(code);
  expect((error as WorkflowStoreError).status).toBe(status);
  return error as WorkflowStoreError;
}

describe("workflow-store：图结构方案的读写", () => {
  it("旧的线性方案文件读取时在内存里转成图，不回写磁盘", async () => {
    await mkdir(join(bookRoot, "story"), { recursive: true });
    const legacy = JSON.stringify([{
      id: "old",
      name: "旧方案",
      commandId: "/novel:old",
      description: "",
      steps: [{ id: "a", kind: "context-load", label: "读上下文", enabled: true }],
      resultStrategy: "formal-chapter",
      requireFinalApproval: false,
      maxRetries: 0,
    }]);
    await writeFile(filePath(), legacy, "utf8");

    const recipes = await readWorkflowRecipes(bookRoot);
    expect(recipes[0]).toMatchObject({ schemaVersion: 2, status: "published", revision: 1 });
    expect(recipes[0]!.nodes.map((node) => node.id)).toEqual(["start", "a", "end"]);
    expect(await readFile(filePath(), "utf8")).toBe(legacy);
  });

  it("新建方案：以内置方案为底写出完整列表，revision 从 1 开始", async () => {
    const saved = await saveWorkflowRecipe(bookRoot, draft(), { expectedRevision: 0 });
    expect(saved.revision).toBe(1);
    const recipes = await readWorkflowRecipes(bookRoot);
    expect(recipes.map((recipe) => recipe.id)).toEqual(expect.arrayContaining([FANQIE_XUANHUAN_SERIAL_RECIPE.id, "my-flow"]));
  });

  it("按旧版本保存返回 409 与三段式说明，磁盘不变", async () => {
    await saveWorkflowRecipe(bookRoot, draft(), { expectedRevision: 0 });
    await saveWorkflowRecipe(bookRoot, draft({ name: "改名" }), { expectedRevision: 1 });
    const before = await readFile(filePath(), "utf8");
    const error = await expectStoreError(saveWorkflowRecipe(bookRoot, draft({ name: "过期的修改" }), { expectedRevision: 1 }), "revision-conflict", 409);
    expect(error.explanation?.action).toContain("重新读取");
    expect(await readFile(filePath(), "utf8")).toBe(before);
  });

  it("结构有问题的方案可以存草稿，但不能发布", async () => {
    const broken = draft({ edges: [{ id: "e1", source: "start", target: "a", kind: "next" }] });
    const saved = await saveWorkflowRecipe(bookRoot, broken, { expectedRevision: 0 });
    expect(saved.status).toBe("draft");
    const error = await expectStoreError(
      saveWorkflowRecipe(bookRoot, { ...broken, status: "published" }, { expectedRevision: 1 }),
      "graph-invalid",
      400,
    );
    expect(error.explanation?.action).toContain("草稿");
  });

  it("删除要核对版本；最后一个方案不能删", async () => {
    await saveWorkflowRecipe(bookRoot, draft(), { expectedRevision: 0 });
    await expectStoreError(deleteWorkflowRecipe(bookRoot, "my-flow", { expectedRevision: 0 }), "revision-conflict", 409);
    await deleteWorkflowRecipe(bookRoot, "my-flow", { expectedRevision: 1 });
    expect((await readWorkflowRecipes(bookRoot)).some((recipe) => recipe.id === "my-flow")).toBe(false);

    await mkdir(join(bookRoot, "story"), { recursive: true });
    await writeFile(filePath(), JSON.stringify([draft({ status: "published", revision: 3 })]), "utf8");
    await expectStoreError(deleteWorkflowRecipe(bookRoot, "my-flow", { expectedRevision: 3 }), "last-recipe", 400);
  });
});
