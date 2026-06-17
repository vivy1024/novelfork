/**
 * Peer Messaging — inter-subagent communication bus.
 *
 * Allows subagents spawned from the same parent session to exchange
 * messages. This enables coordination patterns like:
 * - One agent discovers information another needs
 * - A coordinator distributes work and collects results
 * - Agents signal completion or request help
 *
 * Architecture:
 * - Messages are stored in a per-parent-session mailbox
 * - Each subagent has an inbox identified by its agentId
 * - Messages are consumed (removed) when read
 * - TTL prevents mailbox from growing unbounded
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface PeerMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Mailbox {
  messages: PeerMessage[];
  lastAccess: number;
}

export interface PeerMessagingHub {
  /** Send a message from one agent to another */
  send(from: string, to: string, content: string, metadata?: Record<string, unknown>): PeerMessage;
  /** Send a message to ALL agents in the session (broadcast) */
  broadcast(from: string, content: string, metadata?: Record<string, unknown>): PeerMessage[];
  /** Read and consume all pending messages for an agent */
  receive(agentId: string): PeerMessage[];
  /** Peek at pending messages without consuming them */
  peek(agentId: string): PeerMessage[];
  /** Check if an agent has pending messages */
  hasPending(agentId: string): boolean;
  /** Get all known agent IDs in this hub */
  getAgentIds(): string[];
  /** Clear expired messages (older than TTL) */
  cleanup(): number;
  /** Get stats */
  stats(): { totalMessages: number; agentCount: number; oldestMessageAge: number };
}

// ── Constants ────────────────────────────────────────────────────────────

const MESSAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MESSAGES_PER_AGENT = 50;

// ── Implementation ───────────────────────────────────────────────────────

let messageCounter = 0;

function generateMessageId(): string {
  messageCounter++;
  return `msg_${Date.now().toString(36)}_${messageCounter.toString(36)}`;
}

export function createPeerMessagingHub(): PeerMessagingHub {
  const mailboxes = new Map<string, Mailbox>();

  function getOrCreateMailbox(agentId: string): Mailbox {
    let box = mailboxes.get(agentId);
    if (!box) {
      box = { messages: [], lastAccess: Date.now() };
      mailboxes.set(agentId, box);
    }
    return box;
  }

  return {
    send(from: string, to: string, content: string, metadata?: Record<string, unknown>): PeerMessage {
      const msg: PeerMessage = {
        id: generateMessageId(),
        from,
        to,
        content,
        timestamp: Date.now(),
        metadata,
      };

      const box = getOrCreateMailbox(to);
      box.messages.push(msg);

      // Enforce per-agent limit (drop oldest)
      if (box.messages.length > MAX_MESSAGES_PER_AGENT) {
        box.messages = box.messages.slice(-MAX_MESSAGES_PER_AGENT);
      }

      // Ensure sender is known
      getOrCreateMailbox(from);

      return msg;
    },

    broadcast(from: string, content: string, metadata?: Record<string, unknown>): PeerMessage[] {
      const sent: PeerMessage[] = [];
      for (const agentId of mailboxes.keys()) {
        if (agentId === from) continue; // don't send to self
        sent.push(this.send(from, agentId, content, metadata));
      }
      return sent;
    },

    receive(agentId: string): PeerMessage[] {
      const box = mailboxes.get(agentId);
      if (!box || box.messages.length === 0) return [];

      const messages = [...box.messages];
      box.messages = [];
      box.lastAccess = Date.now();
      return messages;
    },

    peek(agentId: string): PeerMessage[] {
      const box = mailboxes.get(agentId);
      return box ? [...box.messages] : [];
    },

    hasPending(agentId: string): boolean {
      const box = mailboxes.get(agentId);
      return Boolean(box && box.messages.length > 0);
    },

    getAgentIds(): string[] {
      return [...mailboxes.keys()];
    },

    cleanup(): number {
      const now = Date.now();
      let removed = 0;

      for (const [agentId, box] of mailboxes) {
        const before = box.messages.length;
        box.messages = box.messages.filter(m => now - m.timestamp < MESSAGE_TTL_MS);
        removed += before - box.messages.length;

        // Remove empty mailboxes that haven't been accessed recently
        if (box.messages.length === 0 && now - box.lastAccess > MESSAGE_TTL_MS) {
          mailboxes.delete(agentId);
        }
      }

      return removed;
    },

    stats(): { totalMessages: number; agentCount: number; oldestMessageAge: number } {
      let totalMessages = 0;
      let oldestTimestamp = Date.now();

      for (const box of mailboxes.values()) {
        totalMessages += box.messages.length;
        for (const msg of box.messages) {
          if (msg.timestamp < oldestTimestamp) oldestTimestamp = msg.timestamp;
        }
      }

      return {
        totalMessages,
        agentCount: mailboxes.size,
        oldestMessageAge: totalMessages > 0 ? Date.now() - oldestTimestamp : 0,
      };
    },
  };
}

// ── Global Registry (per parent session) ─────────────────────────────────

const hubs = new Map<string, PeerMessagingHub>();

/**
 * Get or create a peer messaging hub for a parent session.
 */
export function getSessionHub(parentSessionId: string): PeerMessagingHub {
  let hub = hubs.get(parentSessionId);
  if (!hub) {
    hub = createPeerMessagingHub();
    hubs.set(parentSessionId, hub);
  }
  return hub;
}

/**
 * Remove a session's hub (called when session is destroyed).
 */
export function destroySessionHub(parentSessionId: string): void {
  hubs.delete(parentSessionId);
}

/**
 * Cleanup all hubs (remove expired messages).
 */
export function cleanupAllHubs(): number {
  let totalRemoved = 0;
  for (const hub of hubs.values()) {
    totalRemoved += hub.cleanup();
  }
  return totalRemoved;
}
