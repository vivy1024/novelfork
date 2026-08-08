/**
 * 卷驾驶舱状态 —— 把 outline.volume(action=get) 的结构化结果翻译成写作视图侧栏
 * 一屏可读的「当前卷」模型。
 *
 * 纯逻辑，无 React 依赖，便于单测。
 * 数据只来自 outline.volume get 通道；不在前端拼造卷字段，缺字段时如实留空。
 */

export interface VolumeCockpitVolume {
  readonly id: string;
  readonly title: string;
  /** 章号区间起点；缺失时为 null。 */
  readonly from: number | null;
  readonly to: number | null;
  readonly goal: string;
  readonly status: string;
}

export interface VolumeCockpitModel {
  /** empty=尚无卷纲（显示建卷引导）；ready=有当前卷。 */
  readonly state: "empty" | "ready";
  readonly current: VolumeCockpitVolume | null;
  /** 当前卷在卷序列中的序号（1 起）；未知时为 0。 */
  readonly index: number;
  /** 卷内总章数；区间缺失时为 0。 */
  readonly total: number;
  /** 本章在本卷的位置（1 起）；章号未知或落在区间外时为 null。 */
  readonly offset: number | null;
  /** 收束本卷目标前的剩余章数；无法计算时为 null。 */
  readonly remaining: number | null;
  /** 目标章号是否落在本卷区间内；章号或区间未知时为 null（不作判定）。 */
  readonly inRange: boolean | null;
  /** 作者可读的卷状态文案。 */
  readonly statusLabel: string;
  /** 后端 summary（建卷引导等兜底文案的来源）。 */
  readonly summary: string;
}

/** 卷状态 → 作者可读文案；与卷纲卡 STATUS_LABEL 保持一致。 */
const STATUS_LABEL: Record<string, string> = {
  planned: "待写",
  active: "进行中",
  done: "已完成",
};

export function volumeStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readVolume(value: unknown): VolumeCockpitVolume | null {
  const record = asRecord(value);
  if (!record) return null;
  const range = asRecord(record.chapterRange);
  const title = text(record.title);
  const id = text(record.id);
  if (!title && !id) return null;
  return {
    id,
    title: title || "未命名卷",
    from: range ? toNumber(range.from) : null,
    to: range ? toNumber(range.to) : null,
    goal: text(record.goal),
    status: text(record.status) || "planned",
  };
}

/**
 * 把 outline.volume get 返回体 + 当前章号转成卷驾驶舱模型。
 *
 * @param raw outline.volume(action=get) 的返回体（宽松 unknown，容忍演进）
 * @param chapterNumber 当前要写的章号（来自 write.preflight）；用于定位本章在本卷位置
 */
export function buildVolumeCockpitModel(raw: unknown, chapterNumber: number): VolumeCockpitModel {
  const record = asRecord(raw);
  const outline = asRecord(record?.outline);
  const volumesRaw = Array.isArray(outline?.volumes) ? outline!.volumes : [];
  const volumes = volumesRaw.map(readVolume).filter((v): v is VolumeCockpitVolume => v !== null);
  const summary = text(record?.summary);

  const current = readVolume(record?.current) ?? readVolume(record?.currentVolume);
  if (!current || volumes.length === 0) {
    return {
      state: "empty",
      current: null,
      index: 0,
      total: 0,
      offset: null,
      remaining: null,
      inRange: null,
      statusLabel: "",
      summary,
    };
  }

  const index = volumes.findIndex((v) => v.id === current.id) + 1;
  const hasRange = typeof current.from === "number" && typeof current.to === "number";
  const total = hasRange ? Math.max(0, (current.to as number) - (current.from as number) + 1) : 0;
  const hasChapter = Number.isFinite(chapterNumber) && chapterNumber > 0;

  let inRange: boolean | null = null;
  let offset: number | null = null;
  let remaining: number | null = null;
  if (hasRange && hasChapter) {
    const from = current.from as number;
    const to = current.to as number;
    inRange = chapterNumber >= from && chapterNumber <= to;
    if (inRange) {
      offset = chapterNumber - from + 1;
      remaining = to - chapterNumber;
    }
  }

  return {
    state: "ready",
    current,
    index: index > 0 ? index : 0,
    total,
    offset,
    remaining,
    inRange,
    statusLabel: volumeStatusLabel(current.status),
    summary,
  };
}
