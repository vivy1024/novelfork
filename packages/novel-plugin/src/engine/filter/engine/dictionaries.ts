const dictionaries = {
  "ai-vocabulary": [
    "值得注意的是",
    "以下是为您",
    "让我们一起来",
    "综上所述",
    "总的来说",
    "需要指出的是",
    "不可否认的是",
    "从某种意义上说",
    "整体而言",
    "毋庸置疑",
  ],
  "empty-words": ["很开心", "非常开心", "十分震惊", "极其重要", "深深地感到", "难以言喻"],
  "dialogue-colloquial": ["啊", "呀", "吧", "嘛", "呗", "喂", "哎", "啧", "哈", "呢"],
  officialese: ["综上所述", "总的来说", "总体而言", "需要指出的是", "相关人士", "有关部门"],
  jargon: ["体系化", "闭环", "赋能", "抓手", "路径依赖", "范式", "模型", "机制", "协同", "沉淀"],
  adjectives: ["璀璨", "夺目", "绚丽", "多彩", "深邃", "幽暗", "苍茫", "浩瀚", "宏大", "壮阔"],
} as const;

export type FilterDictionaryName = keyof typeof dictionaries;

const cache = new Map<FilterDictionaryName, string[]>();

export function loadFilterDictionary(name: FilterDictionaryName): string[] {
  const cached = cache.get(name);
  if (cached) return cached;
  const value = [...dictionaries[name]];
  cache.set(name, value);
  return value;
}
