import { useState } from "react";
import { HelpCircle, Send, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ConversationConfirmation, ConversationConfirmationQuestion } from "./ConfirmationGate";

export interface UserQuestionGateProps {
  confirmation: ConversationConfirmation;
  onSubmitAnswers: (id: string, answers: Record<string, unknown>) => void;
  onSkip: (id: string) => void;
}

function QuestionInput({ question, value, onChange }: {
  question: ConversationConfirmationQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (question.type) {
    case "single":
      return (
        <div className="space-y-1.5">
          {question.options?.map((option) => (
            <label key={option} className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                className="size-3.5 accent-primary"
              />
              <span className="text-sm">{option}</span>
            </label>
          ))}
        </div>
      );

    case "multi":
      return (
        <div className="space-y-1.5">
          {question.options?.map((option) => {
            const selected = Array.isArray(value) ? value.includes(option) : false;
            return (
              <label key={option} className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const current = Array.isArray(value) ? value : [];
                    onChange(selected ? current.filter((v) => v !== option) : [...current, option]);
                  }}
                  className="size-3.5 accent-primary"
                />
                <span className="text-sm">{option}</span>
              </label>
            );
          })}
        </div>
      );

    case "ranged-number":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="输入数字"
          className="max-w-32"
        />
      );

    case "ai-suggest":
      return (
        <Textarea
          value={typeof value === "string" ? value : (question.aiSuggestion ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={question.aiSuggestion ?? "输入你的回答..."}
          className="text-sm"
        />
      );

    case "text":
    default:
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="输入你的回答..."
          className="text-sm"
        />
      );
  }
}

export function UserQuestionGate({ confirmation, onSubmitAnswers, onSkip }: UserQuestionGateProps) {
  const questions = confirmation.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const q of questions) {
      if (q.type === "ai-suggest" && q.aiSuggestion) {
        initial[q.id] = q.aiSuggestion;
      }
    }
    return initial;
  });

  const requiredUnanswered = questions.filter((q) => q.required && !answers[q.id]);
  const canSubmit = requiredUnanswered.length === 0 && !confirmation.busy;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmitAnswers(confirmation.id, answers);
  }

  if (questions.length === 0) {
    return (
      <aside data-testid="user-question-gate" className="rounded-lg border border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950/30">
        <div className="flex items-center gap-3">
          <HelpCircle className="size-5 text-blue-600 dark:text-blue-400" />
          <p className="text-sm text-muted-foreground">暂无需要回答的问题。</p>
          <Button size="sm" variant="outline" onClick={() => onSkip(confirmation.id)}>
            继续
          </Button>
        </div>
      </aside>
    );
  }

  return (
    <aside data-testid="user-question-gate" className="rounded-lg border border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950/30 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 size-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">{confirmation.title === "pgi.generate_questions" ? "生成前追问" : confirmation.title}</h3>
          {confirmation.summary && <p className="text-xs text-muted-foreground mt-0.5">{confirmation.summary}</p>}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-4 pl-8">
        {questions.map((question, index) => (
          <div key={question.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="shrink-0 size-5 rounded-full bg-blue-500/10 text-blue-600 text-[10px] font-medium flex items-center justify-center mt-0.5">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{question.prompt}</p>
                {question.reason && <p className="text-[11px] text-muted-foreground mt-0.5">{question.reason}</p>}
                {question.required && <span className="text-[10px] text-red-500">必填</span>}
              </div>
            </div>
            <div className="pl-7">
              <QuestionInput
                question={question}
                value={answers[question.id]}
                onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pl-8 pt-1">
        <Button
          size="sm"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="inline-flex items-center gap-1"
        >
          <Send className="size-3" />
          提交回答
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={confirmation.busy}
          onClick={() => onSkip(confirmation.id)}
          className="inline-flex items-center gap-1 text-muted-foreground"
        >
          <SkipForward className="size-3" />
          跳过
        </Button>
        {confirmation.busy && <span className="text-[10px] text-muted-foreground">处理中...</span>}
        {confirmation.error && <span className="text-xs text-destructive">{confirmation.error}</span>}
      </div>
    </aside>
  );
}
