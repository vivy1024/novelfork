import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer";

afterEach(() => {
  cleanup();
});

describe("MarkdownRenderer", () => {
  it("renders GFM tables", () => {
    const content = [
      "| Agent | Tokens |",
      "| --- | --- |",
      "| Writer | 1024 |",
      "| Editor | 512 |",
    ].join("\n");

    render(<MarkdownRenderer content={content} />);

    // Table header + body cells all present.
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Tokens")).toBeTruthy();
    expect(screen.getByText("Writer")).toBeTruthy();
    expect(screen.getByText("1024")).toBeTruthy();
  });

  it("renders GFM task lists as read-only checkboxes", () => {
    const content = [
      "- [x] 已完成的章节",
      "- [ ] 待写的章节",
    ].join("\n");

    const { container } = render(<MarkdownRenderer content={content} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');

    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
    // Both should be non-interactive.
    expect((checkboxes[0] as HTMLInputElement).readOnly).toBe(true);
  });

  it("renders GFM strikethrough", () => {
    render(<MarkdownRenderer content="这是 ~~废弃的~~ 一段话" />);
    const del = document.querySelector("del");
    expect(del?.textContent).toBe("废弃的");
  });

  it("renders fenced code blocks with language label", () => {
    const content = "```ts\nconst x: number = 42;\n```";
    render(<MarkdownRenderer content={content} />);
    // The CodeBlock toolbar shows the language label.
    expect(screen.getByText("ts")).toBeTruthy();
  });

  it("renders inline math via remark-math + rehype-katex", () => {
    render(<MarkdownRenderer content={"质能方程: $E = mc^2$"} />);
    // KaTeX emits a wrapper span with class `katex` containing the rendered math.
    const katexNode = document.querySelector(".katex");
    expect(katexNode).toBeTruthy();
    // The original TeX source should be preserved in an annotation element.
    const annotation = document.querySelector('annotation[encoding="application/x-tex"]');
    expect(annotation?.textContent).toContain("E = mc^2");
  });

  it("renders block math", () => {
    const content = "$$\n\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2}\n$$";
    render(<MarkdownRenderer content={content} />);
    // Block math gets the `katex-display` wrapper.
    const displayNode = document.querySelector(".katex-display");
    expect(displayNode).toBeTruthy();
  });
});
