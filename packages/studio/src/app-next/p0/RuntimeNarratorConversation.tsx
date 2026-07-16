import type { RuntimeNarratorSummary, RuntimeProductClient } from "../runtime/product-contract";
import { RuntimeNarratorPanelMount } from "../runtime/RuntimeNarratorPanelMount";

export interface RuntimeNarratorConversationProps {
  readonly bookId: string;
  readonly narrator: RuntimeNarratorSummary;
  /** Retained for the P0 shell contract; the native panel owns its own API client. */
  readonly client: RuntimeProductClient;
}

/** P0 shell bridge to the shared native NarratorPanel mount. */
export function RuntimeNarratorConversation({
  bookId,
  narrator,
}: RuntimeNarratorConversationProps) {
  return <RuntimeNarratorPanelMount bookId={bookId} narrator={narrator} />;
}
