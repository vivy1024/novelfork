import { JingweiGraphWorkspace, type JingweiGraphWorkspaceProps } from "./JingweiGraphWorkspace";

/**
 * NarrativeMemoryGraphWorkspace — Narrative Memory 的记忆图谱入口。
 *
 * 第一阶段复用旧图谱实现，先完成产品边界和入口迁移：图谱属于 Narrative Memory，
 * 经纬/Lore 只保留静态设定编辑入口。内部数据源后续可逐步迁移到 NarrativeFact / NarrativeEvent。
 */
export function NarrativeMemoryGraphWorkspace(props: JingweiGraphWorkspaceProps) {
  return <JingweiGraphWorkspace defaultViewMode="3d-crystalline" {...props} />;
}
