/**
 * storyline.propose —— 叙述者从已结算事件归纳剧情线时，提交剧情线草稿。
 *
 * 纪律（单一 Agent 契约）：
 * - 只产 needs-review 草稿，确认/驳回由作者在「待确认」面板或剧情线 review 接口完成；
 *   叙述者不能确认自己的草稿。
 * - 幂等：同书同名的剧情线已存在（待审或已确认）时不重复创建，返回已存在的那条；
 *   作者驳回过的名字直接拒绝，不反复起草。
 * - relatedEntryTitles 只解析不建实体（按标题，含繁简归一）；解析不出的名字在结果里如实列出。
 */

import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { toSimplifiedText } from "../engine/text/zh-variants.js";
import {
  createStoryline,
  findStorylineByName,
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

function entryTitleOf(storage: StorageDatabase, bookId: string, entryId: string): { id: string; title: string } | undefined {
  return storage.sqlite
    .prepare<{ id: string; title: string }>(
      "SELECT id, title FROM story_jingwei_entry WHERE book_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .get(bookId, entryId) ?? undefined;
}

const MAX_RELATED_TITLES = 20;

export async function handleStorylinePropose(input: StorylineProposeInput): Promise<StorylineProposeResult> {
  const name = input.name?.trim() ?? "";
  if (!name) return fail("invalid-input", "剧情线需要一个名字，否则归纳出的草稿无法在树上区分。");
  if (input.kind !== undefined && !isStorylineKind(input.kind)) {
    return fail("invalid-input", `kind 取值无效：${input.kind}。`);
  }

  const storage = getStorageDatabase();

  const resolved: { id: string; title: string }[] = [];
  const unresolved: string[] = [];
  // 关联条目只是给剧情线挂几个主角色/主事件：去重后最多取前 MAX_RELATED_TITLES 个，多出的报未解析。
  const allTitles = [...new Set((input.relatedEntryTitles ?? []).map((title) => title.trim()).filter((title) => title.length > 0 && title.length <= 200))];
  const titles = allTitles.slice(0, MAX_RELATED_TITLES);
  unresolved.push(...allTitles.slice(MAX_RELATED_TITLES));
  if (titles.length > 0) {
    // 按标题解析：先逐字，再做繁简归一（叙述者常把「趙太爷」「吳媽」写成简体）。只读条目标题，不建实体。
    // 条目标题只归一一次建表（按最近更新优先，同名取最近更新的那条），不对每个查询标题重扫全书。
    const entries = storage.sqlite
      .prepare<{ id: string; title: string }>(
        `SELECT id, title FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all(input.bookId);
    const byExact = new Map<string, { id: string; title: string }>();
    const byNormalized = new Map<string, { id: string; title: string }>();
    for (const entry of entries) {
      if (!byExact.has(entry.title)) byExact.set(entry.title, entry);
      const normalizedTitle = toSimplifiedText(entry.title.trim());
      if (!byNormalized.has(normalizedTitle)) byNormalized.set(normalizedTitle, entry);
    }
    for (const title of titles) {
      const row = byExact.get(title) ?? byNormalized.get(toSimplifiedText(title));
      if (row) {
        if (!resolved.some((item) => item.id === row.id)) resolved.push({ id: row.id, title: row.title });
      } else unresolved.push(title);
    }
  }

  const existing = findStorylineByName(storage, input.bookId, name);
  if (existing && existing.status === "rejected") {
    return fail(
      "storyline-rejected",
      `剧情线「${name}」作者已驳回，不再重复提交同名草稿。若事件确实支撑一条不同的线，请换一个能区分的名字并在 evidenceNote 里说明与被驳回那条的差别。`,
    );
  }
  if (existing) {
    const unresolvedText = unresolved.length > 0 ? `未解析的名字：${unresolved.join("、")}。` : "";
    const stateText = existing.status === "needs-review" ? "已存在（待审中）" : "已是本书的正式剧情线";
    // 复用的待审草稿还没挂关联条目时，把这次新解析出的首个条目补挂上（与新建时同一口径）；
    // 已挂了条目的不改，作者确认过的线也不由叙述者改挂。
    const primary = resolved[0];
    const wantsBackfill = Boolean(primary && !existing.entryId && existing.status === "needs-review");
    // 写入时再核对一次书与状态：读到写之间作者可能已确认这条线，确认过的线不由叙述者改挂。
    // 按实际改动行数决定提示，没改成就不说「已补挂」。
    const backfill = wantsBackfill && primary
      ? storage.sqlite
        .prepare("UPDATE narrative_storyline SET entry_id = ?, updated_at = ? WHERE id = ? AND book_id = ? AND status = 'needs-review' AND entry_id IS NULL")
        .run(primary.id, Date.now(), existing.id, input.bookId).changes > 0
      : false;
    const linkedId = backfill && primary ? primary.id : existing.entryId;
    const linkedEntry = linkedId
      ? resolved.find((entry) => entry.id === linkedId) ?? entryTitleOf(storage, input.bookId, linkedId)
      : undefined;
    const backfillText = backfill && primary ? `已补挂关联条目「${primary.title}」。` : "";
    return {
      ok: true,
      summary: `剧情线「${name}」${stateText}，未重复创建。${backfillText}${unresolvedText}`,
      data: {
        storylineId: existing.id,
        name: existing.name,
        reused: true,
        ...(linkedEntry ? { linkedEntry } : {}),
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
  // 叙述者写的依据常自带句末标点，去掉再统一补一个句号，免得出现「。。」。
  const evidenceBody = evidence?.replace(/[。．.！!？?；;，,、\s]+$/u, "");
  const evidenceText = evidenceBody ? `依据：${evidenceBody}。` : "";
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
