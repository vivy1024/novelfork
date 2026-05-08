import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import type { RuntimeEvent, RuntimeResultEvent } from "./runtime-events.js";
import type { HeadlessChatCostEnvelope, HeadlessChatUsageEnvelope } from "./session-headless-chat-service.js";

export type RuntimeStreamJsonStopReason = RuntimeResultEvent["stop_reason"];

export type RuntimeStreamJsonEvent =
  | { readonly type: "user_message"; readonly session_id: string; readonly content: string; readonly ephemeral: boolean }
  | { readonly type: "assistant_delta"; readonly session_id: string; readonly delta: string; readonly ephemeral: boolean }
  | { readonly type: "assistant_message"; readonly session_id: string; readonly content: string; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "tool_use"; readonly session_id: string; readonly tool_use_id: string; readonly tool_name: string; readonly input: Record<string, unknown>; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "tool_result"; readonly session_id: string; readonly tool_use_id: string; readonly tool_name: string; readonly result: SessionToolExecutionResult; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "permission_request"; readonly session_id: string; readonly confirmation_id: string; readonly tool_name: string; readonly confirmation?: unknown; readonly result: SessionToolExecutionResult; readonly source_tool_use_id?: string; readonly ephemeral: boolean }
  | { readonly type: "checkpoint_created"; readonly session_id: string; readonly checkpoint_id: string; readonly paths: readonly string[]; readonly source_tool_use_id?: string; readonly ephemeral: boolean }
  | { readonly type: "candidate_created"; readonly session_id: string; readonly candidate_id: string; readonly artifact: unknown; readonly source_tool_use_id?: string; readonly ephemeral: boolean }
  | { readonly type: "resource_updated"; readonly session_id: string; readonly resource: unknown; readonly source_event: "checkpoint_created" | "candidate_created"; readonly source_id: string; readonly ephemeral: boolean }
  | { readonly type: "usage_delta"; readonly session_id: string; readonly usage: unknown; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "command_started"; readonly session_id: string; readonly command_id: string; readonly command_name: string; readonly raw: string; readonly args: string; readonly ephemeral: boolean }
  | { readonly type: "command_completed"; readonly session_id: string; readonly command_id: string; readonly command_name: string; readonly raw: string; readonly args: string; readonly result: unknown; readonly ephemeral: boolean }
  | { readonly type: "command_error"; readonly session_id: string; readonly command_id?: string; readonly command_name?: string; readonly raw: string; readonly args?: string; readonly code: string; readonly message: string; readonly ephemeral: boolean }
  | { readonly type: "error"; readonly session_id: string; readonly code: string; readonly message: string; readonly data?: unknown; readonly ephemeral: boolean }
  | { readonly type: "result"; readonly session_id: string; readonly success: boolean; readonly stop_reason: RuntimeStreamJsonStopReason; readonly exit_code: number; readonly final_message?: string; readonly error?: string; readonly pending_confirmation?: { readonly id: string; readonly toolName: string }; readonly ephemeral: boolean; readonly duration_ms?: number; readonly usage?: HeadlessChatUsageEnvelope; readonly cost?: HeadlessChatCostEnvelope; readonly permission_denials?: readonly unknown[]; readonly runtime_capabilities?: readonly unknown[] };

export interface RuntimeStreamJsonOptions {
  readonly ephemeral?: boolean;
}

function ephemeralFor(event: RuntimeEvent, options: RuntimeStreamJsonOptions): boolean {
  return options.ephemeral ?? event.ephemeral ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateResource(artifact: unknown): unknown | null {
  return isRecord(artifact) && "resourceRef" in artifact ? artifact.resourceRef : null;
}

export function runtimeEventsToStreamJsonEvents(events: readonly RuntimeEvent[], options: RuntimeStreamJsonOptions = {}): RuntimeStreamJsonEvent[] {
  const output: RuntimeStreamJsonEvent[] = [];
  for (const event of events) {
    const ephemeral = ephemeralFor(event, options);
    switch (event.type) {
      case "message":
        if (event.role === "user") {
          output.push({ type: "user_message", session_id: event.session_id, content: event.content, ephemeral });
        } else if (event.role === "assistant") {
          output.push({ type: "assistant_message", session_id: event.session_id, content: event.content, ...(event.runtime ? { runtime: event.runtime } : {}), ephemeral });
        }
        break;
      case "assistant_delta":
        output.push({ type: "assistant_delta", session_id: event.session_id, delta: event.delta, ephemeral });
        break;
      case "tool_use":
        output.push({ type: "tool_use", session_id: event.session_id, tool_use_id: event.tool_use_id, tool_name: event.tool_name, input: event.input, ...(event.runtime ? { runtime: event.runtime } : {}), ephemeral });
        break;
      case "tool_result":
        output.push({ type: "tool_result", session_id: event.session_id, tool_use_id: event.tool_use_id, tool_name: event.tool_name, result: event.result, ...(event.runtime ? { runtime: event.runtime } : {}), ephemeral });
        break;
      case "permission_request":
        output.push({ type: "permission_request", session_id: event.session_id, confirmation_id: event.confirmation_id, tool_name: event.tool_name, ...(event.confirmation ? { confirmation: event.confirmation } : {}), result: event.result, ephemeral });
        break;
      case "checkpoint":
        output.push({ type: "checkpoint_created", session_id: event.session_id, checkpoint_id: event.checkpoint_id, paths: event.paths, ...(event.source_tool_use_id ? { source_tool_use_id: event.source_tool_use_id } : {}), ephemeral });
        for (const path of event.paths) {
          output.push({ type: "resource_updated", session_id: event.session_id, resource: { kind: "path", path }, source_event: "checkpoint_created", source_id: event.checkpoint_id, ephemeral });
        }
        break;
      case "candidate": {
        output.push({ type: "candidate_created", session_id: event.session_id, candidate_id: event.candidate_id, artifact: event.artifact, ...(event.source_tool_use_id ? { source_tool_use_id: event.source_tool_use_id } : {}), ephemeral });
        const resource = candidateResource(event.artifact);
        if (resource) output.push({ type: "resource_updated", session_id: event.session_id, resource, source_event: "candidate_created", source_id: event.candidate_id, ephemeral });
        break;
      }
      case "usage":
        output.push({ type: "usage_delta", session_id: event.session_id, usage: event.usage, ...(event.runtime ? { runtime: event.runtime } : {}), ephemeral });
        break;
      case "command_started":
        output.push({ type: "command_started", session_id: event.session_id, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args, ephemeral });
        break;
      case "command_completed":
        output.push({ type: "command_completed", session_id: event.session_id, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args, result: event.result, ephemeral });
        break;
      case "command_error":
        output.push({ type: "command_error", session_id: event.session_id, ...(event.command_id ? { command_id: event.command_id } : {}), ...(event.command_name ? { command_name: event.command_name } : {}), raw: event.raw, ...(event.args !== undefined ? { args: event.args } : {}), code: event.code, message: event.message, ephemeral });
        break;
      case "error":
        output.push({ type: "error", session_id: event.session_id, code: event.code, message: event.message, ...(event.data ? { data: event.data } : {}), ephemeral });
        break;
      case "result":
        output.push({
          type: "result",
          session_id: event.session_id,
          success: event.success,
          stop_reason: event.stop_reason,
          exit_code: event.exit_code,
          ...(event.final_message ? { final_message: event.final_message } : {}),
          ...(event.error ? { error: event.error } : {}),
          ...(event.pending_confirmation ? { pending_confirmation: event.pending_confirmation } : {}),
          ephemeral,
          ...(event.duration_ms !== undefined ? { duration_ms: event.duration_ms } : {}),
          ...(event.usage ? { usage: event.usage } : {}),
          ...(event.cost ? { cost: event.cost } : {}),
          ...(event.permission_denials ? { permission_denials: event.permission_denials } : {}),
          ...(event.runtime_capabilities ? { runtime_capabilities: event.runtime_capabilities } : {}),
        });
        break;
    }
  }
  return output;
}

export function encodeRuntimeStreamJsonEventsAsNdjson(events: readonly RuntimeStreamJsonEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}
