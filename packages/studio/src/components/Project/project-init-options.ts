import type {
  StudioRepositorySource,
  StudioTemplatePreset,
  StudioWorkflowMode,
} from "../../api/book-create";

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly title: string;
  readonly description: string;
}

export function repositorySourceOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioRepositorySource>> {
  if (language === "en") {
    return [
      { value: "new", title: "New repo", description: "Start from the current workspace and reserve a clean project root." },
      { value: "existing", title: "Existing repo", description: "Bind this book to an already prepared local repository." },
      { value: "clone", title: "Clone remote", description: "Reserve remote clone information for the next Git bootstrap step." },
    ];
  }

  return [
    { value: "new", title: "新建仓库", description: "从当前工作区起一个新的项目根目录，适合全新开书。" },
    { value: "existing", title: "已有仓库", description: "把本书挂到已经准备好的本地仓库，先对齐写作工作区。" },
    { value: "clone", title: "克隆仓库", description: "先登记远端来源，为后续 clone / Git 接管留好入口。" },
  ];
}

export function workflowModeOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioWorkflowMode>> {
  if (language === "en") {
    return [
      { value: "outline-first", title: "Outline first", description: "Land the story framework and world rules first, then expand into chapter work." },
      { value: "draft-first", title: "Draft first", description: "Keep the setup lighter and reach the first writable draft faster." },
      { value: "serial-ops", title: "Serial ops", description: "Prepare for long-running serial work with higher chapter and cadence defaults." },
    ];
  }

  return [
    { value: "outline-first", title: "先大纲", description: "先把故事经纬、世界规则和基础骨架立起来，再进入章节生产。" },
    { value: "draft-first", title: "先开稿", description: "减少前置铺垫，先得到一套可写的初始工程，适合快速起盘。" },
    { value: "serial-ops", title: "连载推进", description: "按长期连载准备更高章数与节奏预设，方便后续持续推进。" },
  ];
}

export function templatePresetOptions(language: "zh" | "en"): ReadonlyArray<ChoiceOption<StudioTemplatePreset>> {
  if (language === "en") {
    return [
      { value: "genre-default", title: "Genre default", description: "Follow the selected genre as the first-round scaffold." },
      { value: "blank-slate", title: "Blank slate", description: "Keep the initial skeleton lighter for manual worldbuilding." },
      { value: "web-serial", title: "Web serial", description: "Bias the setup toward web-serial pacing and chapter cadence." },
    ];
  }

  return [
    { value: "genre-default", title: "跟随题材", description: "用当前题材作为第一轮初始化骨架，保留原有书籍生成主链。" },
    { value: "blank-slate", title: "空白模板", description: "减少预设束缚，适合先自己铺设世界观和角色底稿。" },
    { value: "web-serial", title: "网文快启", description: "偏向网文连载节奏，默认给更积极的章节推进预设。" },
  ];
}
