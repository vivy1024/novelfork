export interface TourStep {
  /** data-tour-id 属性值，用于定位目标元素 */
  readonly targetId: string;
  /** 标题 */
  readonly title: string;
  /** 描述 */
  readonly description: string;
  /** tooltip 相对于目标的位置 */
  readonly placement: "top" | "bottom" | "left" | "right";
}

export const HOME_TOUR_STEPS: readonly TourStep[] = [
  {
    targetId: "sidebar-books",
    title: "作品列表",
    description: "你的所有作品在这里。点击进入工作台，开始写作或管理经纬。",
    placement: "right",
  },
  {
    targetId: "sidebar-narrators",
    title: "独立叙述者",
    description: "这里是独立对话，可以跟 AI 聊任何话题。进入书籍后会有专属的 AI 对话面板。",
    placement: "right",
  },
  {
    targetId: "sidebar-learn",
    title: "学习中心",
    description: "更多教程和参考文档在这里，随时可以回来查阅。",
    placement: "right",
  },
];
