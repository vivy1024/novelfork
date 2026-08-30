import { describe, expect, it } from "vitest";

import { generateABogus, rc4Encrypt, resultEncrypt } from "./fanqie-abogus.js";

describe("fanqie a_bogus", () => {
  it("encrypts RC4 with a known vector", () => {
    const cipher = rc4Encrypt(Buffer.from("hello", "utf8"), Buffer.from("key", "utf8"));
    expect(cipher.toString("hex")).toBe("630958814b");
  });

  it("encodes custom base64 with the s4 table", () => {
    expect(resultEncrypt(Buffer.from([0, 1, 2, 3, 4, 5]), "s4")).toHaveLength(8);
  });

  it("generates a deterministic a_bogus for fixed time and rng", () => {
    let n = 0;
    const random = () => {
      n += 1;
      return (n % 10) / 10;
    };
    const first = generateABogus("app_id=2503&limit=30", "Mozilla/5.0", { nowMs: 1_700_000_000_000, random });
    n = 0;
    const second = generateABogus("app_id=2503&limit=30", "Mozilla/5.0", { nowMs: 1_700_000_000_000, random });
    expect(first).toBe(second);
    expect(first.endsWith("=")).toBe(true);
    expect(first.length).toBeGreaterThan(20);
  });
});
