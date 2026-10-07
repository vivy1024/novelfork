/**
 * storyline.propose —— 叙述者从已结算事件归纳剧情线时，提交剧情线草稿。
 *
 * 纪律（单一 Agent 契约）：
 * - 只产 needs-review 草稿，确认/驳回由作者在「待确认」面板或剧情线 review 接口完成；
 *   叙述者不能确认自己的草稿。
 * - 幂等：同书同名的待审草稿已存在时不重复创建，返回已存在草稿。
 * - relatedEntryTitles 只解析不建实体；解析不出的名字在结果里如实列出。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";

import {
  createStoryline,
  findPendingStorylineByName,
  isStorylineKind,
} from "../engine/narrative-memory/scene-store.js";

export interface StorylineProposeInput {
  readonly bookId: string;
  readonly name: string;
  readonly kind?: string;
  readonly goal?: string;
  readonly relatedEntryTitles?: readonly string[];
  readonly evidenceNote?: string;
}

export interface StorylineProposeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary: string;
  readonly data?: {
    readonly storylineId: string;
    readonly name: string;
    readonly reused: boolean;
    readonly linkedEntry?: { readonly id: string; readonly title: string };
    readonly resolvedEntries: readonly { readonly id: string; readonly title: string }[];
    readonly unresolvedNames: readonly string[];
  };
}

function fail(error: string, summary: string): StorylineProposeResult {
  return { ok: false, error, summary };
}

export async function handleStorylinePropose(input: StorylineProposeInput): Promise<StorylineProposeResult> {
  const name = input.name?.trim() ?? "";
  if (!name) return fail("invalid-input", "剧情线需要一个名字，否则归纳出的草稿无法在树上区分。");
  if (input.kind !== undefined && !isStorylineKind(input.kind)) {
    return fail("invalid-input", `kind 取值无效：${input.kind}。`);
  }

  const storage = getStorageDatabase();

  const resolved: { id: string; title: string }[] = [];
  const unresolved: string[] = [];
  for (const title of input.relatedEntryTitles ?? []) {
    const trimmed = title.trim();
    if (!trimmed) continue;
    const row = storage.sqlite
      .prepare<{ id: string; title: string }>(
        `SELECT id, title FROM story_jingwei_entry
         WHERE book_id = ? AND title = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(input.bookId, trimmed);
    if (row) resolved.push(row);
    else unresolved.push(trimmed);
  }

  const existing = findPendingStorylineByName(storage, input.bookId, name);
  if (existing) {
    const unresolvedText = unresolved.length > 0 ? `未解析的名字：${unresolved.join("、")}。` : "";
    return {
      ok: true,
      summary: `剧情线草稿「${name}」已存在（待审中），未重复创建。${unresolvedText}`,
      data: {
        storylineId: existing.id,
        name: existing.name,
        reused: true,
        resolvedEntries: resolved,
        unresolvedNames: unresolved,
      },
    };
  }

  const created = createStoryline(storage, {
    bookId: input.bookId,
    name,
    ...(isStorylineKind(input.kind) ? { kind: input.kind } : {}),
    ...(input.goal?.trim() ? { goal: input.goal } : {}),
    ...(resolved[0] ? { entryId: resolved[0].id } : {}),
    layer: "dynamic",
    status: "needs-review",
    source: "inferred",
  });
  if (!created.ok || !created.data) {
    return fail(created.error ?? "storyline-create-failed", created.summary);
  }

  const evidence = input.evidenceNote?.trim();
  const primary = resolved[0];
  const unresolvedText = unresolved.length > 0 ? `未解析的名字：${unresolved.join("、")}。` : "";
  const evidenceText = evidence ? `依据：${evidence}。` : "";
  return {
    ok: true,
    summary: `已提交剧情线草稿「${name}」（待确认）。${evidenceText}${unresolvedText}`.trim(),
    data: {
      storylineId: created.data.id,
      name: created.data.name,
      reused: false,
      ...(primary ? { linkedEntry: primary } : {}),
      resolvedEntries: resolved,
      unresolvedNames: unresolved,
    },
  };
}
