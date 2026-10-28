/**
 * 专注模式：一键收起侧栏与对话栏，只留稿面；再按一次恢复进入前的开合。
 *
 * 只是临时的开合状态：不改 Allotment 存下的三栏宽度（ide-layout-state.ts），
 * 退出后作者拖好的布局原样回来。进入时记下的是「开没开」，不是宽度。
 */

export interface FocusModePanes {
  readonly sidebar: boolean;
  readonly chat: boolean;
}

export interface FocusModeState {
  readonly active: boolean;
  /** 进入专注前的开合；退出时按它恢复。 */
  readonly restore: FocusModePanes | null;
}

export const FOCUS_MODE_IDLE: FocusModeState = { active: false, restore: null };

export function enterFocusMode(
  state: FocusModeState,
  current: FocusModePanes,
): { state: FocusModeState; panes: FocusModePanes } {
  // 已在专注中（比如作者在专注时手动开过某栏又再按进入）：保留最初记下的布局
  const restore = state.active && state.restore ? state.restore : current;
  return { state: { active: true, restore }, panes: { sidebar: false, chat: false } };
}

export function exitFocusMode(state: FocusModeState): { state: FocusModeState; panes: FocusModePanes | null } {
  if (!state.active) return { state: FOCUS_MODE_IDLE, panes: null };
  return { state: FOCUS_MODE_IDLE, panes: state.restore };
}
