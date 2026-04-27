import { useMemo, useState } from "react";

import type { AiDisclosure } from "@vivy1024/novelfork-core/compliance";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AiDisclosureEditorProps {
  readonly disclosure: AiDisclosure;
  readonly onChange?: (value: string) => void;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function AiDisclosureEditor({ disclosure, onChange }: AiDisclosureEditorProps) {
  const [content, setContent] = useState(disclosure.markdownText);

  const assistTypes = useMemo(() => disclosure.aiUsageTypes, [disclosure.aiUsageTypes]);
  const modelNames = useMemo(() => disclosure.modelNames, [disclosure.modelNames]);

  function handleChange(value: string) {
    setContent(value);
    onChange?.(value);
  }

  function exportFile(type: "text" | "markdown") {
    const extension = type === "markdown" ? "md" : "txt";
    const mime = type === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-disclosure-${disclosure.bookId}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle>AI 使用标注编辑器</CardTitle>
          <CardDescription>可编辑 AI 使用声明，并导出为文本或 Markdown。</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {assistTypes.map((type) => (
            <Badge key={type} variant="secondary">{type}</Badge>
          ))}
          {modelNames.map((model) => (
            <Badge key={model} variant="outline">{model}</Badge>
          ))}
          <Badge variant="outline">{formatPercent(disclosure.estimatedAiRatio)}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">{disclosure.humanEditDescription}</div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ai-disclosure-content">AI 使用标注内容</Label>
          <Textarea
            id="ai-disclosure-content"
            aria-label="AI 使用标注内容"
            value={content}
            onChange={(event) => handleChange(event.target.value)}
            className="min-h-[240px]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => exportFile("text")}>
            导出文本
          </Button>
          <Button type="button" variant="outline" onClick={() => exportFile("markdown")}>
            导出 Markdown
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
