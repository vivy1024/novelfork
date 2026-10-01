/**
 * 「写作注入」（W6）取数：某章最近一次写作实际注入了什么，数据来自
 * GET /api/books/:bookId/narrative-memory/write-injection?chapter=N。
 * 与 useNarrativeStructure 互不相关，独立的小 hook。
 */

import { useCallback, useRef, useState } from "react";

import { fetchJson } from "@/hooks/use-api";

export interface WriteInjectionExplanation {
  whatHappened: string;
  whyItMatters: string;
  suggestedAction: string;
}

export interface WriteInjectionChannel {
  channel: string;
  channelLabel: string;
  status: string;
  latencyMs: number;
  candidateCount: number;
  returnedCount: number;
  estimatedTokens: number;
  injectedTokens: number;
}

export interface WriteInjectionFixedCard {
  id: string;
  title: string;
  estimatedTokens: number;
  droppedInPacking: boolean;
}

export interface WriteInjectionStyleSample {
  key: string;
  sourceTitle: string;
  sceneType: string;
  sceneTypeLabel: string;
  transfer: string;
  transferLabel: string;
  match: string;
  matchLabel: string;
  rank: number;
  estimatedTokens: number;
  reason: string;
  droppedInPacking: boolean;
}

export interface WriteInjectionTrimmedSample {
  key: string;
  sourceTitle: string;
  sceneType: string;
  sceneTypeLabel: string;
  rank: number;
  estimatedTokens: number;
  kind: string;
  kindLabel: string;
  reason: string;
}

export interface WriteInjectionTrimReason {
  id: string;
  reason: string;
  channel?: string;
  kind: string;
  kindLabel: string;
}

export interface WriteInjectionReport {
  ok: true;
  exists: true;
  logId: string;
  bookId: string;
  chapterNumber?: number;
  purpose: string;
  purposeLabel: string;
  createdAt: string;
  totalMs: number;
  totalEstimatedTokens: number;
  channels: WriteInjectionChannel[];
  style: {
    recorded: boolean;
    status?: string;
    fixedCardsRecorded: boolean;
    fixedCards: WriteInjectionFixedCard[];
    voices: {
      provided: boolean;
      recorded: boolean;
      characters: { name: string; confirmedFields: string[] }[];
    };
    samples: {
      sceneTypes: {
        labels: string[];
        source: string;
        sourceLabel: string;
        evidence: string[];
        attempts: string[];
        explanation?: WriteInjectionExplanation;
      };
      selected: WriteInjectionStyleSample[];
      trimmed: WriteInjectionTrimmedSample[];
      budget: {
        channelBudgetTokens: number | null;
        reservedTokens: number | null;
        availableTokens: number | null;
        usedTokens: number | null;
      };
      totals: { totalSamples: number; confirmedSamples: number; unconfirmedSamples: number };
      explanations: WriteInjectionExplanation[];
    } | null;
  };
  protection: {
    namedKeeps: WriteInjectionTrimReason[];
    namedEntities: string[];
  };
  trimming: {
    reasons: WriteInjectionTrimReason[];
    droppedCardIds: string[];
    degradedCards: { id: string; from: string; to: string }[];
  };
  notes: string[];
  skills: {
    source: "current-enabled" | "unavailable";
    note: string;
    items: { slug: string; name: string; entry: string | null; mode: string; estimatedTokens: number }[];
  };
}

export interface WriteInjectionEmpty {
  ok: true;
  exists: false;
  chapterNumber: number;
  purpose: string;
  summary: string;
  explanation: WriteInjectionExplanation;
}

export type WriteInjectionResult = WriteInjectionReport | WriteInjectionEmpty;

interface WriteInjectionState {
  data: WriteInjectionResult | null;
  loading: boolean;
  error: string | null;
}

export function useWriteInjection(bookId: string): WriteInjectionState & { lookup: (chapter: number) => Promise<void>; reset: () => void } {
  const [state, setState] = useState<WriteInjectionState>({ data: null, loading: false, error: null });
  // 发起新查询即作包装上一次的返回，避免慢请求盖掉新结果。
  const generationRef = useRef(0);

  const lookup = useCallback(async (chapter: number) => {
    const generation = ++generationRef.current;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const payload = await fetchJson<WriteInjectionResult>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/write-injection?chapter=${chapter}`,
      );
      if (generation !== generationRef.current) return;
      setState({ data: payload, loading: false, error: null });
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        error: cause instanceof Error ? cause.message : "查询写作注入失败",
      }));
    }
  }, [bookId]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, lookup, reset };
}
