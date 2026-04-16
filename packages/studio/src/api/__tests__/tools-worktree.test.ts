/**
 * 工具和 Worktree 集成测试
 * 测试所有核心工具和 Worktree 系统的完整流程
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolExecutor } from "../lib/tool-executor";
import { PermissionManager } from "../lib/permission-manager";
import {
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  EnterWorktreeTool,
  ExitWorktreeTool,
} from "../lib/tools";
import {
  TEST_WORKSPACE,
  createTestFile,
  readTestFile,
  fileExists,
  mockGitCommands,
} from "./setup";
import * as path from "node:path";

describe("Tool System Integration", () => {
  let executor: ToolExecutor;
  let permissionManager: PermissionManager;

  beforeEach(() => {
    executor = new ToolExecutor();
    permissionManager = new PermissionManager();

    // 注册所有工具
    executor.register(ReadTool);
    executor.register(WriteTool);
    executor.register(EditTool);
    executor.register(GlobTool);
    executor.register(GrepTool);
    executor.register(BashTool);
    executor.register(EnterWorktreeTool);
    executor.register(ExitWorktreeTool);
  });

  describe("ToolExecutor", () => {
    it("should register tools", () => {
      const tools = executor.listTools();
      expect(tools).toHaveLength(8);
      expect(tools.map((t) => t.name)).toContain("Read");
      expect(tools.map((t) => t.name)).toContain("Write");
    });

    it("should get tool by name", () => {
      const tool = executor.getTool("Read");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("Read");
    });

    it("should reject duplicate tool registration", () => {
      expect(() => executor.register(ReadTool)).toThrow("already registered");
    });

    it("should validate required parameters", async () => {
      const result = await executor.execute(
        "Read",
        {}, // 缺少 file_path
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("required parameter");
    });

    it("should validate parameter types", async () => {
      const result = await executor.execute(
        "Read",
        { file_path: 123 }, // 错误类型
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be of type string");
    });

    it("should apply default parameters", async () => {
      await createTestFile("test.txt", "Line 1\nLine 2\nLine 3");

      const result = await executor.execute(
        "Read",
        { file_path: "test.txt" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.limit).toBe(2000); // 默认值
    });

    it("should handle tool not found", async () => {
      const result = await executor.execute(
        "NonExistentTool",
        {},
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("PermissionManager", () => {
    beforeEach(() => {
      permissionManager.clearRules();
    });

    it("should add and get rules", () => {
      permissionManager.addRule({
        toolName: "Write",
        action: "allow",
      });

      const rules = permissionManager.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].toolName).toBe("Write");
    });

    it("should match tool name", () => {
      permissionManager.addRule({
        toolName: "Read",
        action: "allow",
      });

      const action = permissionManager.checkPermission("Read", {});
      expect(action).toBe("allow");
    });

    it("should match wildcard", () => {
      permissionManager.addRule({
        toolName: "*",
        action: "deny",
      });

      const action = permissionManager.checkPermission("AnyTool", {});
      expect(action).toBe("deny");
    });

    it("should match parameter pattern", () => {
      permissionManager.addRule({
        toolName: "Bash",
        pattern: "rm.*-rf",
        action: "deny",
      });

      const action = permissionManager.checkPermission("Bash", {
        command: "rm -rf /tmp",
      });
      expect(action).toBe("deny");
    });

    it("should return prompt for no matching rule", () => {
      const action = permissionManager.checkPermission("Write", {});
      expect(action).toBe("prompt");
    });

    it("should handle permission request approval", async () => {
      permissionManager.addRule({
        toolName: "Write",
        action: "prompt",
      });

      const requestPromise = permissionManager.requestPermission("Write", {
        file_path: "test.txt",
      });

      // 模拟用户批准
      setTimeout(() => {
        const pending = permissionManager.getPendingRequests();
        expect(pending).toHaveLength(1);
        permissionManager.approve(pending[0].id, "User approved");
      }, 10);

      const result = await requestPromise;
      expect(result.approved).toBe(true);
      expect(result.reason).toBe("User approved");
    });

    it("should handle permission request denial", async () => {
      permissionManager.addRule({
        toolName: "Write",
        action: "prompt",
      });

      const requestPromise = permissionManager.requestPermission("Write", {
        file_path: "test.txt",
      });

      // 模拟用户拒绝
      setTimeout(() => {
        const pending = permissionManager.getPendingRequests();
        permissionManager.deny(pending[0].id, "User denied");
      }, 10);

      const result = await requestPromise;
      expect(result.approved).toBe(false);
      expect(result.reason).toBe("User denied");
    });
  });

  describe("ReadTool", () => {
    it("should read file content", async () => {
      await createTestFile("test.txt", "Hello World");

      const result = await executor.execute(
        "Read",
        { file_path: "test.txt" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain("Hello World");
    });

    it("should read file with line range", async () => {
      await createTestFile("lines.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const result = await executor.execute(
        "Read",
        { file_path: "lines.txt", offset: 1, limit: 2 },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain("Line 2");
      expect(result.data).toContain("Line 3");
      expect(result.data).not.toContain("Line 1");
    });

    it("should handle non-existent file", async () => {
      const result = await executor.execute(
        "Read",
        { file_path: "nonexistent.txt" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("WriteTool", () => {
    it("should create new file", async () => {
      const result = await executor.execute(
        "Write",
        {
          file_path: "new.txt",
          content: "New content",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const content = await readTestFile("new.txt");
      expect(content).toBe("New content");
    });

    it("should overwrite existing file", async () => {
      await createTestFile("existing.txt", "Old content");

      const result = await executor.execute(
        "Write",
        {
          file_path: "existing.txt",
          content: "New content",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const content = await readTestFile("existing.txt");
      expect(content).toBe("New content");
    });

    it("should create nested directories", async () => {
      const result = await executor.execute(
        "Write",
        {
          file_path: "nested/dir/file.txt",
          content: "Nested content",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const exists = await fileExists("nested/dir/file.txt");
      expect(exists).toBe(true);
    });
  });

  describe("EditTool", () => {
    it("should replace string in file", async () => {
      await createTestFile("edit.txt", "Hello World");

      const result = await executor.execute(
        "Edit",
        {
          file_path: "edit.txt",
          old_string: "World",
          new_string: "Universe",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const content = await readTestFile("edit.txt");
      expect(content).toBe("Hello Universe");
    });

    it("should replace all occurrences", async () => {
      await createTestFile("edit-all.txt", "foo bar foo baz foo");

      const result = await executor.execute(
        "Edit",
        {
          file_path: "edit-all.txt",
          old_string: "foo",
          new_string: "qux",
          replace_all: true,
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const content = await readTestFile("edit-all.txt");
      expect(content).toBe("qux bar qux baz qux");
    });

    it("should fail if old_string not found", async () => {
      await createTestFile("edit-fail.txt", "Hello World");

      const result = await executor.execute(
        "Edit",
        {
          file_path: "edit-fail.txt",
          old_string: "NotFound",
          new_string: "Replacement",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should replace only first occurrence without replace_all", async () => {
      await createTestFile("edit-ambiguous.txt", "foo bar foo");

      const result = await executor.execute(
        "Edit",
        {
          file_path: "edit-ambiguous.txt",
          old_string: "foo",
          new_string: "qux",
          replace_all: false,
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.replacements).toBe(1);
    });
  });

  describe("GlobTool", () => {
    beforeEach(async () => {
      await createTestFile("file1.txt", "");
      await createTestFile("file2.js", "");
      await createTestFile("src/index.ts", "");
      await createTestFile("src/utils.ts", "");
      await createTestFile("node_modules/package/index.js", "");
    });

    it("should match all files", async () => {
      const result = await executor.execute(
        "Glob",
        { pattern: "**/*" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const files = result.data as string[];
      expect(files.length).toBeGreaterThan(0);
    });

    it("should match specific extension", async () => {
      const result = await executor.execute(
        "Glob",
        { pattern: "**/*.ts" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const files = result.data as string[];
      expect(files.every((f) => f.endsWith(".ts"))).toBe(true);
    });

    it("should ignore node_modules by default", async () => {
      const result = await executor.execute(
        "Glob",
        { pattern: "**/*.js" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const files = result.data as string[];
      expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
    });
  });

  describe("GrepTool", () => {
    beforeEach(async () => {
      await createTestFile("grep1.txt", "Hello World\nFoo Bar\nHello Universe");
      await createTestFile("grep2.txt", "Test Content\nHello Again");
    });

    it("should search for pattern", async () => {
      const result = await executor.execute(
        "Grep",
        {
          pattern: "Hello",
          output_mode: "content",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      const matches = result.data as Array<{ file: string; line: number; content: string }>;
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.content.includes("Hello"))).toBe(true);
    });

    it("should return files with matches", async () => {
      const result = await executor.execute(
        "Grep",
        {
          pattern: "Hello",
          output_mode: "files_with_matches",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      const files = result.data as string[];
      expect(files.length).toBe(2);
    });

    it("should count matches", async () => {
      const result = await executor.execute(
        "Grep",
        {
          pattern: "Hello",
          output_mode: "count",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("totalMatches");
      expect((result.data as any).totalMatches).toBe(3); // 3 matches total
    });

    it("should filter by glob pattern", async () => {
      await createTestFile("code.ts", "const hello = 'world';");
      await createTestFile("doc.txt", "hello world");

      const result = await executor.execute(
        "Grep",
        {
          pattern: "hello",
          glob: "**/*.ts",
          output_mode: "files_with_matches",
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(),
        }
      );

      expect(result.success).toBe(true);
      const files = result.data as string[];
      expect(files.some(f => f.includes("code.ts"))).toBe(true);
      expect(files.some(f => f.includes("doc.txt"))).toBe(false);
    });
  });

  describe("BashTool", () => {
    it("should execute safe command", async () => {
      const result = await executor.execute(
        "Bash",
        { command: "echo 'test'" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["bash"]),
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("stdout");
      expect((result.data as any).stdout).toContain("test");
    });

    it("should block dangerous command", async () => {
      const result = await executor.execute(
        "Bash",
        { command: "rm -rf /" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["bash"]),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Dangerous command blocked");
    });

    it("should require bash permission", async () => {
      const result = await executor.execute(
        "Bash",
        { command: "echo 'test'" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(), // 没有 bash 权限
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
    });

    it("should handle command failure", async () => {
      const result = await executor.execute(
        "Bash",
        { command: "exit 1" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["bash"]),
        }
      );

      expect(result.success).toBe(false);
      expect(result.data).toHaveProperty("exitCode", 1);
    });

    it("should respect timeout", async () => {
      const result = await executor.execute(
        "Bash",
        {
          command: "sleep 10",
          timeout: 100, // 100ms timeout
        },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["bash"]),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    }, 10000);
  });

  describe("EnterWorktreeTool", () => {
    it("should fail if not in git repository", async () => {
      const result = await executor.execute(
        "EnterWorktree",
        { name: "feature-test" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["worktree"]),
        }
      );

      // 测试工作区不是 Git 仓库，应该失败
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("ExitWorktreeTool", () => {
    it("should fail if not in worktree session", async () => {
      const result = await executor.execute(
        "ExitWorktree",
        { action: "keep" },
        {
          workspaceRoot: TEST_WORKSPACE,
          userId: "test-user",
          sessionId: "test-session",
          permissions: new Set(["worktree"]),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No active worktree session");
    });
  });
});

describe("Git Utils (Unit Tests)", () => {
  describe("Validation Functions", () => {
    it("should validate branch names", async () => {
      const { isValidBranchName } = await import("../lib/git-utils");

      expect(isValidBranchName("main")).toBe(true);
      expect(isValidBranchName("feature/test")).toBe(true);
      expect(isValidBranchName("fix-123")).toBe(true);
      expect(isValidBranchName("v1.0.0")).toBe(true);

      expect(isValidBranchName(".hidden")).toBe(false); // 以点开头
      expect(isValidBranchName("branch..name")).toBe(false); // 连续点
      expect(isValidBranchName("branch/")).toBe(false); // 以斜杠结尾
    });

    it("should convert Windows paths to Git paths", async () => {
      const { toGitPath } = await import("../lib/git-utils");

      expect(toGitPath("C:\\Users\\test\\file.txt")).toBe("C:/Users/test/file.txt");
      expect(toGitPath("path\\to\\file")).toBe("path/to/file");
    });
  });
});

describe("Integration Scenarios", () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.register(ReadTool);
    executor.register(WriteTool);
    executor.register(EditTool);
    executor.register(GlobTool);
    executor.register(GrepTool);
  });

  it("should complete full file editing workflow", async () => {
    const context = {
      workspaceRoot: TEST_WORKSPACE,
      userId: "test-user",
      sessionId: "test-session",
      permissions: new Set(),
    };

    // 1. 创建文件
    const writeResult = await executor.execute(
      "Write",
      {
        file_path: "workflow.txt",
        content: "Original content\nLine 2\nLine 3",
      },
      context
    );
    expect(writeResult.success).toBe(true);

    // 2. 读取文件
    const readResult = await executor.execute(
      "Read",
      { file_path: "workflow.txt" },
      context
    );
    expect(readResult.success).toBe(true);
    expect(readResult.data).toContain("Original content");

    // 3. 编辑文件
    const editResult = await executor.execute(
      "Edit",
      {
        file_path: "workflow.txt",
        old_string: "Original content",
        new_string: "Modified content",
      },
      context
    );
    expect(editResult.success).toBe(true);

    // 4. 验证修改
    const verifyResult = await executor.execute(
      "Read",
      { file_path: "workflow.txt" },
      context
    );
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.data).toContain("Modified content");
    expect(verifyResult.data).not.toContain("Original content");
  });

  it("should search and replace across multiple files", async () => {
    const context = {
      workspaceRoot: TEST_WORKSPACE,
      userId: "test-user",
      sessionId: "test-session",
      permissions: new Set(),
    };

    // 1. 创建多个文件
    await executor.execute(
      "Write",
      { file_path: "file1.txt", content: "TODO: implement feature" },
      context
    );
    await executor.execute(
      "Write",
      { file_path: "file2.txt", content: "TODO: fix bug" },
      context
    );
    await executor.execute(
      "Write",
      { file_path: "file3.txt", content: "DONE: completed task" },
      context
    );

    // 2. 搜索包含 TODO 的文件
    const grepResult = await executor.execute(
      "Grep",
      {
        pattern: "TODO",
        output_mode: "files_with_matches",
      },
      context
    );
    expect(grepResult.success).toBe(true);
    const files = grepResult.data as string[];
    expect(files.length).toBe(2);

    // 3. 替换所有 TODO 为 IN_PROGRESS
    for (const file of files) {
      const editResult = await executor.execute(
        "Edit",
        {
          file_path: file,
          old_string: "TODO",
          new_string: "IN_PROGRESS",
        },
        context
      );
      expect(editResult.success).toBe(true);
    }

    // 4. 验证替换结果
    const verifyResult = await executor.execute(
      "Grep",
      {
        pattern: "TODO",
        output_mode: "count",
      },
      context
    );
    expect(verifyResult.success).toBe(true);
    expect((verifyResult.data as any).totalMatches).toBe(0); // 没有 TODO 了
  });

  it("should handle error recovery", async () => {
    const context = {
      workspaceRoot: TEST_WORKSPACE,
      userId: "test-user",
      sessionId: "test-session",
      permissions: new Set(),
    };

    // 1. 尝试读取不存在的文件
    const readResult = await executor.execute(
      "Read",
      { file_path: "nonexistent.txt" },
      context
    );
    expect(readResult.success).toBe(false);

    // 2. 创建文件
    const writeResult = await executor.execute(
      "Write",
      { file_path: "nonexistent.txt", content: "Now it exists" },
      context
    );
    expect(writeResult.success).toBe(true);

    // 3. 再次读取，应该成功
    const retryResult = await executor.execute(
      "Read",
      { file_path: "nonexistent.txt" },
      context
    );
    expect(retryResult.success).toBe(true);
    expect(retryResult.data).toContain("Now it exists");
  });
});
