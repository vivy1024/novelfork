import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, badgeVariants } from "./badge";
import { Button, buttonVariants } from "./button";

describe("UI primitives visual variants", () => {
  it("keeps button variants visually distinct for primary, neutral, danger and link actions", () => {
    const defaultClasses = buttonVariants({ variant: "default" });
    const outlineClasses = buttonVariants({ variant: "outline" });
    const secondaryClasses = buttonVariants({ variant: "secondary" });
    const ghostClasses = buttonVariants({ variant: "ghost" });
    const destructiveClasses = buttonVariants({ variant: "destructive" });
    const linkClasses = buttonVariants({ variant: "link" });

    expect(defaultClasses).toContain("bg-primary");
    expect(defaultClasses).toContain("text-primary-foreground");
    expect(defaultClasses).toContain("hover:bg-primary/90");

    expect(outlineClasses).toContain("border-border");
    expect(outlineClasses).toContain("hover:bg-muted");

    expect(secondaryClasses).toContain("bg-secondary");
    expect(secondaryClasses).toContain("hover:bg-secondary/80");

    expect(ghostClasses).toContain("hover:bg-muted");
    expect(destructiveClasses).toContain("bg-destructive/10");
    expect(destructiveClasses).toContain("hover:bg-destructive/20");
    expect(linkClasses).toContain("hover:underline");

    expect(defaultClasses).not.toBe(outlineClasses);
    expect(defaultClasses).not.toBe(destructiveClasses);
    expect(secondaryClasses).not.toBe(ghostClasses);
  });

  it("keeps badge variants visually distinct for primary, neutral, danger and link states", () => {
    const defaultClasses = badgeVariants({ variant: "default" });
    const outlineClasses = badgeVariants({ variant: "outline" });
    const secondaryClasses = badgeVariants({ variant: "secondary" });
    const ghostClasses = badgeVariants({ variant: "ghost" });
    const destructiveClasses = badgeVariants({ variant: "destructive" });
    const linkClasses = badgeVariants({ variant: "link" });

    expect(defaultClasses).toContain("bg-primary");
    expect(defaultClasses).toContain("hover:bg-primary/80");

    expect(outlineClasses).toContain("border-border");
    expect(outlineClasses).toContain("hover:bg-muted");

    expect(secondaryClasses).toContain("bg-secondary");
    expect(secondaryClasses).toContain("hover:bg-secondary/80");

    expect(ghostClasses).toContain("hover:bg-muted");
    expect(destructiveClasses).toContain("text-destructive");
    expect(destructiveClasses).toContain("hover:bg-destructive/20");
    expect(linkClasses).toContain("hover:underline");

    expect(defaultClasses).not.toBe(outlineClasses);
    expect(defaultClasses).not.toBe(destructiveClasses);
    expect(secondaryClasses).not.toBe(ghostClasses);
  });

  it("preserves disabled button affordance in rendered output", () => {
    render(<Button disabled>保存</Button>);

    const button = screen.getByRole("button", { name: "保存" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.className).toContain("disabled:pointer-events-none");
    expect(button.className).toContain("disabled:opacity-50");
  });

  it("renders badge link state without promoting it to a primary fill", () => {
    render(<Badge variant="link">说明</Badge>);

    const badge = screen.getByText("说明");
    expect(badge.className).toContain("text-primary");
    expect(badge.className).toContain("hover:underline");
    expect(badge.className).not.toContain("bg-primary");
  });
});
