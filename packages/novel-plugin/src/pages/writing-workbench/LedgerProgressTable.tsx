/**
 * G5 进度账本：把伏笔 / 冲突 / 资源债务摊成一张可编辑表。
 *
 * 权威源仍是现有存储，不落新表：
 * - 伏笔、冲突：经纬 entries（PUT fieldsPatch 增量写回）
 * - 钱/证/仇/债：runtime resourceLedger（只读，结清走章后结算）
 * 谜题是过滤，不是第三套分类。
 */

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Columns3, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, useApi } from "@/hooks/use-api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  computeForeshadowingDebt,
  type ForeshadowingDebt,
} from "../../engine/jingwei/foreshadowing-debt";
import {
  PRESSURE_LEDGER_KIND_LABEL,
  PRESSURE_LEDGER_STALE_AFTER_CHAPTERS,
  classifyPressureResource,
  type PressureResourceKind,
} from "../../engine/agents/pressure-ledger-kinds";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export const FORESHADOW_STATUSES = ["已埋设", "部分揭示", "唤醒中", "已触发", "已回收", "已废弃"] as const;
export type ForeshadowStatus = (typeof FORESHADOW_STATUSES)[number];

export const CONFLICT_STATUSES = ["未解决", "进行中", "已收束"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

const FORESHADOW_SETTLED = new Set<string>(["已回收", "已废弃"]);
const CONFLICT_SETTLED = new Set<string>(["已收束"]);

export type LedgerRowKind = "foreshadow" | "conflict" | "debt";
export type LedgerFilter = "all" | "foreshadow" | "conflict" | "debt" | "puzzle" | "stale";

interface JingweiEntryPayload {
  readonly id: string;
  readonly title?: string;
  readonly contentMd?: string;
  readonly customFields?: Record<string, unknown>;
  readonly fieldsJson?: string;
}

interface ResourceLedgerPayload {
  readonly resourceId: string;
  readonly name?: string;
  readonly balance?: number;
  readonly lastChapter?: number;
}

interface BookStatePayload {
  readonly resourceLedger?: { readonly resources?: readonly ResourceLedgerPayload[] };
}

export interface LedgerProgressRow {
  readonly id: string;
  readonly kind: LedgerRowKind;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly statusEditable: boolean;
  readonly statusOptions: readonly string[];
  readonly chapterLabel: string;
  readonly jumpChapter?: number;
  readonly targetChapter?: number;
  readonly warning?: string;
  readonly isPuzzle: boolean;
  readonly category: "foreshadowing" | "conflicts" | "resource";
  readonly debtKind?: PressureResourceKind;
  readonly foreshadowDebt?: ForeshadowingDebt;
}

export interface LedgerProgressTableProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly onOpen: (node: WorkbenchResourceNode) => void;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
}

function parseFields(entry: JingweiEntryPayload): Record<string, unknown> {
  if (entry.customFields && typeof entry.customFields === "object") return entry.customFields;
  if (entry.fieldsJson) {
    try {
      return JSON.parse(entry.fieldsJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function textField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function numberField(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function looksLikePuzzle(input: {
  readonly name: string;
  readonly eventType?: string;
  readonly kind?: string;
}): boolean {
  const blob = `${input.name} ${input.eventType ?? ""} ${input.kind ?? ""}`;
  return /谜|puzzle/i.test(blob) || input.kind === "puzzle";
}

function normalizeConflictStatus(raw: string): ConflictStatus {
  if (CONFLICT_STATUSES.includes(raw as ConflictStatus)) return raw as ConflictStatus;
  if (raw === "已解决" || raw === "已结束" || raw === "resolved" || raw === "deferred") return "已收束";
  if (raw === "开放" || raw === "未开始" || raw === "brewing" || raw === "latent" || raw === "emerging") return "未解决";
  if (raw === "escalating" || raw === "transforming" || raw === "climaxing" || raw === "unifying") return "进行中";
  return "进行中";
}

function normalizeForeshadowStatus(raw: string): ForeshadowStatus {
  if (FORESHADOW_STATUSES.includes(raw as ForeshadowStatus)) return raw as ForeshadowStatus;
  if (raw === "triggered" || raw === "paying_off") return "已触发";
  if (raw === "planted" || raw === "open" || raw === "pending") return "已埋设";
  if (raw === "reinforced" || raw === "progressing" || raw === "partial") return "部分揭示";
  if (raw === "paid_off" || raw === "resolved") return "已回收";
  if (raw === "abandoned" || raw === "contradicted") return "已废弃";
  return "已埋设";
}

function forgottenWarning(name: string, kind: PressureResourceKind, lastChapter: number, currentChapter: number): string {
  const gap = currentChapter - lastChapter;
  const label = PRESSURE_LEDGER_KIND_LABEL[kind];
  return `${label}「${name}」已 ${gap} 章没有推进，可能被遗忘（上次第 ${lastChapter} 章）。本章推进、延后或明确回收，不要让关键账目无声消失。`;
}

function conflictOverdueWarning(name: string, chapterEnd: number, currentChapter: number): string {
  return `冲突「${name}」计划在第 ${chapterEnd} 章收束，现在已到第 ${currentChapter} 章仍未收束。建议推进解决或改到期章，不要让矛盾无声消失。`;
}

export function buildForeshadowRow(
  entry: JingweiEntryPayload,
  currentChapter: number | undefined,
): LedgerProgressRow {
  const fields = parseFields(entry);
  const name = textField(fields, "name") || entry.title || "未命名伏笔";
  const status = normalizeForeshadowStatus(textField(fields, "status"));
  const plantedChapter = numberField(fields, "plantedChapter");
  const targetChapter = numberField(fields, "targetChapter");
  const settled = FORESHADOW_SETTLED.has(status);
  const debt = computeForeshadowingDebt({
    plantedChapter,
    currentChapter: currentChapter ?? null,
    settled,
  });
  const chapterParts: string[] = [];
  if (plantedChapter > 0) chapterParts.push(`埋 ${plantedChapter}`);
  if (targetChapter > 0) chapterParts.push(`兑 ${targetChapter}`);
  const warning = !settled && (debt.level === "overdue" || debt.level === "due-soon") ? debt.explanation : undefined;
  return {
    id: entry.id,
    kind: "foreshadow",
    name,
    description: textField(fields, "description") || entry.contentMd || "",
    status,
    statusEditable: true,
    statusOptions: FORESHADOW_STATUSES,
    chapterLabel: chapterParts.join(" · ") || "未定章",
    jumpChapter: targetChapter > 0 ? targetChapter : plantedChapter > 0 ? plantedChapter : undefined,
    targetChapter: targetChapter > 0 ? targetChapter : undefined,
    warning,
    isPuzzle: looksLikePuzzle({ name, kind: textField(fields, "kind") }),
    category: "foreshadowing",
    foreshadowDebt: debt,
  };
}

export function buildConflictRow(
  entry: JingweiEntryPayload,
  currentChapter: number | undefined,
): LedgerProgressRow {
  const fields = parseFields(entry);
  const name = textField(fields, "name") || entry.title || "未命名冲突";
  const status = normalizeConflictStatus(textField(fields, "status") || textField(fields, "resolutionState"));
  const chapterStart = numberField(fields, "chapterStart");
  const chapterEnd = numberField(fields, "chapterEnd");
  const resolutionChapter = numberField(fields, "resolutionChapter");
  const dueChapter = resolutionChapter > 0 ? resolutionChapter : chapterEnd;
  const protagonistSide = textField(fields, "protagonistSide");
  const antagonistSide = textField(fields, "antagonistSide");
  const stakes = textField(fields, "stakes");
  const sides = [protagonistSide, antagonistSide].filter(Boolean).join(" vs ");
  const settled = CONFLICT_SETTLED.has(status);
  const overdue = !settled && dueChapter > 0 && currentChapter !== undefined && currentChapter > dueChapter;
  const chapterParts: string[] = [];
  if (chapterStart > 0) chapterParts.push(`起 ${chapterStart}`);
  if (dueChapter > 0) chapterParts.push(`收 ${dueChapter}`);
  return {
    id: entry.id,
    kind: "conflict",
    name,
    description: [sides, stakes || textField(fields, "summary") || entry.contentMd || ""].filter(Boolean).join(" · "),
    status,
    statusEditable: true,
    statusOptions: CONFLICT_STATUSES,
    chapterLabel: chapterParts.join(" · ") || "未定章",
    jumpChapter: dueChapter > 0 ? dueChapter : chapterStart > 0 ? chapterStart : undefined,
    warning: overdue && currentChapter !== undefined ? conflictOverdueWarning(name, dueChapter, currentChapter) : undefined,
    isPuzzle: looksLikePuzzle({ name, eventType: textField(fields, "eventType") || textField(fields, "type"), kind: textField(fields, "kind") }),
    category: "conflicts",
  };
}

export function buildDebtRow(
  resource: ResourceLedgerPayload,
  currentChapter: number | undefined,
): LedgerProgressRow | null {
  const name = resource.name || resource.resourceId;
  const kind = classifyPressureResource(resource.resourceId, name);
  if (!kind) return null;
  const lastChapter = typeof resource.lastChapter === "number" ? resource.lastChapter : 0;
  const forgotten = lastChapter > 0
    && currentChapter !== undefined
    && currentChapter - lastChapter >= PRESSURE_LEDGER_STALE_AFTER_CHAPTERS;
  const balance = typeof resource.balance === "number" ? resource.balance : 0;
  return {
    id: `resource:${resource.resourceId}`,
    kind: "debt",
    name,
    description: `余额 ${balance >= 0 ? "+" : ""}${balance}`,
    status: "章后结算",
    statusEditable: false,
    statusOptions: [],
    chapterLabel: lastChapter > 0 ? `上次第 ${lastChapter} 章` : "未记录",
    jumpChapter: lastChapter > 0 ? lastChapter : undefined,
    warning: forgotten && currentChapter !== undefined ? forgottenWarning(name, kind, lastChapter, currentChapter) : undefined,
    isPuzzle: looksLikePuzzle({ name }),
    category: "resource",
    debtKind: kind,
  };
}

function jingweiNode(bookId: string, row: LedgerProgressRow): WorkbenchResourceNode {
  return {
    id: `jingwei-entry:${row.id}`,
    kind: "jingwei-entry",
    title: row.name,
    content: row.description,
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
    metadata: { entryId: row.id, category: row.category, bookId },
  };
}

export function createForeshadowingBoardNode(): WorkbenchResourceNode {
  return {
    id: "tool:foreshadowing",
    kind: "tool",
    title: "伏笔看板",
    capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    metadata: { toolPanel: "foreshadowing" },
  };
}

const FILTERS: readonly { value: LedgerFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "foreshadow", label: "伏笔" },
  { value: "conflict", label: "冲突" },
  { value: "debt", label: "债务" },
  { value: "puzzle", label: "谜题" },
  { value: "stale", label: "超期/遗忘" },
];

const KIND_BADGE: Record<LedgerRowKind, string> = {
  foreshadow: "伏笔",
  conflict: "冲突",
  debt: "债务",
};

export function LedgerProgressTable({ bookId, currentChapter, onOpen, onJumpToChapter }: LedgerProgressTableProps) {
  const foreshadowQuery = useApi<{ entries?: JingweiEntryPayload[] }>(
    `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=foreshadowing`,
  );
  const conflictQuery = useApi<{ entries?: JingweiEntryPayload[] }>(
    `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=conflicts`,
  );
  const stateQuery = useApi<BookStatePayload>(`/api/books/${encodeURIComponent(bookId)}/state`);

  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<LedgerFilter>("all");

  const rows = useMemo(() => {
    const next: LedgerProgressRow[] = [];
    for (const entry of foreshadowQuery.data?.entries ?? []) {
      const row = buildForeshadowRow(entry, currentChapter);
      next.push(statusOverrides[row.id] ? { ...row, status: statusOverrides[row.id]! } : row);
    }
    for (const entry of conflictQuery.data?.entries ?? []) {
      const row = buildConflictRow(entry, currentChapter);
      next.push(statusOverrides[row.id] ? { ...row, status: statusOverrides[row.id]! } : row);
    }
    for (const resource of stateQuery.data?.resourceLedger?.resources ?? []) {
      const row = buildDebtRow(resource, currentChapter);
      if (row) next.push(row);
    }
    return next;
  }, [conflictQuery.data, currentChapter, foreshadowQuery.data, stateQuery.data, statusOverrides]);

  const stats = useMemo(() => {
    const foreshadows = rows.filter((row) => row.kind === "foreshadow");
    const openForeshadow = foreshadows.filter((row) => !FORESHADOW_SETTLED.has(row.status));
    const dueNow = openForeshadow.filter((row) => {
      const target = row.targetChapter ?? 0;
      return target > 0 && currentChapter !== undefined && target <= currentChapter + 1;
    });
    const openConflicts = rows.filter((row) => row.kind === "conflict" && !CONFLICT_SETTLED.has(row.status));
    const forgotten = rows.filter((row) => row.kind === "debt" && Boolean(row.warning));
    return {
      openForeshadow: openForeshadow.length,
      dueNow: dueNow.length,
      openConflicts: openConflicts.length,
      forgotten: forgotten.length,
    };
  }, [currentChapter, rows]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "foreshadow":
        return rows.filter((row) => row.kind === "foreshadow");
      case "conflict":
        return rows.filter((row) => row.kind === "conflict");
      case "debt":
        return rows.filter((row) => row.kind === "debt");
      case "puzzle":
        return rows.filter((row) => row.isPuzzle);
      case "stale":
        return rows.filter((row) => Boolean(row.warning));
      default:
        return rows;
    }
  }, [filter, rows]);

  const patchStatus = useCallback(async (row: LedgerProgressRow, nextStatus: string) => {
    if (!row.statusEditable || nextStatus === row.status) return;
    const previous = row.status;
    setStatusOverrides((current) => ({ ...current, [row.id]: nextStatus }));
    try {
      await fetchJson(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(row.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldsPatch: { status: nextStatus } }),
        },
      );
      toast(`${row.name} 状态已更新：${previous} → ${nextStatus}`, "success");
    } catch {
      setStatusOverrides((current) => ({ ...current, [row.id]: previous }));
      toast("状态保存失败，已恢复原状态", "error");
    }
  }, [bookId]);

  const loading = foreshadowQuery.loading || conflictQuery.loading || stateQuery.loading;
  const error = foreshadowQuery.error ?? conflictQuery.error ?? stateQuery.error;

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>加载进度账本…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 p-3 text-xs text-destructive">
        <p>加载失败：{error}</p>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            void foreshadowQuery.refetch();
            void conflictQuery.refetch();
            void stateQuery.refetch();
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="ledger-progress-table">
      <div className="flex items-center justify-between gap-1 px-1">
        <span className="text-2xs font-semibold text-muted-foreground">进度账本</span>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 text-2xs"
          onClick={() => onOpen(createForeshadowingBoardNode())}
        >
          <Columns3 className="size-3" />
          打开看板
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1">
        <Badge variant="outline" className="h-4 px-1 py-0 text-2xs">待回收 {stats.openForeshadow}</Badge>
        <Badge variant="outline" className="h-4 px-1 py-0 text-2xs" data-testid="foreshadow-due-count">本章到期 {stats.dueNow}</Badge>
        <Badge variant="outline" className="h-4 px-1 py-0 text-2xs">未收束 {stats.openConflicts}</Badge>
        <Badge variant="outline" className={cn("h-4 px-1 py-0 text-2xs", stats.forgotten > 0 ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "")}>
          遗忘 {stats.forgotten}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1" data-testid="ledger-filter-bar">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              "rounded-full px-2 py-0.5 text-2xs transition-colors",
              filter === item.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">暂无进度账</p>
          <p className="text-2xs">伏笔、冲突写进经纬后会出现在这里；钱/证/仇/债由章后结算进入资源账本。</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-3 text-center text-2xs text-muted-foreground">当前筛选下没有账目。</p>
      ) : (
        <div className="space-y-1">
          {filtered.map((row) => (
            <div
              key={row.id}
              data-testid={`ledger-row-${row.id}`}
              className={cn(
                "rounded-lg border bg-card p-2 space-y-1 text-xs",
                row.warning ? "border-amber-400/80 bg-amber-500/5" : "border-border",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-2xs">{KIND_BADGE[row.kind]}</Badge>
                {row.isPuzzle ? <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-2xs">谜</Badge> : null}
                {row.statusEditable ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                    onClick={() => onOpen(jingweiNode(bookId, row))}
                  >
                    {row.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                )}
                {row.statusEditable ? (
                  <select
                    aria-label={`${row.name} 状态`}
                    value={row.status}
                    onChange={(event) => void patchStatus(row, event.currentTarget.value)}
                    className="h-5 max-w-20 shrink-0 rounded border border-border bg-background px-1 text-2xs"
                  >
                    {row.statusOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="shrink-0 text-2xs text-muted-foreground"
                    title="余额由章后结算维护，不能在表里直接结清"
                  >
                    {row.status}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                {row.jumpChapter && onJumpToChapter ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onJumpToChapter(row.jumpChapter!)}
                  >
                    {row.chapterLabel}
                  </button>
                ) : (
                  <span>{row.chapterLabel}</span>
                )}
                {row.debtKind ? <span>{PRESSURE_LEDGER_KIND_LABEL[row.debtKind]}</span> : null}
              </div>
              {row.warning ? (
                <p className="flex items-start gap-1 text-2xs leading-relaxed text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{row.warning}</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
