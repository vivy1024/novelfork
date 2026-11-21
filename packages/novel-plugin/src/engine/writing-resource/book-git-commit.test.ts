import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { autoCommitBookChapter } from "./book-git-commit.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "TestAuthor",
    GIT_AUTHOR_EMAIL: "author@test.local",
    GIT_COMMITTER_NAME: "TestAuthor",
    GIT_COMMITTER_EMAIL: "author@test.local",
    GIT_TERMINAL_PROMPT: "0",
  };
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { env, windowsHide: true });
  return stdout.trim();
}

describe("autoCommitBookChapter（章节入库自动 Git Commit）", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-book-git-commit-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("独立书根 git 仓库在章节入库后自动提交并只暂存指定章节与索引，不打包无关文件", async () => {
    await git(root, ["init", "-b", "main"]);
    await mkdir(join(root, "chapters", "卷01"), { recursive: true });
    await writeFile(join(root, "book.json"), JSON.stringify({ id: "b1", title: "测试书" }), "utf8");
    await git(root, ["add", "book.json"]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "init book"]);

    await writeFile(join(root, "chapters", "卷01", "0001_雨夜.md"), "# 第1章 雨夜\n\n正文内容。", "utf8");
    await writeFile(join(root, "chapters", "index.json"), JSON.stringify([{ number: 1, title: "雨夜" }]), "utf8");
    await writeFile(join(root, "scratch.tmp"), "无关草稿不应被自动提交", "utf8");

    const res = await autoCommitBookChapter({
      bookRoot: root,
      chapterNumber: 1,
      title: "雨夜",
      wordCount: 3120,
      mode: "new",
      fromWorkflowRun: true,
      relativePaths: ["chapters/卷01/0001_雨夜.md", "chapters/index.json"],
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("committed");
    expect(res.commitSha).toBeTruthy();
    expect(res.commitMessage).toBe("feat(ch0001): 工作流入库第1章「雨夜」（3120字）");

    const committedFiles = await git(root, ["show", "--name-only", "--pretty=format:", "HEAD"]);
    expect(committedFiles).toContain("0001_");
    expect(committedFiles).toContain("chapters/index.json");
    expect(committedFiles).not.toContain("scratch.tmp");

    // 同一内容重复调用自动跳过，不产生空提交
    const second = await autoCommitBookChapter({
      bookRoot: root,
      chapterNumber: 1,
      title: "雨夜",
      wordCount: 3120,
      mode: "revision",
      relativePaths: ["chapters/卷01/0001_雨夜.md", "chapters/index.json"],
    });
    expect(second).toMatchObject({ ok: true, status: "skipped", reason: "no-changes" });
  });

  it("非 git 书根或嵌套在父仓库子目录时安全跳过，不向父仓库误提交", async () => {
    // 1. 纯普通目录
    const plain = await autoCommitBookChapter({
      bookRoot: root,
      chapterNumber: 1,
      title: "普通目录",
      mode: "new",
      relativePaths: ["chapters/index.json"],
    });
    expect(plain).toMatchObject({ ok: true, status: "skipped", reason: "not-a-dedicated-book-git-repo" });

    // 2. 父目录是 git 仓库、书根只是子目录
    await git(root, ["init", "-b", "main"]);
    const nestedBook = join(root, "sub-book");
    await mkdir(join(nestedBook, "chapters"), { recursive: true });
    await writeFile(join(nestedBook, "chapters", "index.json"), "[]", "utf8");

    const nested = await autoCommitBookChapter({
      bookRoot: nestedBook,
      chapterNumber: 1,
      title: "子目录",
      mode: "new",
      relativePaths: ["chapters/index.json"],
    });
    expect(nested).toMatchObject({ ok: true, status: "skipped", reason: "not-a-dedicated-book-git-repo" });
  });
});
