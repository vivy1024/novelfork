import { describe, expect, it } from "vitest";

// @ts-expect-error tailwind.config.js is authored as JavaScript in this package.
import baseConfig from "../tailwind.config.js";

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
});
