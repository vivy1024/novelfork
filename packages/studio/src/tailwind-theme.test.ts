import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

// @ts-expect-error tailwind.config.js is authored as JavaScript in this package.
import baseConfig from "../tailwind.config.js";

const requiredTokenClasses = [
  [".bg-primary", "background-color: var(--primary)"],
  [".text-primary", "color: var(--primary)"],
  [".text-primary-foreground", "color: var(--primary-foreground)"],
  [".bg-muted", "background-color: var(--muted)"],
  [".text-muted-foreground", "color: var(--muted-foreground)"],
  [".border-border", "border-color: var(--border)"],
  [".bg-card", "background-color: var(--card)"],
  [".bg-destructive", "background-color: var(--destructive)"],
] as const;

describe("tailwind theme tokens", () => {
  it("maps the required Studio color tokens into theme.extend.colors", () => {
    const colors = baseConfig.theme?.extend?.colors as Record<string, unknown> | undefined;

    expect(colors).toMatchObject({
      background: "var(--background)",
      foreground: "var(--foreground)",
      card: "var(--card)",
      "card-foreground": "var(--card-foreground)",
      popover: "var(--popover)",
      "popover-foreground": "var(--popover-foreground)",
      primary: "var(--primary)",
      "primary-foreground": "var(--primary-foreground)",
      secondary: "var(--secondary)",
      "secondary-foreground": "var(--secondary-foreground)",
      muted: "var(--muted)",
      "muted-foreground": "var(--muted-foreground)",
      accent: "var(--accent)",
      "accent-foreground": "var(--accent-foreground)",
      destructive: "var(--destructive)",
      "destructive-foreground": "var(--destructive-foreground)",
      border: "var(--border)",
      input: "var(--input)",
      ring: "var(--ring)",
    });
  });

  it("generates CSS utilities for required Studio color classes", async () => {
    const result = await postcss([
      tailwindcss({
        ...baseConfig,
        content: [
          {
            raw: requiredTokenClasses.map(([className]) => className.slice(1)).join(" "),
            extension: "html",
          },
        ],
      }),
    ]).process("@tailwind utilities;", { from: undefined });

    const css = result.css.replace(/\s+/g, " ");

    for (const [selector, declaration] of requiredTokenClasses) {
      expect(css).toContain(selector);
      expect(css).toContain(declaration);
    }
  });
});
