import { runAgentTurn, type AgentTurnEvent, type AgentTurnRuntimeInput } from "./agent-turn-runtime.js";
import { runtimeEventsFromAgentTurnEvent, type RuntimeEvent } from "./runtime-events.js";

export interface RuntimeTurnExecutionOptions {
  readonly turnId?: string;
  readonly ephemeral?: boolean;
}

export interface RuntimeTurnExecutionResult {
  readonly agentEvents: readonly AgentTurnEvent[];
  readonly runtimeEvents: readonly RuntimeEvent[];
}

export async function executeRuntimeTurn(
  input: AgentTurnRuntimeInput,
  options: RuntimeTurnExecutionOptions = {},
): Promise<RuntimeTurnExecutionResult> {
  const agentEvents = await runAgentTurn(input);
  const runtimeEvents = agentEvents.flatMap((event) => runtimeEventsFromAgentTurnEvent(event, {
    sessionId: input.sessionId,
    ...(options.turnId ? { turnId: options.turnId } : {}),
    ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
  }));

  return { agentEvents, runtimeEvents };
}
