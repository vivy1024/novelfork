import { useMemo, useState } from "react";

import { AiModelRequiredDialog } from "@/components/ai/AiModelRequiredDialog";
import { useAiModelGate } from "@/hooks/use-ai-model-gate";
import { postApi } from "../../hooks/use-api";

export interface QuestionnaireQuestionView {
  id: string;
  prompt: string;
  type: "single" | "multi" | "text" | "ranged-number" | "ai-suggest";
  options?: string[];
  mapping: { fieldPath: string; transform?: string };
  defaultSkippable: boolean;
}

export interface QuestionnaireTemplateView {
  id: string;
  tier: 1 | 2 | 3;
  targetObject: string;
  questions: QuestionnaireQuestionView[];
}

export interface QuestionnaireWizardProps {
  bookId: string;
  template: QuestionnaireTemplateView;
  initialAnswers?: Record<string, unknown>;
  onConfigureModel?: () => void;
  onDone?: (response: { id?: string; status: "draft" | "submitted" | "skipped" }) => void;
}

function answerToString(value: unknown): string {
  if (Array.isArray(value)) return value.join("，");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function QuestionnaireWizard({
  bookId,
  template,
  initialAnswers = {},
  onConfigureModel,
  onDone,
}: QuestionnaireWizardProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  const [loading, setLoading] = useState(false);
  const [suggestionReason, setSuggestionReason] = useState<string | null>(null);
  const { ensureModelFor, blockedResult, closeGate } = useAiModelGate();
  const question = template.questions[step];
  const total = template.questions.length;
  const canGoBack = step > 0;
  const isLast = step === total - 1;
  const responseId = useMemo(() => crypto.randomUUID(), []);

  if (!question) return null;

  const updateAnswer = (value: unknown) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
  };

  const submit = async (status: "draft" | "submitted" | "skipped") => {
    setLoading(true);
    try {
      const result = await postApi<{ response: { id?: string; status: "draft" | "submitted" | "skipped" } }>(`/books/${bookId}/questionnaires/${template.id}/responses`, {
        id: responseId,
        status,
        answers,
      });
      onDone?.(result.response);
    } finally {
      setLoading(false);
    }
  };

  const requestSuggestion = async () => {
    if (!ensureModelFor("generate-jingwei")) {
      return;
    }
    setLoading(true);
    try {
      const result = await postApi<{ suggestion: { answer: string; reason: string } }>(`/books/${bookId}/questionnaires/${template.id}/ai-suggest`, {
        questionId: question.id,
        existingAnswers: answers,
      });
      if (result.suggestion.answer) updateAnswer(result.suggestion.answer);
      setSuggestionReason(result.suggestion.reason);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border/50 bg-background/80 p-4">
      <div className="flex items-center justify-between text-sm">
        <div className="font-bold">第 {step + 1} / {total} 题</div>
        <div className="text-muted-foreground">Tier {template.tier} · {template.targetObject}</div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>

      <div className="space-y-2">
        <label htmlFor={`question-${question.id}`} className="block text-sm font-semibold text-foreground">{question.prompt}</label>
        {question.type === "single" && question.options ? (
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => updateAnswer(option)}
                className={`rounded-lg border px-3 py-2 text-sm ${answers[question.id] === option ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-secondary/40 text-foreground"}`}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <textarea
            id={`question-${question.id}`}
            value={answerToString(answers[question.id])}
            onChange={(event) => updateAnswer(event.target.value)}
            className="min-h-24 w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
          />
        )}
      </div>

      {suggestionReason && <div className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{suggestionReason}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={!canGoBack || loading} className="rounded-lg border border-border/60 px-3 py-2 text-sm disabled:opacity-50">返回</button>
          <button type="button" onClick={() => void submit("draft")} disabled={loading} className="rounded-lg border border-border/60 px-3 py-2 text-sm disabled:opacity-50">稍后再填</button>
          <button type="button" onClick={() => void submit("skipped")} disabled={loading} className="rounded-lg border border-border/60 px-3 py-2 text-sm disabled:opacity-50">跳过全部</button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void requestSuggestion()} disabled={loading} className="rounded-lg border border-border/60 px-3 py-2 text-sm disabled:opacity-50">AI 建议</button>
          {isLast ? (
            <button type="button" onClick={() => void submit("submitted")} disabled={loading} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">提交问卷</button>
          ) : (
            <button type="button" onClick={() => setStep((value) => Math.min(total - 1, value + 1))} disabled={loading} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">下一题</button>
          )}
        </div>
      </div>
      <AiModelRequiredDialog
        open={Boolean(blockedResult)}
        message={blockedResult?.message ?? ""}
        onCancel={closeGate}
        onConfigureModel={() => {
          closeGate();
          onConfigureModel?.();
        }}
      />
    </section>
  );
}
