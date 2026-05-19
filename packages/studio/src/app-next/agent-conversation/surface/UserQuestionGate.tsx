import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle, Send, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ConversationConfirmation, ConversationConfirmationQuestion, ConversationConfirmationQuestionOption } from "./ConfirmationGate";

export interface UserQuestionGateProps {
  confirmation: ConversationConfirmation;
  onSubmitAnswers: (id: string, answers: Record<string, unknown>) => void;
  onSkip: (id: string) => void;
}

/** 从 option 中提取 label */
function getOptionLabel(option: string | ConversationConfirmationQuestionOption): string {
  return typeof option === "string" ? option : option.label;
}

/** 从 option 中提取 description */
function getOptionDescription(option: string | ConversationConfirmationQuestionOption): string | undefined {
  return typeof option === "string" ? undefined : option.description;
}

const OTHER_LABEL = "其他";

function QuestionGroup({ question, value, customText, onSelect, onCustomTextChange }: {
  question: ConversationConfirmationQuestion;
  value: unknown;
  customText: string;
  onSelect: (value: unknown) => void;
  onCustomTextChange: (text: string) => void;
}) {
  const options = question.options ?? [];

  if (question.type === "text" || question.type === "ai-suggest") {
    return (
      <div className="space-y-2">
        <textarea
          value={typeof value === "string" ? value : (question.aiSuggestion ?? "")}
          onChange={(e) => onSelect(e.target.value)}
          rows={3}
          placeholder={question.aiSuggestion ?? "输入你的回答..."}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
    );
  }

  if (question.type === "ranged-number") {
    return (
      <div className="space-y-2">
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="输入数字"
          className="max-w-32 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
    );
  }

  // 默认多选
  const isMulti = true;
  const hasOtherInOptions = options.some((o) => getOptionLabel(o) === OTHER_LABEL);
  const isOtherSelected = isMulti
    ? (Array.isArray(value) ? value.includes(OTHER_LABEL) : false)
    : value === OTHER_LABEL;

  return (
    <div className="space-y-1.5">
      {options.map((option) => {
        const label = getOptionLabel(option);
        const description = getOptionDescription(option);
        const isSelected = isMulti
          ? (Array.isArray(value) ? value.includes(label) : false)
          : value === label;

        return (
          <label
            key={label}
            className={`flex items-start gap-2.5 cursor-pointer rounded-md px-2.5 py-2 transition-colors ${
              isSelected
                ? "bg-blue-50 dark:bg-blue-900/30"
                : "hover:bg-muted/50"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {isMulti ? (
                <div className={`size-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${
                  isSelected
                    ? "border-blue-500 bg-blue-500"
                    : "border-muted-foreground/40"
                }`}>
                  {isSelected && (
                    <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              ) : (
                <div className={`size-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isSelected ? "border-blue-500" : "border-muted-foreground/40"
                }`}>
                  {isSelected && <div className="size-1.5 rounded-full bg-blue-500" />}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-foreground">{label}</span>
              {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
            </div>
            <input
              type={isMulti ? "checkbox" : "radio"}
              name={question.id}
              value={label}
              checked={isSelected}
              onChange={() => {
                if (isMulti) {
                  const current = Array.isArray(value) ? value : [];
                  onSelect(isSelected ? current.filter((v) => v !== label) : [...current, label]);
                } else {
                  onSelect(label);
                }
              }}
              className="sr-only"
            />
          </label>
        );
      })}

      {/* "其他" 选项 */}
      {!hasOtherInOptions && (
        <label
          className={`flex items-start gap-2.5 cursor-pointer rounded-md px-2.5 py-2 transition-colors ${
            isOtherSelected ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-muted/50"
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {isMulti ? (
              <div className={`size-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${
                isOtherSelected ? "border-blue-500 bg-blue-500" : "border-muted-foreground/40"
              }`}>
                {isOtherSelected && (
                  <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            ) : (
              <div className={`size-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                isOtherSelected ? "border-blue-500" : "border-muted-foreground/40"
              }`}>
                {isOtherSelected && <div className="size-1.5 rounded-full bg-blue-500" />}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-foreground">{OTHER_LABEL}</span>
          </div>
          <input
            type={isMulti ? "checkbox" : "radio"}
            name={question.id}
            value={OTHER_LABEL}
            checked={isOtherSelected}
            onChange={() => {
              if (isMulti) {
                const current = Array.isArray(value) ? value : [];
                onSelect(isOtherSelected ? current.filter((v) => v !== OTHER_LABEL) : [...current, OTHER_LABEL]);
              } else {
                onSelect(OTHER_LABEL);
              }
            }}
            className="sr-only"
          />
        </label>
      )}

      {/* Custom text input */}
      {isOtherSelected && (
        <input
          type="text"
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="请输入自定义回答..."
          autoFocus
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      )}
    </div>
  );
}

export function UserQuestionGate({ confirmation, onSubmitAnswers, onSkip }: UserQuestionGateProps) {
  const questions = confirmation.questions ?? [];
  const [expanded, setExpanded] = useState(true);
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const q of questions) {
      if (q.type === "ai-suggest" && q.aiSuggestion) {
        initial[q.id] = q.aiSuggestion;
      }
    }
    return initial;
  });
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});

  const canSubmit = !confirmation.busy && questions.every((q) => {
    if (!q.required) return true;
    const answer = answers[q.id];
    const custom = customTexts[q.id]?.trim();
    if (answer === OTHER_LABEL) return !!custom;
    if (Array.isArray(answer) && answer.includes(OTHER_LABEL)) return !!custom;
    if (answer !== undefined && answer !== null && answer !== "") {
      if (Array.isArray(answer)) return answer.length > 0;
      return true;
    }
    return !!custom;
  });

  function handleSubmit() {
    if (!canSubmit) return;
    const merged: Record<string, unknown> = {};
    for (const q of questions) {
      const answer = answers[q.id];
      const custom = customTexts[q.id]?.trim();
      if (answer === OTHER_LABEL && custom) {
        merged[q.id] = custom;
      } else if (Array.isArray(answer) && answer.includes(OTHER_LABEL) && custom) {
        merged[q.id] = answer.map((v) => v === OTHER_LABEL ? custom : v);
      } else if (answer !== undefined && answer !== null && answer !== "") {
        merged[q.id] = answer;
      } else if (custom) {
        merged[q.id] = custom;
      }
    }
    onSubmitAnswers(confirmation.id, merged);
  }

  function handleAutoAnswer() {
    onSubmitAnswers(confirmation.id, { __auto: true });
  }

  if (questions.length === 0) {
    return (
      <aside data-testid="user-question-gate" className="my-1 rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <HelpCircle className="size-4 text-purple-500 shrink-0" />
          <span className="text-xs font-semibold font-mono text-purple-600 dark:text-purple-400">AskUserQuestion</span>
          <span className="text-xs text-muted-foreground">暂无问题</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => onSkip(confirmation.id)}>继续</Button>
        </div>
      </aside>
    );
  }

  // 统计已回答数
  const answeredCount = questions.filter((q) => {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") return false;
    if (Array.isArray(a)) return a.length > 0;
    return true;
  }).length;

  return (
    <aside data-testid="user-question-gate" className="my-1 rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden tool-card-running">
      {/* Card Header — 工具卡片风格 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <span className="inline-flex items-center justify-center size-5 rounded-full bg-purple-100 dark:bg-purple-900/40 shrink-0">
          <HelpCircle className="size-3 text-purple-600 dark:text-purple-400" />
        </span>
        <span className="text-xs font-semibold font-mono text-purple-600 dark:text-purple-400 shrink-0">
          AskUserQuestion
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {questions.length} 个问题待回答
        </span>
        {answeredCount > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{answeredCount}/{questions.length}</Badge>
        )}
        <span className="flex-1" />
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
      </button>

      {/* Card Body — 问题表单 */}
      {expanded && (
        <div className="border-t border-blue-100 dark:border-blue-900/50 max-h-[60vh] overflow-y-auto">
          <div className="p-3 space-y-4">
            {questions.map((question) => (
              <div key={question.id} className="space-y-1.5">
                <div className="space-y-0.5">
                  {question.header && (
                    <span className="inline-block text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded-full">
                      {question.header}
                    </span>
                  )}
                  <p className="text-xs font-semibold text-foreground">{question.prompt}</p>
                  {question.reason && (
                    <p className="text-[11px] text-muted-foreground">{question.reason}</p>
                  )}
                </div>
                <QuestionGroup
                  question={question}
                  value={answers[question.id]}
                  customText={customTexts[question.id] ?? ""}
                  onSelect={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                  onCustomTextChange={(text) => setCustomTexts((prev) => ({ ...prev, [question.id]: text }))}
                />
              </div>
            ))}
          </div>

          {/* Action buttons — 固定在底部 */}
          <div className="sticky bottom-0 flex items-center gap-2 border-t border-blue-100 dark:border-blue-900/50 bg-background/95 backdrop-blur-sm px-3 py-2">
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs"
            >
              <Send className="size-3" />
              提交
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirmation.busy}
              onClick={handleAutoAnswer}
              className="inline-flex items-center gap-1.5 h-7 text-xs"
            >
              <Sparkles className="size-3" />
              帮我回答
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={confirmation.busy}
              onClick={() => onSkip(confirmation.id)}
              className="inline-flex items-center gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 h-7 text-xs"
            >
              <SkipForward className="size-3" />
              跳过
            </Button>
            {confirmation.busy && <span className="text-[10px] text-muted-foreground ml-1">处理中...</span>}
            {confirmation.error && <span className="text-[10px] text-destructive ml-1">{confirmation.error}</span>}
          </div>
        </div>
      )}
    </aside>
  );
}
