import { useCallback, useMemo, useReducer } from "react";

import { buildAbortEnvelope, buildAckEnvelope, buildMessageEnvelope, type BuildMessageEnvelopeInput } from "./session-actions";
import {
  createInitialAgentConversationRuntimeState,
  getResumeFromSeq,
  reduceSessionEnvelope,
  type SessionServerEnvelope,
} from "./ws-envelope-reducer";

export function useAgentConversationRuntime() {
  const [state, dispatch] = useReducer(reduceSessionEnvelope, undefined, createInitialAgentConversationRuntimeState);

  const applyEnvelope = useCallback((envelope: SessionServerEnvelope) => dispatch(envelope), []);

  return useMemo(
    () => ({
      state,
      applyEnvelope,
      getResumeFromSeq: () => getResumeFromSeq(state),
      buildMessageEnvelope: (input: BuildMessageEnvelopeInput) => buildMessageEnvelope(input),
      buildAckEnvelope,
      buildAbortEnvelope,
    }),
    [applyEnvelope, state],
  );
}
