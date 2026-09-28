import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

// @ts-expect-error tailwind.config.js is authored as JavaScript in this package.
import baseConfig from "../tailwind.config.js";

/** 令牌色经 color-mix 接入 Tailwind 的 <alpha-value>，带透明度的写法（bg-primary/10）才能生成。 */
const mixed = (name: string, alpha = "var(--tw-bg-opacity, 1)") =>
  `color-mix(in srgb, var(--${name}) calc(${alpha} * 100%), transparent)`;

const requiredTokenClasses = [
  [".bg-primary", `background-color: ${mixed("primary")}`],
  [".text-primary", `color: ${mixed("primary", "var(--tw-text-opacity, 1)")}`],
  [".text-primary-foreground", `color: ${mixed("primary-foreground", "var(--tw-text-opacity, 1)")}`],
  [".bg-muted", `background-color: ${mixed("muted")}`],
  [".text-muted-foreground", `color: ${mixed("muted-foreground", "var(--tw-text-opacity, 1)")}`],
  [".border-border", `border-color: ${mixed("border", "var(--tw-border-opacity, 1)")}`],
  [".bg-card", `background-color: ${mixed("card")}`],
  [".bg-destructive", `background-color: ${mixed("destructive")}`],
  [".text-2xs", "font-size: var(--text-2xs)"],
  [".bg-primary\\/10", `background-color: ${mixed("primary", "0.1")}`],
  [".border-border\\/60", `border-color: ${mixed("border", "0.6")}`],
] as const;

const COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
] as const;

describe("tailwind theme tokens", () => {
  it("maps the required 2xs fontSize token into theme.extend.fontSize", () => {
    const fontSize = baseConfig.theme?.extend?.fontSize as Record<string, unknown> | undefined;
    expect(fontSize?.["2xs"]).toEqual(["var(--text-2xs)", { lineHeight: "var(--text-2xs--line-height)" }]);
  });
  it("maps the required Studio color tokens into theme.extend.colors", () => {
    const colors = baseConfig.theme?.extend?.colors as Record<string, unknown> | undefined;

    expect(colors).toMatchObject(
      Object.fromEntries(COLOR_TOKENS.map((name) => [name, mixed(name, "<alpha-value>")])),
    );
  });

  it("generates CSS utilities for required Studio color classes, including opacity variants", async () => {
    const result = await postcss([
      tailwindcss({
        ...baseConfig,
        content: [
          {
            raw: requiredTokenClasses.map(([className]) => className.slice(1).replace("\\", "")).join(" "),
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
