/**
 * 文风金库 → 统计指纹自动重算（T2.7）的纯逻辑。
 *
 * 指纹仍只存在文风预设的 `fingerprint` 字段里（唯一权威源）。「这份指纹是根据哪些作者改稿算的」
 * 记在指纹自身的 `vaultBasis` 上：它描述的就是这份指纹，指纹被手动提取或蒸馏采纳整体替换时，
 * 旧的计数随之失效，不会出现计数与指纹两处走样。
 *
 * 计数规则：
 * - basis = author-revisions：指纹由这些范文算出，新增 = 当前作者改稿范文中不在 sampleIds 里的。
 * - basis = external：指纹来自别处（作者手动提取 / 整书蒸馏），sampleIds 是首次接手时已有的范文，
 *   之后新增的才计数，避免作者刚手动提取的基线被一次采纳立刻改掉。
 * - 指纹存在但没有 basis：视同 external，下一次采纳写入时以采纳前的范文为起点补记（见 stampExternalBasis）。
 * - 根本没有指纹：全部作者改稿范文都算新增，攒够阈值就生成第一份指纹。
 *
 * 重算只取已确认、可迁移的作者改稿范文正文，纯统计，不调模型；不改指南、范文与来源规则。
 */

import { z } from "zod";

import { distillStyleProfile } from "../tools/import/style-distiller.js";
import type { StyleFingerprint, StylePreset } from "./style-preset.js";

/**
 * 段数阈值：一段作者改稿通常 50–300 字、3–10 句；5 段约 20–50 句，句长均值、标准差与长短句比例
 * 才不至于被单段的偶然节奏带偏。再少就是拿一两段话改全书基线。
 */
export const FINGERPRINT_REFRESH_MIN_NEW_SAMPLES = 5;
/** 字数阈值：作者整段重写的长段不足 5 段也可能已有足够句子；新增满 3000 字（约一章半的改稿量）同样触发。 */
export const FINGERPRINT_REFRESH_MIN_NEW_CHARS = 3_000;

const VaultBasisSchema = z.object({
  kind: z.enum(["author-revisions", "external"]),
  sampleIds: z.array(z.string()).max(1_000),
  recordedAt: z.string(),
});

export type VaultFingerprintBasis = z.infer<typeof VaultBasisSchema>;

type RevisionSample = StylePreset["sources"][number]["samples"][number];

export function readVaultBasis(fingerprint: StyleFingerprint | null | undefined): VaultFingerprintBasis | null {
  if (!fingerprint) return null;
  const parsed = VaultBasisSchema.safeParse((fingerprint as Record<string, unknown>).vaultBasis);
  return parsed.success ? parsed.data : null;
}

function eligible(samples: readonly RevisionSample[]): RevisionSample[] {
  return samples.filter((sample) => sample.status === "confirmed" && sample.transfer === "transferable");
}

export interface FingerprintRefreshStatus {
  /** 当前指纹的来历：作者改稿自动算出 / 别处来的 / 还没有指纹。 */
  readonly basis: "author-revisions" | "external" | "none";
  /** 当前指纹由多少段作者改稿算出（仅 basis = author-revisions 时非 0）。 */
  readonly includedSamples: number;
  /** 上次自动重算时间（仅 basis = author-revisions）。 */
  readonly refreshedAt: string | null;
  /** 自上次计算以来新增、尚未计入指纹的作者改稿段数与字数。 */
  readonly pendingSamples: number;
  readonly pendingChars: number;
  /** 按段数阈值还差几段；字数先到阈值时也会提前更新。 */
  readonly remainingSamples: number;
  readonly due: boolean;
  readonly thresholds: { readonly samples: number; readonly chars: number };
}

export function fingerprintRefreshStatus(
  fingerprint: StyleFingerprint | null,
  samples: readonly RevisionSample[],
): FingerprintRefreshStatus {
  const basis = readVaultBasis(fingerprint);
  const candidates = eligible(samples);
  const counted = new Set(basis?.sampleIds ?? []);
  // 有指纹但没有 basis：起点要等下一次采纳写入时补记，在那之前没有可计数的新增。
  const pending = basis ? candidates.filter((sample) => !counted.has(sample.id)) : fingerprint ? [] : candidates;
  const pendingChars = pending.reduce((sum, sample) => sum + sample.text.length, 0);
  const due = pending.length >= FINGERPRINT_REFRESH_MIN_NEW_SAMPLES || pendingChars >= FINGERPRINT_REFRESH_MIN_NEW_CHARS;
  return {
    basis: basis?.kind ?? (fingerprint ? "external" : "none"),
    includedSamples: basis?.kind === "author-revisions" ? basis.sampleIds.length : 0,
    refreshedAt: basis?.kind === "author-revisions" ? basis.recordedAt : null,
    pendingSamples: pending.length,
    pendingChars,
    remainingSamples: due ? 0 : FINGERPRINT_REFRESH_MIN_NEW_SAMPLES - pending.length,
    due,
    thresholds: { samples: FINGERPRINT_REFRESH_MIN_NEW_SAMPLES, chars: FINGERPRINT_REFRESH_MIN_NEW_CHARS },
  };
}

/** 指纹来自别处且尚无 basis 时，以「采纳前已有的范文」为起点补记；其余情况原样返回。 */
export function stampExternalBasis(
  fingerprint: StyleFingerprint | null,
  baselineSampleIds: readonly string[],
  now: Date,
): StyleFingerprint | null {
  if (!fingerprint || readVaultBasis(fingerprint)) return fingerprint;
  const vaultBasis: VaultFingerprintBasis = { kind: "external", sampleIds: [...baselineSampleIds], recordedAt: now.toISOString() };
  return { ...fingerprint, vaultBasis };
}

/** 用全部已确认、可迁移的作者改稿范文重算指纹，并记下计入了哪些段。 */
export function computeVaultFingerprint(samples: readonly RevisionSample[], now: Date): StyleFingerprint {
  const used = eligible(samples);
  const vaultBasis: VaultFingerprintBasis = { kind: "author-revisions", sampleIds: used.map((sample) => sample.id), recordedAt: now.toISOString() };
  return { ...distillStyleProfile(used.map((sample) => sample.text)), vaultBasis };
}
