/**
 * 写章召回：write.preflight（写前，给 Agent 生成正文用）与 pipeline.write（保存前，审计/诊断用）
 * 共用的 buildNarrativeContext 调用口径。两边必须是同一份参数，否则 Agent 看到的召回包和
 * 管线据以判定超预算的召回包会不一致。
 */
import { loadRuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { Logger } from "@vivy1024/novelfork-core";

import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { loadNarrativeMemoryConfig, type NarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { createSiliconFlowEmbeddingProvider } from "../engine/narrative-memory/embedding-provider.js";
import { loadEmbeddingConfig } from "../engine/narrative-memory/embedding-settings.js";
import { readBookSettlementFreshness } from "../engine/narrative-memory/settlement-freshness.js";
import type { NarrativeContextPackage } from "../engine/narrative-memory/types.js";
import { loadSceneVoiceConstraints } from "../engine/writing-layers/character-voice-context.js";
import { resolveWritingLayers } from "../engine/writing-layers/layer-store.js";
import type { SceneSpec } from "./scene-spec-handler.js";

/** 估算口径已 CJK 感知（budget 注释）：旧 16_000 英文口径 ≈ 新 24_000 真实容量。 */
export const DEFAULT_WRITE_RECALL_MAX_TOKENS = 24_000;

export interface WriteChapterRecallInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly bookRoot: string;
  readonly chapterNumber: number;
  /** 有蓝图时按蓝图的角色/地点/伏笔召回；写前还没有蓝图时退回本章指示文本。 */
  readonly sceneSpec?: SceneSpec;
  /** 没有 sceneSpec 时用于召回排序的场景文本（通常是本章指示）。 */
  readonly sceneText?: string;
  readonly previousChapterTail?: string;
  /** 调用方已读过的配置；不传则现读。 */
  readonly memoryConfig?: NarrativeMemoryConfig | null;
  readonly logger?: Logger;
  readonly logPrefix?: string;
}

function sceneSpecText(sceneSpec: SceneSpec): string {
  return sceneSpec.scenes.map((scene) => [scene.location, scene.conflict, scene.outcome, ...scene.characters].join(" ")).join("\n");
}

function sceneSpecEntities(sceneSpec: SceneSpec): string[] {
  return sceneSpec.scenes.flatMap((scene) => [...scene.characters, scene.location, ...scene.hooks_used, ...scene.hooks_planted]);
}

export async function buildWriteChapterRecall(input: WriteChapterRecallInput): Promise<NarrativeContextPackage> {
  const { storage, bookId, bookRoot, sceneSpec, logger } = input;
  const prefix = input.logPrefix ?? "[write.recall]";
  const memoryConfig = input.memoryConfig !== undefined
    ? input.memoryConfig
    : await loadNarrativeMemoryConfig(bookId, bookRoot).catch(() => null);
  const runtimeSnapshot = await loadRuntimeStateSnapshot(bookRoot).catch(() => undefined);
  const writingLayers = await resolveWritingLayers({ bookRoot }).catch(() => null);
  // 结算后又被改过的章：其摘要与机器事实注入时标注可能过期（现算，读失败不阻断写作）。
  const staleSettlementChapters = await readBookSettlementFreshness(storage, bookId, bookRoot)
    .then((freshness) => freshness.staleChapters)
    .catch(() => [] as readonly number[]);
  // 角色声线：只注入本章出场角色、作者已确认的字段；读取失败不阻断写作。
  const characterNames = sceneSpec ? sceneSpec.scenes.flatMap((scene) => scene.characters) : [];
  const sceneVoices = characterNames.length > 0
    ? await loadSceneVoiceConstraints({ storage, bookId, characterNames }).catch((err: unknown) => {
      logger?.warn(`${prefix} 角色声线读取失败，本章不注入声线：${err instanceof Error ? err.message : String(err)}`);
      return null;
    })
    : null;
  if (sceneVoices && sceneVoices.corruptedIds.length > 0) {
    logger?.warn(`${prefix} 角色声线数据损坏，未注入：${sceneVoices.corruptedIds.join(", ")}。请在角色卡的「声线」区块重新确认。`);
  }
  return buildNarrativeContext({
    storage,
    bookId,
    purpose: "write_chapter",
    chapterNumber: input.chapterNumber,
    ...(sceneSpec ? { sceneSpec } : {}),
    sceneText: sceneSpec ? sceneSpecText(sceneSpec) : (input.sceneText ?? ""),
    entities: sceneSpec ? sceneSpecEntities(sceneSpec) : [],
    maxTokens: memoryConfig?.retrieval.maxTokens ?? DEFAULT_WRITE_RECALL_MAX_TOKENS,
    previousChapterTail: input.previousChapterTail,
    runtimeSnapshot,
    enabledChannels: memoryConfig?.retrieval.channels,
    waveConfig: { enabled: memoryConfig?.retrieval.waveEnabled ?? false },
    semanticConfig: { enabled: memoryConfig?.retrieval.semanticEnabled ?? false },
    ...(memoryConfig?.retrieval.semanticEnabled
      ? await (async () => {
        const embeddingConfig = await loadEmbeddingConfig(storage);
        return embeddingConfig ? { semanticProvider: createSiliconFlowEmbeddingProvider(embeddingConfig) } : {};
      })()
      : {}),
    ...(writingLayers?.bookRulesText ? { bookRulesText: writingLayers.bookRulesText } : {}),
    ...(writingLayers?.styleGuideText ? { styleGuideText: writingLayers.styleGuideText } : {}),
    ...(writingLayers?.stylePreset ? { stylePreset: writingLayers.stylePreset } : {}),
    ...(sceneVoices?.text ? { voiceConstraints: sceneVoices.text } : {}),
    // 结构化声线摘要随文本一起下传：只进检索诊断日志，回答「这章注入了谁的哪些声线字段」。
    ...(sceneVoices?.profiles.length ? { voiceProfiles: sceneVoices.profiles } : {}),
    ...(staleSettlementChapters.length > 0 ? { staleSettlementChapters } : {}),
    ...(writingLayers?.bookDesignText ? { bookDesignText: writingLayers.bookDesignText } : {}),
    // 角色内核：config.characterKernel.enabled=false（默认）时通道内部直接跳过。
    ...(memoryConfig?.characterKernel ? { characterKernelConfig: memoryConfig.characterKernel } : {}),
    ...(memoryConfig?.retrieval.writeProfile ? { writeProfileCaps: memoryConfig.retrieval.writeProfile } : {}),
    // 休眠长线伏笔提醒：按本书配置透传（未配置时 buildNarrativeContext 用默认 30 章 / 3 条）。
    // preflight 与 pipeline.write 都经这里，两边召回包同口径。
    ...(memoryConfig?.retrieval.dormantHookChapters !== undefined || memoryConfig?.retrieval.dormantHookLimit !== undefined
      ? {
        dormantHooks: {
          ...(memoryConfig?.retrieval.dormantHookChapters !== undefined ? { thresholdChapters: memoryConfig.retrieval.dormantHookChapters } : {}),
          ...(memoryConfig?.retrieval.dormantHookLimit !== undefined ? { limit: memoryConfig.retrieval.dormantHookLimit } : {}),
        },
      }
      : {}),
  });
}
