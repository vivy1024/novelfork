/**
 * 写作注入用的角色声线加载（T2.3 → T2.4 接缝）。
 *
 * 场景蓝图与写作请求里的出场角色是名字，声线存在经纬角色条目的 fields.voice。
 * 这里按标题与别名精确匹配到角色条目，再交给 buildVoiceConstraintText 生成约束；
 * 只注入作者已确认的字段。匹配不到的名字、声线数据损坏的条目如实返回，不静默吞掉。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { normalizeCategory } from "../jingwei/unified-categories.js";
import { buildVoiceConstraintText, listConfirmedVoiceFieldLabels, readCharacterVoiceProfiles } from "./character-voice.js";

export interface SceneVoiceProfileSummary {
  readonly characterId: string;
  readonly name: string;
  /** 实际进入约束文本的字段标签（与正文块一一对应，只含作者已确认项）。 */
  readonly confirmedFields: readonly string[];
}

export interface SceneVoiceConstraints {
  /** 注入写作上下文的约束文本；没有可用声线时为空串。 */
  readonly text: string;
  /** 命中的经纬角色条目 id（按出场顺序去重）。 */
  readonly matchedIds: readonly string[];
  /** 声线数据损坏、未参与注入的条目 id。 */
  readonly corruptedIds: readonly string[];
  /** 本次真正注入声线的角色（顺序与正文块一致），供「写作注入」诊断逐角色列出。 */
  readonly profiles: readonly SceneVoiceProfileSummary[];
  /** 匹配到条目、但没有任何已确认声线字段的角色名（不会进约束文本）。 */
  readonly matchedWithoutVoiceNames: readonly string[];
}

const EMPTY: SceneVoiceConstraints = { text: "", matchedIds: [], corruptedIds: [], profiles: [], matchedWithoutVoiceNames: [] };

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export async function loadSceneVoiceConstraints(input: {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly characterNames: readonly string[];
}): Promise<SceneVoiceConstraints> {
  const names = [...new Set(input.characterNames.map(normalizeName).filter(Boolean))];
  if (names.length === 0) return EMPTY;

  const entries = (await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId))
    .filter((entry) => normalizeCategory(entry.category).category === "characters");
  if (entries.length === 0) return EMPTY;

  const idByName = new Map<string, string>();
  for (const entry of entries) {
    for (const label of [entry.title, ...(entry.aliases ?? [])]) {
      const key = normalizeName(label ?? "");
      // 同名（或别名撞名）时保留先出现的条目，结果确定且不猜测。
      if (key && !idByName.has(key)) idByName.set(key, entry.id);
    }
  }

  const matchedIds = [...new Set(names.map((name) => idByName.get(name)).filter((id): id is string => Boolean(id)))];
  if (matchedIds.length === 0) return EMPTY;

  const matchedEntries = entries.filter((entry) => matchedIds.includes(entry.id));
  const { profiles, corruptedIds } = readCharacterVoiceProfiles(
    matchedEntries.map((entry) => ({ id: entry.id, title: entry.title, fields: entry.fields ?? {} })),
  );
  // 摘要与约束文本同源同序：buildVoiceConstraintText 跳过没有任何已确认字段的角色，这里同样跳过。
  const byId = new Map(profiles.map((profile) => [profile.characterId, profile] as const));
  const injected: SceneVoiceProfileSummary[] = [];
  const withoutVoice: string[] = [];
  for (const id of [...new Set(matchedIds)]) {
    const profile = byId.get(id);
    if (!profile) continue;
    const confirmedFields = listConfirmedVoiceFieldLabels(profile.voice);
    if (confirmedFields.length > 0) injected.push({ characterId: id, name: profile.name, confirmedFields });
    else withoutVoice.push(profile.name);
  }
  return {
    text: buildVoiceConstraintText(profiles, matchedIds),
    matchedIds,
    corruptedIds,
    profiles: injected,
    matchedWithoutVoiceNames: withoutVoice,
  };
}
