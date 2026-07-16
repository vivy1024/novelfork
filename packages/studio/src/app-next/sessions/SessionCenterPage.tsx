import type { RuntimeNarratorClient } from "../runtime/runtime-narrator-client";
import { SessionCenter } from "../../components/sessions/SessionCenter";

export interface SessionCenterPageProps {
  readonly client?: RuntimeNarratorClient;
  readonly initialCreateOpen?: boolean;
  readonly onOpenNarrator: (narratorId: string) => void;
  readonly onChanged?: () => void | Promise<void>;
}

/** Runtime-backed independent narrator management page. */
export function SessionCenterPage({
  client,
  initialCreateOpen,
  onOpenNarrator,
  onChanged,
}: SessionCenterPageProps) {
  return (
    <SessionCenter
      client={client}
      initialCreateOpen={initialCreateOpen}
      onOpenNarrator={onOpenNarrator}
      onChanged={onChanged}
    />
  );
}
