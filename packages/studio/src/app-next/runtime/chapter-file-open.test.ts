import { describe, expect, it } from "vitest";

import { chapterNumberFromRuntimeFilePath } from "./chapter-file-open";

const root = "C:\\Users\\writer\\books\\青云剑录-f3b5c624";

describe("chapterNumberFromRuntimeFilePath", () => {
  it("认出书籍根下 chapters/ 里的章节文件（绝对路径，Windows 大小写不敏感）", () => {
    expect(chapterNumberFromRuntimeFilePath(`${root}\\chapters\\卷01\\0012_夜雪.md`, root)).toBe(12);
    expect(chapterNumberFromRuntimeFilePath("c:/users/WRITER/books/青云剑录-f3b5c624/chapters/0003-开端.md", root)).toBe(3);
  });

  it("认出相对叙述者工作目录的章节路径", () => {
    expect(chapterNumberFromRuntimeFilePath("chapters/卷02/0101_山门.md", root)).toBe(101);
    expect(chapterNumberFromRuntimeFilePath("./chapters/0001_开端.md", root)).toBe(1);
  });

  it("其它文件、别的书、越界路径都不接管", () => {
    expect(chapterNumberFromRuntimeFilePath(`${root}\\story\\world.md`, root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath(`${root}\\chapters\\index.json`, root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath(`${root}\\chapters\\草稿.md`, root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath("C:\\Users\\writer\\books\\长夜余烬\\chapters\\0001_开端.md", root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath(`${root}-copy\\chapters\\0001_开端.md`, root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath("chapters/../story/0001_x.md", root)).toBeNull();
    expect(chapterNumberFromRuntimeFilePath(`${root}\\chapters\\0001_开端.md`, null)).toBeNull();
  });
});
