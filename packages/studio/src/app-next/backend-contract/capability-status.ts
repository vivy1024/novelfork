export type CapabilityStatus = "current" | "process-memory" | "prompt-preview" | "chunked-buffer" | "unsupported" | "planned" | "deprecated";

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
  disabledReason?: string;
}

export interface BackendCapability {
  id: string;
  status: CapabilityStatus;
  ui: CapabilityUiDecision;
  metadata?: Record<string, unknown>;
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
        disabledReason: "当前后端或模型适配器不支持该能力。",
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
        disabledReason: "该能力仍处于规划状态，当前不可调用。",
        allowsFetch: false,
        allowsFormalWrite: false,
        allowedActions: [],
      };
    case "deprecated":
      return {
        enabled: false,
        disabled: true,
        readonly: true,
        previewOnly: false,
        errorVisible: true,
        recoveryNoteVisible: true,
        recoveryNote: "该能力是 legacy/deprecated 过渡入口，只允许保留既有依赖，不能新增前端调用。",
        disabledReason: "该能力已标记为 deprecated，新前端不可新增依赖。",
        allowsFetch: false,
        allowsFormalWrite: false,
        allowedActions: [],
      };
  }
}

export function normalizeCapability(capability?: { id?: string; status?: CapabilityStatus; metadata?: Record<string, unknown> }): BackendCapability {
  const status = capability?.status ?? "current";

  return {
    id: capability?.id ?? "unknown",
    status,
    ui: getCapabilityUiDecision(status),
    ...(capability?.metadata ? { metadata: capability.metadata } : {}),
  };
}

export function isCapabilityInteractive(status: CapabilityStatus): boolean {
  return getCapabilityUiDecision(status).enabled && !getCapabilityUiDecision(status).disabled;
}
