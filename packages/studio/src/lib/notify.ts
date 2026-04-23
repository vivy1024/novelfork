/**
 * Unified toast helper (Package 6 / 7.3).
 *
 * Contract:
 * - Cascade owns the infrastructure (sonner + `<Toaster />` in `App.tsx`).
 * - Call sites import `notify` from `@/lib/notify` and never touch sonner directly.
 * - Target scenarios (mandatory): recovery state transitions, WebSocket reconnect
 *   success/failure, persistence write failure, permission denials, session reset.
 * - narrafork is responsible for replacing scattered `console.warn` / `alert`
 *   call sites with the appropriate `notify.*` channel.
 *
 * Do not expand this API surface without design review — the five channels
 * below are intentional and match the recovery / operation vocabulary used
 * elsewhere in the studio.
 */
import { toast } from "sonner";

export interface NotifyOptions {
  /** Optional description rendered under the title. */
  description?: string;
  /** Override the default auto-dismiss timeout in ms (sonner default: 4000). */
  duration?: number;
  /** Stable id so a follow-up call can replace the same toast instead of stacking. */
  id?: string | number;
}

function buildPayload({ description, duration, id }: NotifyOptions = {}) {
  const payload: Record<string, unknown> = {};
  if (description !== undefined) payload.description = description;
  if (duration !== undefined) payload.duration = duration;
  if (id !== undefined) payload.id = id;
  return payload;
}

export const notify = {
  success(title: string, options?: NotifyOptions) {
    return toast.success(title, buildPayload(options));
  },
  error(title: string, options?: NotifyOptions) {
    return toast.error(title, buildPayload(options));
  },
  warning(title: string, options?: NotifyOptions) {
    return toast.warning(title, buildPayload(options));
  },
  info(title: string, options?: NotifyOptions) {
    return toast.info(title, buildPayload(options));
  },
  /**
   * Generic message without severity styling. Prefer the typed variants above
   * so severity is carried in the UI, not only in wording.
   */
  message(title: string, options?: NotifyOptions) {
    return toast(title, buildPayload(options));
  },
  /** Dismiss a specific toast by id, or all toasts if no id is provided. */
  dismiss(id?: string | number) {
    return toast.dismiss(id);
  },
};

export type Notify = typeof notify;
