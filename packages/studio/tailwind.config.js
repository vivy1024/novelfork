/**
 * 设计令牌是完整的颜色值（DESIGN.md 生成的十六进制），Tailwind 3 没法直接给 var(--x) 叠透明度，
 * 以前 bg-primary/10、border-destructive/20 这类写法一律不生成样式。用 color-mix 接住 <alpha-value>，
 * 不带透明度时 <alpha-value> 为 1，结果与原色相同。
 */
const token = (name) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // novel-plugin owns Studio-rendered UI; core is backend/domain-only and its
    // regex/string literals must not be interpreted as Tailwind candidates.
    "../novel-plugin/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: token("card"),
        "card-foreground": token("card-foreground"),
        popover: token("popover"),
        "popover-foreground": token("popover-foreground"),
        primary: token("primary"),
        "primary-foreground": token("primary-foreground"),
        secondary: token("secondary"),
        "secondary-foreground": token("secondary-foreground"),
        muted: token("muted"),
        "muted-foreground": token("muted-foreground"),
        accent: token("accent"),
        "accent-foreground": token("accent-foreground"),
        destructive: token("destructive"),
        "destructive-foreground": token("destructive-foreground"),
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
      },
      fontSize: {
        "2xs": ["var(--text-2xs)", { lineHeight: "var(--text-2xs--line-height)" }],
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        DEFAULT: "var(--radius)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        "3d": "var(--shadow-3d)",
        "3d-hover": "var(--shadow-3d-hover)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
