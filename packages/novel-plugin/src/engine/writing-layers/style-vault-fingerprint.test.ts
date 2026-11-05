import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeStyleGuide, type StylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, updateStyleFingerprint } from "./style-preset-store.js";
import {
  FINGERPRINT_REFRESH_MIN_NEW_CHARS,
  FINGERPRINT_REFRESH_MIN_NEW_SAMPLES,
  fingerprintRefreshStatus,
  readVaultBasis,
} from "./style-vault-fingerprint.js";
import {
  adoptRevisionSamples,
  AUTHOR_REVISION_SOURCE_ID,
  readVaultFingerprintStatus,
  refreshFingerprintFromVault,
  revisionSampleId,
} from "./style-vault.js";

const manualFingerprint = { avgSentenceLength: 40, sentenceLengthStdDev: 3, vocabularyDiversity: 0.5, dialogueRatio: 0.1 };

function revision(n: number) {
  return {
    chapterNumber: 10 + n,
    authorText: `第${n}段：她没回头。“走吧。”风把门撞上，屋里只剩钟声，一下，又一下。`,
    aiText: `第${n}段：她缓缓回头，轻轻说走吧。`,
  };
}

function range(count: number, from = 1) {
  return Array.from({ length: count }, (_, index) => revision(index + from));
}

describe("fingerprintRefreshStatus", () => {
  const sample = (id: string, text: string) => ({ id, sceneType: "general" as const, text, evidence: "e", transfer: "transferable" as const, status: "confirmed" as const });

  it("字数先到阈值也算到期；未确认或作品专属的范文不计数", () => {
    const long = sample("a", "长".repeat(FINGERPRINT_REFRESH_MIN_NEW_CHARS));
    expect(fingerprintRefreshStatus(null, [long])).toMatchObject({ basis: "none", pendingSamples: 1, due: true, remainingSamples: 0 });
    const ignored = [{ ...sample("b", "x"), status: "needs-review" as const }, { ...sample("c", "y"), transfer: "source-only" as const }];
    expect(fingerprintRefreshStatus(null, ignored)).toMatchObject({ pendingSamples: 0, due: false });
  });

  it("有指纹但没记来历时不把已有范文算作新增", () => {
    expect(fingerprintRefreshStatus(manualFingerprint, range(9).map((item, index) => sample(String(index), item.authorText))))
      .toMatchObject({ basis: "external", pendingSamples: 0, due: false });
  });
});

describe("文风金库自动重算统计指纹", () => {
  let bookRoot: string;
  beforeEach(async () => {
    bookRoot = join(tmpdir(), `novelfork-style-vault-fp-${crypto.randomUUID()}`);
    await mkdir(bookRoot, { recursive: true });
  });
  afterEach(async () => { await rm(bookRoot, { recursive: true, force: true }); });

  /** 作者已写好指南、来源规则与硬约束，并手动提取过统计基线。 */
  async function seedAuthorPreset() {
    const preset: StylePreset = {
      schemaVersion: 1,
      name: "本书文风",
      generalRules: ["动作先于情绪"],
      sources: [{ id: "ref", title: "参考作品", rules: [{ text: "短句收尾", evidence: "样文第一章", transfer: "transferable", status: "confirmed" }], samples: [] }],
      bookVoice: { tone: "冷", narrativeVoice: "贴近主角", principles: ["不解释情绪"] },
      customConstraints: ["不用“缓缓”"],
      fingerprint: null,
    };
    await saveStylePreset(bookRoot, preset, null);
    return updateStyleFingerprint(bookRoot, manualFingerprint);
  }

  async function adoptOneByOne(count: number, from = 1) {
    let current = await loadStylePreset(bookRoot);
    const outcomes: string[] = [];
    for (const item of range(count, from)) {
      const result = await adoptRevisionSamples(bookRoot, [item], current.revision);
      outcomes.push(result.fingerprintRefresh.outcome);
      current = result;
    }
    return { current, outcomes };
  }

  it("未到阈值不重算：手动提取的指纹原样保留，并报告还差几段", async () => {
    await seedAuthorPreset();
    const { outcomes } = await adoptOneByOne(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - 1);
    expect(outcomes.every((outcome) => outcome === "pending")).toBe(true);

    const stored = (await loadStylePreset(bookRoot)).preset!;
    expect(stored.fingerprint).toMatchObject(manualFingerprint);
    expect(readVaultBasis(stored.fingerprint)?.kind).toBe("external");
    expect(await readVaultFingerprintStatus(bookRoot)).toMatchObject({
      basis: "external", pendingSamples: FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - 1, remainingSamples: 1, due: false,
    });
  });

  it("到阈值重算且只动指纹：指南、范文、来源规则与硬约束不变", async () => {
    await seedAuthorPreset();
    await adoptOneByOne(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - 1);
    const before = await loadStylePreset(bookRoot);
    const last = revision(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES);
    const result = await adoptRevisionSamples(bookRoot, [last], before.revision);
    expect(result.fingerprintRefresh).toMatchObject({
      outcome: "refreshed",
      status: { basis: "author-revisions", includedSamples: FINGERPRINT_REFRESH_MIN_NEW_SAMPLES, pendingSamples: 0 },
    });

    const after = await loadStylePreset(bookRoot);
    expect(after.revision).toBe(result.revision);
    const fingerprint = after.preset!.fingerprint!;
    expect(fingerprint.avgSentenceLength).not.toBe(manualFingerprint.avgSentenceLength);
    expect(fingerprint).toHaveProperty("sampleCharCount");
    expect(readVaultBasis(fingerprint)?.sampleIds).toHaveLength(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES);

    // 除了本次采纳的那一段范文，指纹以外的字段与重算前逐字一致。
    const { fingerprint: _after, ...restAfter } = after.preset!;
    const { fingerprint: _before, ...restBefore } = before.preset!;
    const revisions = restAfter.sources.find((source) => source.id === AUTHOR_REVISION_SOURCE_ID)!;
    expect(revisions.samples.at(-1)!.id).toBe(revisionSampleId(last.chapterNumber, last.authorText));
    expect({
      ...restAfter,
      sources: restAfter.sources.map((source) => source.id === AUTHOR_REVISION_SOURCE_ID ? { ...source, samples: source.samples.slice(0, -1) } : source),
    }).toEqual(restBefore);
    expect(after.guideText).toBe(before.guideText);
    expect(after.guideText).toBe(composeStyleGuide(after.preset!));
  });

  it("重算后计数重置：再采纳一段只算 1 段新增，指纹不再变", async () => {
    const first = await adoptRevisionSamples(bookRoot, range(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES), null);
    expect(first.fingerprintRefresh.outcome).toBe("refreshed");
    const fingerprint = (await loadStylePreset(bookRoot)).preset!.fingerprint;
    expect(fingerprint).not.toBeNull();

    const next = await adoptRevisionSamples(bookRoot, [revision(99)], first.revision);
    expect(next.fingerprintRefresh).toMatchObject({
      outcome: "pending",
      status: { basis: "author-revisions", includedSamples: FINGERPRINT_REFRESH_MIN_NEW_SAMPLES, pendingSamples: 1, remainingSamples: FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - 1 },
    });
    expect((await loadStylePreset(bookRoot)).preset!.fingerprint).toEqual(fingerprint);

    // 作者之后手动提取统计：新指纹不带来历，计数从这一刻重新开始，已有范文不算新增。
    await updateStyleFingerprint(bookRoot, manualFingerprint);
    expect(await readVaultFingerprintStatus(bookRoot)).toMatchObject({ basis: "external", pendingSamples: 0 });
    const afterManual = await adoptRevisionSamples(bookRoot, [revision(100)], (await loadStylePreset(bookRoot)).revision);
    expect(afterManual.fingerprintRefresh).toMatchObject({ outcome: "pending", status: { basis: "external", pendingSamples: 1 } });
    expect(afterManual.preset!.fingerprint).toMatchObject(manualFingerprint);
  });

  it("版本冲突时放弃重算并说明原因，不覆盖作者刚保存的内容", async () => {
    // 已达阈值但尚未重算的快照（没有指纹，作者改稿范文够数）。
    const adopted = await adoptRevisionSamples(bookRoot, range(FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - 1), null);
    const snapshotPreset = adopted.preset!;
    const sources = snapshotPreset.sources.map((source) => source.id !== AUTHOR_REVISION_SOURCE_ID ? source : {
      ...source,
      samples: [...source.samples, { id: "rev-extra", sceneType: "general" as const, text: revision(42).authorText, evidence: "e", transfer: "transferable" as const, status: "confirmed" as const }],
    });
    const snapshot = await saveStylePreset(bookRoot, { ...snapshotPreset, sources }, adopted.revision);
    expect(fingerprintRefreshStatus(null, snapshot.preset!.sources[0]!.samples).due).toBe(true);

    // 重算写入前，作者在文风页保存了新版本。
    const authorSaved = await saveStylePreset(bookRoot, { ...snapshot.preset!, generalRules: ["作者刚保存的规则"] }, snapshot.revision);

    const result = await refreshFingerprintFromVault(bookRoot, snapshot);
    expect(result.result).toMatchObject({ outcome: "skipped", reason: expect.stringContaining("覆盖") });
    expect(result.loaded.revision).toBe(snapshot.revision);
    const stored = await loadStylePreset(bookRoot);
    expect(stored.revision).toBe(authorSaved.revision);
    expect(stored.preset!.generalRules).toEqual(["作者刚保存的规则"]);
    expect(stored.preset!.fingerprint).toBeNull();
  });
});
