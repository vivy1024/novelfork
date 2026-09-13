import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  NOVEL_BUILTIN_WORKFLOWS,
  readWorkflowRecipes,
  saveWorkflowRecipes,
  WorkflowStoreError,
} from "../engine/index.js";
import { createWorkflowsRouter } from "./workflows.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("createWorkflowsRouter & workflow-store", () => {
  it("未配置时 GET /api/books/:bookId/workflow-recipes 返回内置权威预设", async () => {
    const bookDir = await tempDir("novel-book-");
    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: () => bookDir,
    });

    const res = await router.request("/api/books/book-1/workflow-recipes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookId: string;
      recipes: typeof NOVEL_BUILTIN_WORKFLOWS;
    };
    expect(body.bookId).toBe("book-1");
    expect(body.recipes).toHaveLength(NOVEL_BUILTIN_WORKFLOWS.length);
    expect(body.recipes[0].id).toBe("fanqie-xuanhuan-serial");
  });

  it("PUT /api/books/:bookId/workflow-recipes 成功持久化到 story/workflow_recipes.json 并保留合法自定义字段", async () => {
    const bookDir = await tempDir("novel-book-");
    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: () => bookDir,
    });

    const customRecipes = [
      {
        id: "custom-suspense-recipe",
        name: "反转悬疑流",
        commandId: "/custom:suspense",
        description: "高密度伏笔与凶手视角推演",
        genre: "suspense",
        steps: [
          {
            id: "step-1",
            kind: "guided-plan",
            label: "不在场证明蓝图",
            enabled: true,
            executionMode: "autonomous",
            agentId: "my-custom-planner",
            modelOverride: "claude-3-7-sonnet",
            customPrompt: "严格按照三重视角切换",
            tools: ["scene.spec", "lore.read"],
            skills: ["plot-twist-v1"],
            parallelSubagents: [
              {
                name: "detective-subagent",
                roleLabel: "侦探视角",
                model: "gpt-4o",
                tools: ["lore.read"],
                prompt: "从侦探角度寻找破绽",
              },
            ],
            requiresApproval: false,
            onFailure: "stop",
          },
        ],
        resultStrategy: "formal-chapter",
        requireFinalApproval: true,
        maxRetries: 2,
      },
    ];

    const putRes = await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipes: customRecipes }),
    });
    expect(putRes.status).toBe(200);

    // 检查磁盘文件
    const rawFile = await readFile(
      join(bookDir, "story", "workflow_recipes.json"),
      "utf8",
    );
    expect(rawFile).toContain("custom-suspense-recipe");
    expect(rawFile).toContain("my-custom-planner");
    expect(rawFile).toContain("detective-subagent");

    // 再次 GET 确认读出的是新落盘的内容
    const getRes = await router.request("/api/books/book-1/workflow-recipes");
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { recipes: typeof customRecipes };
    expect(body.recipes).toHaveLength(1);
    expect(body.recipes[0].name).toBe("反转悬疑流");
    expect(body.recipes[0].steps[0].agentId).toBe("my-custom-planner");
    expect(body.recipes[0].steps[0].parallelSubagents?.[0].name).toBe("detective-subagent");
  });

  it("PUT 传入非法数据时返回 400 详细校验错误", async () => {
    const bookDir = await tempDir("novel-book-");
    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: () => bookDir,
    });

    // 1. 空数组
    const resEmpty = await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipes: [] }),
    });
    expect(resEmpty.status).toBe(400);
    const bodyEmpty = (await resEmpty.json()) as { code: string };
    expect(bodyEmpty.code).toBe("EMPTY_RECIPES");

    // 2. 无效的 step kind
    const resInvalidKind = await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipes: [
          {
            id: "bad-recipe",
            name: "错误",
            commandId: "/bad",
            description: "",
            steps: [{ id: "s1", kind: "non-existent-kind", label: "label", enabled: true }],
            resultStrategy: "formal-chapter",
            requireFinalApproval: true,
            maxRetries: 1,
          },
        ],
      }),
    });
    expect(resInvalidKind.status).toBe(400);

    // 3. 重复 step id
    const resDupStep = await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipes: [
          {
            id: "dup-step-recipe",
            name: "重复",
            commandId: "/dup",
            description: "",
            steps: [
              { id: "step-1", kind: "context-load", label: "A", enabled: true },
              { id: "step-1", kind: "guided-plan", label: "B", enabled: true },
            ],
            resultStrategy: "formal-chapter",
            requireFinalApproval: true,
            maxRetries: 1,
          },
        ],
      }),
    });
    expect(resDupStep.status).toBe(400);

    // 4. 非法 resultStrategy
    const resBadStrategy = await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipes: [
          {
            id: "bad-strategy",
            name: "策略错误",
            commandId: "/strat",
            description: "",
            steps: [{ id: "s1", kind: "context-load", label: "A", enabled: true }],
            resultStrategy: "unknown-strategy",
            requireFinalApproval: true,
            maxRetries: 1,
          },
        ],
      }),
    });
    expect(resBadStrategy.status).toBe(400);
  });

  it("文件损坏或为空时 readWorkflowRecipes 必须报错，绝不静默覆盖真实数据", async () => {
    const bookDir = await tempDir("novel-book-");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    const targetFile = join(storyDir, "workflow_recipes.json");

    // 1. 语法错误 JSON
    await writeFile(targetFile, "{ bad json content", "utf8");
    await expect(readWorkflowRecipes(bookDir)).rejects.toThrow(WorkflowStoreError);

    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: () => bookDir,
    });
    const getResCorrupted = await router.request("/api/books/book-1/workflow-recipes");
    expect(getResCorrupted.status).toBe(400);
    const errBody = (await getResCorrupted.json()) as { code: string };
    expect(errBody.code).toBe("CORRUPTED_WORKFLOW_FILE");

    // 2. 空文件
    await writeFile(targetFile, "   \n\t", "utf8");
    await expect(readWorkflowRecipes(bookDir)).rejects.toThrow(WorkflowStoreError);

    // 3. 结构损毁（数组内对象缺失必要属性）
    await writeFile(targetFile, JSON.stringify([{ bad: 123 }]), "utf8");
    await expect(readWorkflowRecipes(bookDir)).rejects.toThrow(WorkflowStoreError);
  });

  it("原子写入保证：写入过程中旧文件不受损", async () => {
    const bookDir = await tempDir("novel-book-");
    const initialRecipes = [
      {
        id: "initial-recipe",
        name: "初版",
        commandId: "/init",
        description: "初版描述",
        genre: "general",
        steps: [{ id: "s1", kind: "context-load" as const, label: "load", enabled: true }],
        resultStrategy: "formal-chapter" as const,
        requireFinalApproval: false,
        maxRetries: 0,
      },
    ];

    await saveWorkflowRecipes(bookDir, initialRecipes);
    const readBack1 = await readWorkflowRecipes(bookDir);
    expect(readBack1[0].id).toBe("initial-recipe");

    // 尝试保存非法配置（校验在写临时文件前阻断，或者写临时文件校验阻断），原文件绝不被改写
    const badRecipes = [
      {
        id: "bad",
        name: "", // 非法空名称
        commandId: "/bad",
        description: "",
        steps: [],
        resultStrategy: "formal-chapter",
        requireFinalApproval: false,
        maxRetries: 0,
      },
    ];

    await expect(
      saveWorkflowRecipes(bookDir, badRecipes as never),
    ).rejects.toThrow(WorkflowStoreError);

    // 原文件内容完好无损
    const readBack2 = await readWorkflowRecipes(bookDir);
    expect(readBack2).toHaveLength(1);
    expect(readBack2[0].id).toBe("initial-recipe");
  });

  it("不同书籍目录完全隔离，互不干扰", async () => {
    const book1Dir = await tempDir("novel-book-1-");
    const book2Dir = await tempDir("novel-book-2-");

    const bookRoots: Record<string, string> = {
      "book-1": book1Dir,
      "book-2": book2Dir,
    };

    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: (bookId) => bookRoots[bookId] ?? "/dev/null",
    });

    const book1Recipe = [
      {
        id: "b1-recipe",
        name: "书籍1流",
        commandId: "/b1",
        description: "b1",
        genre: "xuanhuan",
        steps: [{ id: "s1", kind: "context-load", label: "load", enabled: true }],
        resultStrategy: "formal-chapter",
        requireFinalApproval: false,
        maxRetries: 1,
      },
    ];

    await router.request("/api/books/book-1/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipes: book1Recipe }),
    });

    // 书籍 2 尚未配置，应该返回默认内置流
    const res2 = await router.request("/api/books/book-2/workflow-recipes");
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { recipes: typeof NOVEL_BUILTIN_WORKFLOWS };
    expect(body2.recipes[0].id).toBe("fanqie-xuanhuan-serial");

    // 书籍 1 返回自己专属保存的流
    const res1 = await router.request("/api/books/book-1/workflow-recipes");
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { recipes: typeof book1Recipe };
    expect(body1.recipes[0].id).toBe("b1-recipe");
  });

  it("拒绝包含路径穿越的非法 bookId", async () => {
    const router = createWorkflowsRouter({} as never, {
      resolveBookRoot: (bookId) => `/tmp/test/${bookId}`,
    });

    const getBad = await router.request("/api/books/..%2F..%2Fetc/workflow-recipes");
    expect(getBad.status).toBe(400);

    const putBad = await router.request("/api/books/..%2F..%2Fetc/workflow-recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipes: [] }),
    });
    expect(putBad.status).toBe(400);
  });
});

