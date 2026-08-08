import { HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getString, getStringArray, getToolResultArtifact, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface PgiQuestionRow {
  readonly id: string;
  readonly prompt: string;
  readonly reason: string;
  readonly options: readonly string[];
}

/** pgi.ask 返回的 questions 是对象数组（id/prompt/reason/options），不是纯字符串。 */
function readQuestions(value: unknown): PgiQuestionRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const prompt = getString(record.prompt);
    if (!prompt) return [];
    return [{
      id: getString(record.id, `pgi-${index}`),
      prompt,
      reason: getString(record.reason),
      options: getStringArray(record.options),
    }];
  });
}

/** pgi.ask 追问卡：把生成前追问的问题与理由一眼列清，作者交互仍走随后的 AskUserQuestion。 */
export const PgiCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const { result, onOpenArtifact } = context;
  const data = asRecord(getToolResultData(result));
  if (!data) return null;

  const questions = readQuestions(data.questions);
  const skippedReason = getString(data.skippedReason);
  const artifact = getToolResultArtifact(result);

  return (
    <ToolResultSurface
      testId="tool-result-pgi"
      title="生成前追问"
      icon={<HelpCircle className="size-4 text-primary" />}
      meta={questions.length > 0 ? <Badge variant="secondary">{questions.length} 个问题</Badge> : undefined}
      footer={artifact && onOpenArtifact ? <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} /> : undefined}
    >
      {questions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {skippedReason === "no-questions" ? "本章无需追问，可直接进入 write.preflight / scene.spec。" : "暂无追问问题。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {questions.map((question) => (
            <li key={question.id} className="text-xs">
              <p className="text-foreground">{question.prompt}</p>
              {question.reason && <p className="text-muted-foreground">{question.reason}</p>}
              {question.options.length > 0 && (
                <p className="text-muted-foreground">选项：{question.options.join(" / ")}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {questions.length > 0 && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">
            请将这些问题传给 AskUserQuestion 工具展示给作者，回答后再据此确定本章方向。
          </p>
        </>
      )}
    </ToolResultSurface>
  );
};
