import type { ContractClient } from "./contract-client";

export function createSessionClient(contract: ContractClient) {
  return {
    listActiveSessions: () => contract.get("/api/sessions?sort=recent&status=active", { capability: { id: "sessions.active", status: "current" } }),
    getChatState: (sessionId: string) =>
      contract.get(`/api/sessions/${encodeURIComponent(sessionId)}/chat/state`, { capability: { id: "sessions.chat.state", status: "current" } }),
    getChatHistory: (sessionId: string, sinceSeq?: number) => {
      const query = sinceSeq === undefined ? "" : `?sinceSeq=${encodeURIComponent(String(sinceSeq))}`;
      return contract.get(`/api/sessions/${encodeURIComponent(sessionId)}/chat/history${query}`, { capability: { id: "sessions.chat.history", status: "current" } });
    },
    listPendingTools: (sessionId: string) =>
      contract.get(`/api/sessions/${encodeURIComponent(sessionId)}/tools`, { capability: { id: "sessions.tools.pending", status: "current" } }),
  };
}
