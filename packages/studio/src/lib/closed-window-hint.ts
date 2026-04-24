/**
 * First-run hint shown the first time a populated ChatWindow is closed.
 *
 * Extracted from `ChatWindow.handleClose` so both the window header's close
 * button and the SessionCenter card's "关闭窗口" ghost button can emit the
 * same "会话仍保留" reassurance toast. Without this shared helper, users who
 * habitually close windows from SessionCenter cards would never see the hint
 * and could think closing a window destroys the session.
 *
 * The hint is gated by a localStorage flag so it fires at most once per
 * browser profile; access is wrapped in try/catch because embedded /
 * file:// runtimes (e.g. the packaged .exe before web permissions are
 * granted) can throw on `localStorage` access.
 */
import { notify } from "@/lib/notify";

const HINT_KEY = "closed-window-hint-shown";

/**
 * In-memory duplicate of the localStorage flag. Kept because some embedding
 * modes (file:// packaged exe, locked-down PWA contexts, test envs with a
 * broken storage backend) throw on both `getItem` and `setItem`. Without this
 * module-level cache the hint would fire on every close in those envs — the
 * opposite of "first-run only".
 */
let hintShownInMemory = false;

function readFlag(): boolean {
  if (hintShownInMemory) return true;
  try {
    return localStorage.getItem(HINT_KEY) !== null;
  } catch {
    return false;
  }
}

function writeFlag(): void {
  hintShownInMemory = true;
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Persistent storage is best-effort; the in-memory flag still prevents
    // re-nagging within the current session.
  }
}

export interface MaybeShowClosedWindowHintOptions {
  /**
   * Whether the window being closed actually carries user content. Empty
   * windows (opened and immediately closed) do not trigger the hint — it
   * would feel nagging.
   */
  readonly hasContent: boolean;
}

export function maybeShowClosedWindowHint({ hasContent }: MaybeShowClosedWindowHintOptions): void {
  if (!hasContent) return;
  if (readFlag()) return;
  notify.info("窗口已关闭", {
    description: "会话仍在会话中心，随时可重新打开",
    duration: 4000,
  });
  writeFlag();
}

/** Test-only helper: clears both the in-memory and persisted flag. */
export function resetClosedWindowHintForTests(): void {
  hintShownInMemory = false;
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    // ignore
  }
}
