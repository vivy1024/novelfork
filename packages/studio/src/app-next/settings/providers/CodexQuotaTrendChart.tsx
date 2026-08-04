interface TrendDataPoint {
  readonly timestamp: number; // unix ms
  readonly remaining: number;
  readonly total: number;
}

interface CodexQuotaTrendChartProps {
  readonly trend: readonly TrendDataPoint[];
  readonly compact?: boolean;
}

const VIEWBOX_WIDTH = 400;
const VIEWBOX_HEIGHT = 160;
const VIEWBOX_HEIGHT_COMPACT = 100;
const PADDING = { top: 12, right: 16, bottom: 20, left: 16 };
const HOURS_24 = 24 * 60 * 60 * 1000;

function toPercent(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (remaining / total) * 100));
}

export function CodexQuotaTrendChart({ trend, compact }: CodexQuotaTrendChartProps) {
  if (!trend.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm h-[160px]">
        暂无配额趋势数据
      </div>
    );
  }

  const height = compact ? VIEWBOX_HEIGHT_COMPACT : VIEWBOX_HEIGHT;
  const chartW = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const now = Date.now();
  const windowStart = now - HOURS_24;

  // 只保留最近 24h 的数据点
  const visible = trend.filter((p) => p.timestamp >= windowStart);
  if (!visible.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm h-[160px]">
        暂无配额趋势数据
      </div>
    );
  }

  // 映射坐标
  const points = visible.map((p) => {
    const x = PADDING.left + ((p.timestamp - windowStart) / HOURS_24) * chartW;
    const y = PADDING.top + chartH - (toPercent(p.remaining, p.total) / 100) * chartH;
    return { x, y };
  });

  // 构建 path
  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${lineD} L ${points[points.length - 1].x} ${PADDING.top + chartH} L ${points[0].x} ${PADDING.top + chartH} Z`;

  // "Now" 虚线 x 坐标
  const nowX = PADDING.left + chartW;

  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
      className="w-full"
      style={{ height: compact ? 100 : 160 }}
      aria-label="配额趋势图"
    >
      {/* 填充区域 */}
      <path d={areaD} fill="hsl(var(--primary))" fillOpacity={0.1} />
      {/* 趋势线 */}
      <path d={lineD} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" />
      {/* 当前时间虚线 */}
      <line
        x1={nowX}
        y1={PADDING.top}
        x2={nowX}
        y2={PADDING.top + chartH}
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text
        x={nowX}
        y={PADDING.top - 3}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize={10}
      >
        Now
      </text>
      {/* 最后一个数据点圆点 */}
      <circle cx={last.x} cy={last.y} r={4} fill="hsl(var(--primary))" />
    </svg>
  );
}
