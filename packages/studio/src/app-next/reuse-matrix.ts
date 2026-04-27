export type ReuseDecision = "direct-reuse" | "wrap" | "reuse-logic" | "defer";

export interface ReuseMatrixItem {
  readonly path: string;
  readonly decision: ReuseDecision;
  readonly reason: string;
  readonly spec?: string;
}

export const REUSE_MATRIX: readonly ReuseMatrixItem[] = [
  {
    path: "packages/studio/src/pages/SettingsView.tsx",
    decision: "reuse-logic",
    reason: "旧设置页已有分区与部分真实配置入口，新前端重写管理型布局但迁移可用面板逻辑。",
  },
  {
    path: "packages/studio/src/pages/settings/RuntimeControlPanel.tsx",
    decision: "wrap",
    reason: "运行时、权限、恢复与调试项已接入真实配置，设置页 AI 代理分区应包裹复用。",
  },
  {
    path: "packages/studio/src/components/Settings/ReleaseOverview.tsx",
    decision: "direct-reuse",
    reason: "关于页版本、commit、平台信息已有可用组件，第一阶段不重复实现。",
  },
  {
    path: "packages/studio/src/components/Routines/Routines.tsx",
    decision: "reuse-logic",
    reason: "旧 Routines 已有 scope、保存、重置和表单基础，新套路页重写分区但复用读写逻辑。",
  },
  {
    path: "packages/studio/src/types/routines.ts",
    decision: "direct-reuse",
    reason: "套路页必须保留 global/project/merged 数据口径，不新建第二套类型。",
  },
  {
    path: "packages/studio/src/api/routes/routines.ts",
    decision: "direct-reuse",
    reason: "套路读写 API 已存在，新页面通过原接口保存和重置配置。",
  },
  {
    path: "packages/studio/src/components/writing-tools/*",
    decision: "wrap",
    spec: "writing-tools-v1",
    reason: "节奏、对话、钩子、POV、日更组件已是新工作台可复用资产，只在章节上下文中挂载。",
  },
  {
    path: "packages/studio/src/components/compliance/*",
    decision: "direct-reuse",
    spec: "platform-compliance-v1",
    reason: "合规组件已完成，第一阶段只提供发布入口或嵌入，不重写第二套合规页面。",
  },
  {
    path: "packages/studio/src/pages/BibleView.tsx",
    decision: "reuse-logic",
    reason: "经纬资料库页面已有真实资料类型与交互，新工作台右侧资料面板复用其数据理解。",
  },
  {
    path: "packages/studio/src/api/routes/bible.ts",
    decision: "direct-reuse",
    reason: "Bible/Jingwei API 是资料库唯一来源，新工作台不新增孤立资料表。",
  },
  {
    path: "packages/studio/src/pages/BookDetail.tsx",
    decision: "reuse-logic",
    reason: "书籍详情含真实章节入口和书籍 API 用法，新工作台迁移动作但不照搬旧布局。",
  },
  {
    path: "packages/studio/src/pages/ChapterReader.tsx",
    decision: "reuse-logic",
    reason: "章节阅读与保存逻辑是正文编辑基础，新工作台迁移能力并保持正式章节安全边界。",
  },
  {
    path: ".kiro/specs/writing-modes-v1/tasks.md",
    decision: "defer",
    spec: "writing-modes-v1",
    reason: "写作模式 UI 等待新创作工作台挂载位置，不接旧 BookDetail 或 ChapterReader。",
  },
] as const;

export function findReuseItem(path: string): ReuseMatrixItem | undefined {
  return REUSE_MATRIX.find((item) => item.path === path);
}
