export type CapabilityStatus = "current" | "process-memory" | "prompt-preview" | "chunked-buffer" | "unsupported" | "planned";

export interface CapabilityUiDecision {
  enabled: boolean;
  disabled: boolean;
  readonly: boolean;
  previewOnly: boolean;
  errorVisible: boolean;
  recoveryNoteVisible: boolean;
  allowsFetch: boolean;
  allowsFormalWrite: boolean;
  allowedActions: string[];
  recoveryNote?: string;
}

export interface BackendCapability {
  id: string;
  status: CapabilityStatus;
  ui: CapabilityUiDecision;
}

const CURRENT_ACTIONS = ["read", "write", "delete", "apply"];
const PREVIEW_ACTIONS = ["preview", "copy", "convert-to-candidate", "convert-to-draft", "explicit-apply"];

export function getCapabilityUiDecision(status: CapabilityStatus): CapabilityUiDecision {
  switch (status) {
    case "current":
      return {
        enabled: true,
        disabled: false,
        readonly: false,
        previewOnly: false,
        errorVisible: true,
        recoveryNoteVisible: false,
        allowsFetch: true,
        allowsFormalWrite: true,
        allowedActions: CURRENT_ACTIONS,
      };
    case "process-memory":
      return {
        enabled: true,
        disabled: false,
        readonly: false,
        previewOnly: false,
        errorVisible: true,
        recoveryNoteVisible: true,
        recoveryNote: "该能力包含进程内存状态，刷新或重启后需按后端事实恢复。",
        allowsFetch: true,
        allowsFormalWrite: true,
        allowedActions: CURRENT_ACTIONS,
      };
    case "prompt-preview":
      return {
        enabled: true,
        disabled: false,
        readonly: true,
        previewOnly: true,
        errorVisible: true,
        recoveryNoteVisible: false,
        allowsFetch: true,
        allowsFormalWrite: false,
        allowedActions: PREVIEW_ACTIONS,
      };
    case "chunked-buffer":
      return {
        enabled: true,
        disabled: false,
        readonly: false,
        previewOnly: false,
        errorVisible: true,
        recoveryNoteVisible: true,
        recoveryNote: "该流式体验来自完整结果后的分块缓冲，不代表上游原生流式。",
        allowsFetch: true,
        allowsFormalWrite: true,
        allowedActions: CURRENT_ACTIONS,
      };
    case "unsupported":
      return {
        enabled: false,
        disabled: true,
        readonly: true,
        previewOnly: false,
        errorVisible: true,
        recoveryNoteVisible: false,
        allowsFetch: false,
        allowsFormalWrite: false,
        allowedActions: [],
      };
    case "planned":
      return {
        enabled: false,
        disabled: true,
        readonly: true,
        previewOnly: false,
        errorVisible: false,
        recoveryNoteVisible: false,
        allowsFetch: false,
        allowsFormalWrite: false,
        allowedActions: [],
      };
  }
}

export function normalizeCapability(capability?: { id?: string; status?: CapabilityStatus }): BackendCapability {
  const status = capability?.status ?? "current";

  return {
    id: capability?.id ?? "unknown",
    status,
    ui: getCapabilityUiDecision(status),
  };
}

export function isCapabilityInteractive(status: CapabilityStatus): boolean {
  return getCapabilityUiDecision(status).enabled && !getCapabilityUiDecision(status).disabled;
}
