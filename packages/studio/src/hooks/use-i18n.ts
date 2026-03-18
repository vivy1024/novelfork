import { useApi } from "./use-api";

type Lang = "zh" | "en";

const strings = {
  // Header
  "nav.books": { zh: "书籍", en: "Books" },
  "nav.newBook": { zh: "新建书籍", en: "New Book" },
  "nav.config": { zh: "配置", en: "Config" },
  "nav.connected": { zh: "已连接", en: "Connected" },
  "nav.disconnected": { zh: "未连接", en: "Disconnected" },

  // Dashboard
  "dash.title": { zh: "书籍列表", en: "Books" },
  "dash.noBooks": { zh: "还没有书", en: "No books yet" },
  "dash.createFirst": { zh: "创建第一本书开始写作", en: "Create your first book to get started" },
  "dash.writeNext": { zh: "写下一章", en: "Write Next" },
  "dash.writing": { zh: "写作中...", en: "Writing..." },
  "dash.stats": { zh: "统计", en: "Stats" },
  "dash.chapters": { zh: "章", en: "chapters" },
  "dash.recentEvents": { zh: "最近事件", en: "Recent Events" },
  "dash.writingProgress": { zh: "写作进度", en: "Writing Progress" },

  // Book Detail
  "book.writeNext": { zh: "写下一章", en: "Write Next" },
  "book.draftOnly": { zh: "仅草稿", en: "Draft Only" },
  "book.approveAll": { zh: "全部通过", en: "Approve All" },
  "book.analytics": { zh: "数据分析", en: "Analytics" },
  "book.noChapters": { zh: "暂无章节，点击「写下一章」开始", en: 'No chapters yet. Click "Write Next" to start.' },
  "book.approve": { zh: "通过", en: "Approve" },
  "book.reject": { zh: "驳回", en: "Reject" },
  "book.words": { zh: "字", en: "words" },

  // Chapter Reader
  "reader.backToList": { zh: "返回列表", en: "Back to List" },
  "reader.approve": { zh: "通过", en: "Approve" },
  "reader.reject": { zh: "驳回", en: "Reject" },
  "reader.chapterList": { zh: "章节列表", en: "Chapter List" },
  "reader.characters": { zh: "字符", en: "characters" },

  // Book Create
  "create.title": { zh: "创建书籍", en: "Create Book" },
  "create.bookTitle": { zh: "书名", en: "Title" },
  "create.language": { zh: "语言", en: "Language" },
  "create.genre": { zh: "题材", en: "Genre" },
  "create.wordsPerChapter": { zh: "每章字数", en: "Words / Chapter" },
  "create.targetChapters": { zh: "目标章数", en: "Target Chapters" },
  "create.creating": { zh: "创建中...", en: "Creating..." },
  "create.submit": { zh: "创建书籍", en: "Create Book" },
  "create.titleRequired": { zh: "请输入书名", en: "Title is required" },
  "create.genreRequired": { zh: "请选择题材", en: "Genre is required" },
  "create.placeholder": { zh: "请输入书名...", en: "Book title..." },

  // Analytics
  "analytics.title": { zh: "数据分析", en: "Analytics" },
  "analytics.totalChapters": { zh: "总章数", en: "Total Chapters" },
  "analytics.totalWords": { zh: "总字数", en: "Total Words" },
  "analytics.avgWords": { zh: "平均字数/章", en: "Avg Words/Chapter" },
  "analytics.statusDist": { zh: "状态分布", en: "Status Distribution" },

  // Breadcrumb
  "bread.books": { zh: "书籍", en: "Books" },
  "bread.newBook": { zh: "新建书籍", en: "New Book" },
  "bread.config": { zh: "配置", en: "Config" },
  "bread.home": { zh: "首页", en: "Home" },
  "bread.chapter": { zh: "第{n}章", en: "Chapter {n}" },

  // Config
  "config.title": { zh: "项目配置", en: "Project Config" },
  "config.project": { zh: "项目名", en: "Project" },
  "config.language": { zh: "语言", en: "Language" },
  "config.provider": { zh: "提供方", en: "Provider" },
  "config.model": { zh: "模型", en: "Model" },
  "config.editHint": { zh: "通过 CLI 编辑配置：", en: "Edit via CLI:" },
} as const;

export type StringKey = keyof typeof strings;
export type TFunction = (key: StringKey) => string;

export function useI18n() {
  const { data } = useApi<{ language: string }>("/project");
  const lang: Lang = data?.language === "en" ? "en" : "zh";

  function t(key: StringKey): string {
    return strings[key][lang];
  }

  return { t, lang };
}
