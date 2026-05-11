import { describe, expect, it } from "vitest";

import {
  formatRuntimeCommandHelp,
  getRuntimeCommandDefinition,
  listRuntimeCommands,
} from "../registry/command-registry.js";

const REQUIRED_SLASH_COMMANDS = [
  "/help",
  "/status",
  "/model",
  "/permission",
  "/tools",
  "/mcp",
  "/agents",
  "/compact",
  "/resume",
  "/fork",
];

describe("runtime command registry", () => {
  it("defines the canonical Claude/Codex slash command set", () => {
    const commands = listRuntimeCommands();
    const ids = commands.map((command) => command.id);

    expect(ids).toEqual(expect.arrayContaining(REQUIRED_SLASH_COMMANDS));
    expect(commands.find((command) => command.id === "/help")).toMatchObject({
      source: "builtin",
      status: "current",
      scope: "session",
      runtimeHandler: "command.help",
    });
  });

  it("requires every command to expose routing metadata for Studio, Routines, CLI and headless", () => {
    for (const command of listRuntimeCommands()) {
      expect(command.id).toMatch(/^\//);
      expect(command.aliases).toEqual(expect.any(Array));
      expect(command.usage).toContain(command.id);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.scope).toMatch(/^(session|runtime|tooling|extension)$/);
      expect(command.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
      expect(command.permissionImpact).toEqual(expect.objectContaining({ mode: expect.any(String) }));
      expect(command.runtimeHandler).toEqual(expect.any(String));
      expect(command.status).toMatch(/^(current|partial|planned|unsupported|reference-only)$/);
      expect(command.source).toMatch(/^(builtin|claude-adapter|codex-adapter)$/);
    }
  });

  it("resolves command aliases and formats the same registry for CLI help", () => {
    expect(getRuntimeCommandDefinition("resume")).toMatchObject({ id: "/resume" });
    expect(getRuntimeCommandDefinition("/continue")).toMatchObject({ id: "/resume" });

    const help = formatRuntimeCommandHelp();
    expect(help).toContain("/help");
    expect(help).toContain("/tools");
    expect(help).toContain("planned");
  });
});
