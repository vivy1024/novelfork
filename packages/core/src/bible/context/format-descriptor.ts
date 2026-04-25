function labelize(key: string): string {
  const labels: Record<string, string> = {
    currency: "货币",
    scarcity: "稀缺性",
    classIncomeLevels: "阶层收入",
    class_income_levels: "阶层收入",
    tradePatterns: "贸易模式",
    trade_patterns: "贸易模式",
    notableCommodities: "关键商品",
    notable_commodities: "关键商品",
    governmentType: "政体",
    government_type: "政体",
    classMobility: "阶层流动",
    class_mobility: "阶层流动",
    taboos: "禁忌",
    ethicsFrame: "伦理框架",
    ethics_frame: "伦理框架",
    keyInstitutions: "关键机构",
    key_institutions: "关键机构",
    climateImpact: "气候影响",
    climate_impact: "气候影响",
    keyRegions: "关键区域",
    key_regions: "关键区域",
    transportConstraints: "交通限制",
    transport_constraints: "交通限制",
    resourceDistribution: "资源分布",
    resource_distribution: "资源分布",
    levelTiers: "等级层级",
    level_tiers: "等级层级",
    bottleneckResources: "瓶颈资源",
    bottleneck_resources: "瓶颈资源",
    breakthroughCost: "突破成本",
    breakthrough_cost: "突破成本",
    systemContradictions: "体系矛盾",
    system_contradictions: "体系矛盾",
    languages: "语言",
    religions: "宗教",
    customs: "习俗",
    historicalEvents: "历史事件",
    historical_events: "历史事件",
    era: "纪元",
    yearsSpan: "年代跨度",
    years_span: "年代跨度",
    keyBeats: "关键节点",
    key_beats: "关键节点",
  };
  return labels[key] ?? key.replace(/_/gu, " ");
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isEmptyValue(item))
      .map((item) => (typeof item === "object" && item !== null ? formatDescriptor(item as Record<string, unknown>) : String(item)))
      .join("、");
  }
  if (typeof value === "object" && value !== null) {
    return formatDescriptor(value as Record<string, unknown>);
  }
  return String(value);
}

export function safeParseDescriptor(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function hasDescriptorContent(raw: string): boolean {
  const parsed = safeParseDescriptor(raw);
  return Object.values(parsed).some((value) => !isEmptyValue(value));
}

export function formatDescriptor(descriptor: Record<string, unknown>): string {
  return Object.entries(descriptor)
    .filter(([, value]) => !isEmptyValue(value))
    .map(([key, value]) => `${labelize(key)}：${formatValue(value)}`)
    .filter((part) => !part.endsWith("："))
    .join("；");
}
