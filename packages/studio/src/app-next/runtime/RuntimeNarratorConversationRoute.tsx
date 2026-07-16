import { useEffect, useMemo, useRef, useState } from "react";

import {
  createRuntimeProductClient,
  type RuntimeNarratorSummary,
  type RuntimeProductClient,
} from "./product-contract";
import {
  createRuntimeNarratorClient,
  type RuntimeNarratorClient,
  type RuntimeNarratorRecord,
} from "./runtime-narrator-client";
import {
  RuntimeNarratorPanelMount,
  RuntimeStandaloneNarratorPanelMount,
} from "./RuntimeNarratorPanelMount";

export interface RuntimeNarratorConversationRouteProps {
  readonly bookId: string;
  readonly narrator: RuntimeNarratorSummary;
  readonly compact?: boolean;
}

export function RuntimeNarratorConversationRoute({
  bookId,
  narrator,
  compact,
}: RuntimeNarratorConversationRouteProps) {
  return <RuntimeNarratorPanelMount bookId={bookId} narrator={narrator} compact={compact} />;
}

export interface RuntimeStandaloneNarratorConversationRouteProps {
  readonly narrator: RuntimeNarratorRecord;
  readonly compact?: boolean;
}

export function RuntimeStandaloneNarratorConversationRoute({
  narrator,
  compact,
}: RuntimeStandaloneNarratorConversationRouteProps) {
  return <RuntimeStandaloneNarratorPanelMount narrator={narrator} compact={compact} />;
}

export interface RuntimeNarratorConversationLoaderProps {
  readonly narratorId: string;
  readonly compact?: boolean;
  readonly client?: RuntimeProductClient;
  readonly narratorClient?: RuntimeNarratorClient;
  readonly onOpened?: () => void | Promise<void>;
  readonly onInvalidNarrator?: (narratorId: string) => void;
}

type ResolvedNarrator =
  | { readonly kind: "book"; readonly narrator: RuntimeNarratorSummary }
  | { readonly kind: "standalone"; readonly narrator: RuntimeNarratorRecord };

/**
 * Resolves book narrators through trusted product bootstrap and standalone
 * narrators through the canonical Runtime endpoint. Raw chapter-bound IDs are
 * never allowed to fall through the standalone route.
 */
export function RuntimeNarratorConversationLoader({
  narratorId,
  compact,
  client: suppliedClient,
  narratorClient: suppliedNarratorClient,
  onOpened,
  onInvalidNarrator,
}: RuntimeNarratorConversationLoaderProps) {
  const defaultClient = useMemo(() => createRuntimeProductClient(), []);
  const defaultNarratorClient = useMemo(() => createRuntimeNarratorClient(), []);
  const client = suppliedClient ?? defaultClient;
  const narratorClient = suppliedNarratorClient ?? defaultNarratorClient;
  const onOpenedRef = useRef(onOpened);
  const onInvalidNarratorRef = useRef(onInvalidNarrator);
  onOpenedRef.current = onOpened;
  onInvalidNarratorRef.current = onInvalidNarrator;
  const [resolved, setResolved] = useState<ResolvedNarrator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setResolved(null);

    void (async () => {
      const bootstrap = await client.getBootstrap().catch(() => null);
      if (!active) return;
      const bookNarrator = bootstrap?.narrators.find(
        (candidate) => candidate.id === narratorId && candidate.capabilities.read === true,
      ) ?? null;
      if (bookNarrator) {
        await narratorClient.openNarrator({
          id: bookNarrator.id,
          title: bookNarrator.title,
          status: bookNarrator.status === "working"
            ? "working"
            : bookNarrator.status === "waiting"
              ? "waiting"
              : bookNarrator.status === "archived"
                ? "archived"
                : "idle",
        });
        if (!active) return;
        setResolved({ kind: "book", narrator: bookNarrator });
        setLoading(false);
        void onOpenedRef.current?.();
        return;
      }

      const standalone = await narratorClient.getNarrator(narratorId);
      if (!active) return;
      if (standalone.chapterId !== null || standalone.type !== "primary" || standalone.variant !== "primary") {
        throw new Error("当前 Runtime 叙述者属于书籍或子代理，不能通过独立路由访问");
      }
      await narratorClient.openNarrator(standalone);
      if (!active) return;
      setResolved({ kind: "standalone", narrator: standalone });
      setLoading(false);
      void onOpenedRef.current?.();
    })().catch((cause: unknown) => {
      if (!active) return;
      setResolved(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
      onInvalidNarratorRef.current?.(narratorId);
    });

    return () => {
      active = false;
    };
  }, [client, narratorClient, narratorId]);

  if (loading) {
    return <p role="status" className="p-4 text-sm text-muted-foreground">正在连接 Runtime 叙述者…</p>;
  }
  if (!resolved) {
    return <p role="alert" className="p-4 text-sm text-destructive">{error ?? "叙述者不可用"}</p>;
  }
  if (resolved.kind === "book") {
    return (
      <RuntimeNarratorConversationRoute
        bookId={resolved.narrator.bookId}
        narrator={resolved.narrator}
        compact={compact}
      />
    );
  }
  return <RuntimeStandaloneNarratorConversationRoute narrator={resolved.narrator} compact={compact} />;
}
