import { BookOpen, CheckCircle2, Circle, CircleDot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { SecondaryModelCalls } from "./SecondaryModelCalls";
import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface VolumeRow {
  readonly id: string;
  readonly title: string;
  readonly from: number | null;
  readonly to: number | null;
  readonly goal: string;
  readonly status: string;
}

function readVolumes(value: unknown): VolumeRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const range = asRecord(record.chapterRange);
    return [{
      id: getString(record.id, `volume-${index}`),
      title: getString(record.title, `第 ${index + 1} 卷`),
      from: range ? getNumber(range.from) : null,
      to: range ? getNumber(range.to) : null,
      goal: getString(record.goal),
      status: getString(record.status, "planned"),
    }];
  });
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="size-3.5 shrink-0 text-primary" />;
  if (status === "active") return <CircleDot className="size-3.5 shrink-0 text-primary" />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" />;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "待写",
  active: "进行中",
  done: "已完成",
};

/** outline.volume 卷纲卡：经纬 outline 是唯一权威源，suggest 结果尚未落盘。 */
export const OutlineVolumeCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const action = getString(data.action, "get");
  const suggestion = readVolumes(data.suggestion);
  const outline = asRecord(data.outline);
  const saved = readVolumes(outline?.volumes);
  const isSuggestion = action === "suggest" && suggestion.length > 0;
  const rows = isSuggestion ? suggestion : saved;
  const currentVolume = asRecord(data.currentVolume);
  const currentId = currentVolume ? getString(currentVolume.id) : "";
  const summary = getString(data.summary);

  return (
    <ToolResultSurface
      testId="tool-result-outline-volume"
      title={isSuggestion ? "卷纲草案（未保存）" : "卷纲"}
      icon={<BookOpen className="size-4 text-primary" />}
      meta={`${rows.length} 卷`}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{summary || "经纬里还没有卷纲。可以用 outline.volume(action=suggest) 生成草案。"}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((volume) => (
            <li key={volume.id} className="flex items-start gap-1.5 text-xs">
              <StatusIcon status={volume.status} />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1 text-foreground">
                  <span>{volume.title}</span>
                  {volume.from && volume.to && <span className="text-muted-foreground">第 {volume.from}–{volume.to} 章</span>}
                  <Badge variant="outline">{STATUS_LABEL[volume.status] ?? volume.status}</Badge>
                  {volume.id === currentId && <Badge variant="secondary">当前卷</Badge>}
                </p>
                {volume.goal && <p className="text-muted-foreground">{volume.goal}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isSuggestion && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">这是草案，还没写进经纬。确认后用 outline.volume(action=set) 保存。</p>
        </>
      )}

      <SecondaryModelCalls value={data.modelCalls} />
    </ToolResultSurface>
  );
};
