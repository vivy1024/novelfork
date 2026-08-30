import { CheckCircle2, FileArchive, FolderOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface ChapterRow {
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly wordCount: number;
}

function readChapters(value: unknown): ChapterRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const number = getNumber(record.number);
    if (number === null) return [];
    return [{
      key: `export-ch-${number}-${index}`,
      number,
      title: getString(record.title, `第${number}章`),
      wordCount: getNumber(record.wordCount) ?? 0,
    }];
  });
}

/** publish.export：最小发布包结果卡。只展示本次真正写出的内容，不把记忆/附件说成已导出。 */
export const PublishExportCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const outputDir = getString(data.outputDir, "export/publish");
  const files = getStringArray(data.files);
  const included = getStringArray(data.included);
  const excluded = getStringArray(data.excluded);
  const chapters = readChapters(data.chapters);
  const adviceIncluded = data.adviceIncluded === true;
  const adviceStatus = getString(data.adviceStatus);
  const from = chapters[0]?.number;
  const to = chapters[chapters.length - 1]?.number;

  return (
    <ToolResultSurface
      testId="tool-result-publish-export"
      title="发布包已写出"
      icon={<FileArchive className="size-4 text-primary" />}
      meta={`${chapters.length} 章`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="text-foreground">{outputDir}</span>
        {from && to && <span>第 {from}–{to} 章</span>}
      </div>

      {included.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {included.map((item) => (
            <Badge key={item} variant="secondary">
              <CheckCircle2 data-icon="inline-start" />
              {item}
            </Badge>
          ))}
        </div>
      )}

      {adviceIncluded && adviceStatus && (
        <p className="text-xs text-muted-foreground">投稿建议状态：{adviceStatus}（仅供人工复核）</p>
      )}

      {files.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">写出文件（{files.length}）</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {files.map((file) => <li key={file}>{file}</li>)}
          </ul>
        </details>
      )}

      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">未混入：{excluded.join("、")}</p>
      )}
    </ToolResultSurface>
  );
};
