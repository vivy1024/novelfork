import { describe, expect, it } from "vitest";

describe("CLI command registry help", () => {
  it("prints runtime slash commands from the canonical command registry", async () => {
    const { createProgram } = await import("../index.js");
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Agent runtime commands");
    expect(help).toContain("/help");
    expect(help).toContain("/tools");
    expect(help).toContain("/novel:write-next");
    expect(help).toContain("planned");
  });
});
