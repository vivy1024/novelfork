import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, isEncryptedSecret, SecretKeyFileError } from "./secret-box.js";
import { ensureIsolatedNovelforkHome } from "../../test-setup.js";

let homeDir = "";
let previousHome: string | undefined;

beforeEach(async () => {
  previousHome = process.env.NOVELFORK_HOME;
  homeDir = join(tmpdir(), `novelfork-secret-box-${crypto.randomUUID()}`);
  await mkdir(homeDir, { recursive: true });
  process.env.NOVELFORK_HOME = homeDir;
});

afterEach(async () => {
  // 还原而不是删除：删掉后同一进程里后续测试会回落到 ~/.novelfork（真实目录）。
  if (previousHome === undefined) delete process.env.NOVELFORK_HOME;
  else process.env.NOVELFORK_HOME = previousHome;
  await rm(homeDir, { recursive: true, force: true });
});

describe("secret-box (T-10)", () => {
  it("round-trips a secret and never stores the plaintext", async () => {
    const sealed = await encryptSecret("sk-real-key-123456");

    expect(isEncryptedSecret(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("sk-real-key-123456");
    expect(await decryptSecret(sealed)).toBe("sk-real-key-123456");
  });

  it("uses a fresh IV, so the same secret seals differently each time", async () => {
    const first = await encryptSecret("sk-same");
    const second = await encryptSecret("sk-same");

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  it("rejects a tampered ciphertext instead of returning garbage", async () => {
    const sealed = await encryptSecret("sk-tamper-me");
    const broken = { ...sealed, ct: Buffer.from("tampered-bytes").toString("base64") };

    await expect(decryptSecret(broken)).rejects.toThrow();
  });

  it("keeps the master key in NOVELFORK_HOME, not in the sealed value", async () => {
    await encryptSecret("sk-key-location");
    const keyFile = await readFile(join(homeDir, ".secret-key"));

    expect(keyFile.length).toBe(32);
  });

  it("reads a legacy plaintext value as-is so existing keys keep working", async () => {
    expect(isEncryptedSecret("sk-legacy-plain")).toBe(false);
    expect(await decryptSecret("sk-legacy-plain")).toBe("sk-legacy-plain");
  });

  it("still rejects a key file that is genuinely corrupt, not merely slow to be written", async () => {
    await writeFile(join(homeDir, ".secret-key"), Buffer.alloc(16, 1));

    await expect(encryptSecret("sk-corrupt-key")).rejects.toThrow(/长度不正确/);
  });

  it("explains a corrupt key file in three parts and never overwrites it with a fresh key", async () => {
    const keyPath = join(homeDir, ".secret-key");
    const corrupt = Buffer.alloc(16, 9);
    await writeFile(keyPath, corrupt);

    const error = await encryptSecret("sk-corrupt-key").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecretKeyFileError);
    const explained = error as SecretKeyFileError;
    expect(explained.code).toBe("SECRET_KEY_FILE_CORRUPT");
    expect(explained.explanation.whatHappened).toBeTruthy();
    expect(explained.explanation.whyItMatters).toBeTruthy();
    expect(explained.explanation.suggestedAction).toBeTruthy();
    // 静默生成新密钥会让所有旧密文永远解不开：文件必须原样保留，等人工处理。
    expect(Buffer.compare(await readFile(keyPath), corrupt)).toBe(0);
    await expect(decryptSecret({ enc: "v1", iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==", ct: "AAAA" })).rejects.toBeInstanceOf(SecretKeyFileError);
  });

  it("rejects a truncated authentication tag instead of accepting a 32-bit forgery window", async () => {
    const sealed = await encryptSecret("sk-short-tag");
    const shortTag = Buffer.from(sealed.tag, "base64").subarray(0, 4).toString("base64");

    await expect(decryptSecret({ ...sealed, tag: shortTag })).rejects.toThrow();
  });

  it("waits for a concurrent writer to finish instead of treating a half-written key as corrupt", async () => {
    const keyPath = join(homeDir, ".secret-key");
    await writeFile(keyPath, Buffer.alloc(0));
    const finish = new Promise<void>((resolve) => {
      setTimeout(() => {
        writeFile(keyPath, Buffer.alloc(32, 7)).catch(() => undefined).finally(resolve);
      }, 30);
    });

    const sealed = await encryptSecret("sk-race");
    await finish;

    expect(await decryptSecret(sealed)).toBe("sk-race");
  });
});

describe("novel-plugin test setup keeps secrets out of the real home (测试隔离)", () => {
  const fakeTempDir = () => join(tmpdir(), "novelfork-plugin-test-home-fake");

  it("sets NOVELFORK_HOME to a temp dir when the process did not set one", () => {
    const env: NodeJS.ProcessEnv = {};

    const chosen = ensureIsolatedNovelforkHome(env, fakeTempDir);

    expect(chosen).toBe(fakeTempDir());
    expect(env.NOVELFORK_HOME).toBe(fakeTempDir());
  });

  it("replaces a NOVELFORK_HOME that points outside the temp dir (likely the author's real data)", () => {
    const env: NodeJS.ProcessEnv = { NOVELFORK_HOME: join(homedir(), ".novelfork") };

    ensureIsolatedNovelforkHome(env, fakeTempDir);

    expect(env.NOVELFORK_HOME).toBe(fakeTempDir());
  });

  it("keeps a NOVELFORK_HOME that an isolated runner already placed inside the temp dir", () => {
    const isolated = join(tmpdir(), "nf-pkgtest-x", "novelfork-home");
    const env: NodeJS.ProcessEnv = { NOVELFORK_HOME: isolated };

    expect(ensureIsolatedNovelforkHome(env, fakeTempDir)).toBeNull();
    expect(env.NOVELFORK_HOME).toBe(isolated);
  });

  it("is in effect for this very test process", () => {
    // 本文件 beforeEach 会改写 NOVELFORK_HOME，这里核对的是 setup 留下、beforeEach 之前的值。
    const home = previousHome ?? "";
    const fromTemp = relative(resolve(tmpdir()), resolve(home));
    expect(home).not.toBe("");
    expect(fromTemp.startsWith("..")).toBe(false);
  });
});
