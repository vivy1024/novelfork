/**
 * useWorkbenchDialogs — 工作台文件/条目操作的产品内弹层。
 *
 * 取代浏览器原生 confirm/prompt/alert：这些裸弹窗样式与产品脱节、无法本地化、
 * 在打包的桌面 EXE 里表现不一致。这里用项目既有的 shadcn Dialog/Input/Button
 * 提供 Promise 化的 confirm/prompt/alert，调用方只需把
 *   `confirm(...)` → `await dialogs.confirm(...)`
 *   `prompt(...)`  → `await dialogs.prompt(...)`
 *   `alert(...)`   → `await dialogs.alert(...)`
 * 逻辑主体不变。删除类操作保留明确的二次确认语义（危险按钮 + 不可撤销提示）。
 */
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmOptions {
  readonly title: string;
  readonly description?: string;
  /** 确认按钮文案，默认「确认」。 */
  readonly confirmLabel?: string;
  /** 取消按钮文案，默认「取消」。 */
  readonly cancelLabel?: string;
  /** 危险操作（删除等）用醒目危险样式，强化二次确认语义。 */
  readonly destructive?: boolean;
}

interface PromptOptions {
  readonly title: string;
  readonly description?: string;
  /** 输入框初始值。 */
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

interface AlertOptions {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  /** 错误类提示用危险色标题。 */
  readonly destructive?: boolean;
}

type DialogState =
  | { readonly kind: "confirm"; readonly options: ConfirmOptions }
  | { readonly kind: "prompt"; readonly options: PromptOptions }
  | { readonly kind: "alert"; readonly options: AlertOptions }
  | null;

export interface WorkbenchDialogs {
  /** 二次确认；用户确认返回 true，取消/关闭返回 false。 */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 输入弹层；确认返回输入值（已 trim），取消/关闭返回 null。 */
  readonly prompt: (options: PromptOptions) => Promise<string | null>;
  /** 提示弹层；关闭后 resolve。 */
  readonly alert: (options: AlertOptions) => Promise<void>;
  /** 挂载到组件树里的弹层元素。 */
  readonly element: React.ReactNode;
}

export function useWorkbenchDialogs(): WorkbenchDialogs {
  const [state, setState] = useState<DialogState>(null);
  const [inputValue, setInputValue] = useState("");
  // 保存当前打开弹层的 resolve，关闭时按结果回填。
  const resolveRef = useRef<((result: unknown) => void) | null>(null);

  const settle = useCallback((result: unknown) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    resolve?.(result);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current = resolve as (result: unknown) => void;
    setState({ kind: "confirm", options });
  }), []);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    resolveRef.current = resolve as (result: unknown) => void;
    setInputValue(options.defaultValue ?? "");
    setState({ kind: "prompt", options });
  }), []);

  const alert = useCallback((options: AlertOptions) => new Promise<void>((resolve) => {
    resolveRef.current = resolve as (result: unknown) => void;
    setState({ kind: "alert", options });
  }), []);

  const open = state !== null;
  const destructive = state?.kind === "confirm" || state?.kind === "alert"
    ? state.options.destructive === true
    : false;
  // Radix 的 onOpenChange(false)：ESC/点遮罩/关闭按钮统一走「取消」语义。
  const onOpenChange = useCallback((next: boolean) => {
    if (next || !state) return;
    settle(state.kind === "prompt" ? null : state.kind === "confirm" ? false : undefined);
  }, [settle, state]);

  const element = (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {state && (
        <DialogContent className="sm:max-w-sm" data-testid="workbench-dialog">
          <DialogHeader>
            <DialogTitle className={destructive ? "text-destructive" : undefined}>
              {state.options.title}
            </DialogTitle>
            {state.options.description && (
              <DialogDescription>{state.options.description}</DialogDescription>
            )}
          </DialogHeader>

          {state.kind === "prompt" && (
            <Input
              autoFocus
              value={inputValue}
              placeholder={state.options.placeholder}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  settle(inputValue.trim() ? inputValue.trim() : null);
                }
              }}
              data-testid="workbench-dialog-input"
            />
          )}

          <DialogFooter>
            {state.kind !== "alert" && (
              <Button
                variant="outline"
                onClick={() => settle(state.kind === "prompt" ? null : false)}
                data-testid="workbench-dialog-cancel"
              >
                {state.kind === "prompt"
                  ? state.options.cancelLabel ?? "取消"
                  : (state.options as ConfirmOptions).cancelLabel ?? "取消"}
              </Button>
            )}
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={state.kind === "prompt" && inputValue.trim().length === 0}
              onClick={() => {
                if (state.kind === "confirm") settle(true);
                else if (state.kind === "prompt") settle(inputValue.trim() ? inputValue.trim() : null);
                else settle(undefined);
              }}
              data-testid="workbench-dialog-confirm"
            >
              {state.kind === "prompt"
                ? state.options.confirmLabel ?? "确定"
                : state.kind === "confirm"
                  ? state.options.confirmLabel ?? "确认"
                  : state.options.confirmLabel ?? "知道了"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

  return { confirm, prompt, alert, element };
}
