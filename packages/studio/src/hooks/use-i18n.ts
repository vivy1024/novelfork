import { useApi } from "./use-api";

type Lang = "zh" | "en";

const strings = {
  // Header
  "nav.books": { zh: "书籍", en: "Books" },
  "nav.newBook": { zh: "新建书籍", en: "New Book" },
  "nav.config": { zh: "配置", en: "Config" },
  "nav.daemon": { zh: "守护进程", en: "Daemon" },
  "nav.logs": { zh: "日志", en: "Logs" },
  "nav.style": { zh: "风格分析", en: "Style" },
  "nav.connected": { zh: "已连接", en: "Connected" },
  "nav.disconnected": { zh: "未连接", en: "Disconnected" },

  // Common
  "common.loading": { zh: "加载中...", en: "Loading..." },
  "common.error": { zh: "错误", en: "Error" },
  "common.edit": { zh: "编辑", en: "Edit" },
  "common.save": { zh: "保存", en: "Save" },
  "common.saving": { zh: "保存中...", en: "Saving..." },
  "common.cancel": { zh: "取消", en: "Cancel" },
  "common.refresh": { zh: "刷新", en: "Refresh" },
  "common.export": { zh: "导出", en: "Export" },

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
  "book.truthFiles": { zh: "事实文件", en: "Truth Files" },
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
  "create.platform": { zh: "平台", en: "Platform" },
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

  // Daemon
  "daemon.title": { zh: "守护进程", en: "Daemon" },
  "daemon.running": { zh: "运行中", en: "Running" },
  "daemon.stopped": { zh: "已停止", en: "Stopped" },
  "daemon.start": { zh: "启动", en: "Start" },
  "daemon.starting": { zh: "启动中...", en: "Starting..." },
  "daemon.stop": { zh: "停止", en: "Stop" },
  "daemon.stopping": { zh: "停止中...", en: "Stopping..." },
  "daemon.waitingEvents": { zh: "等待守护进程事件...", en: "Waiting for daemon events..." },
  "daemon.startHint": { zh: "启动守护进程后，这里会显示事件日志。", en: "Start the daemon to see event logs here." },
  "daemon.eventLog": { zh: "事件日志", en: "Event Log" },

  // Logs
  "logs.title": { zh: "日志", en: "Logs" },
  "logs.empty": { zh: "暂无日志。执行写作、草稿或守护进程操作后，这里会出现内容。", en: "No log entries. Logs appear after running write/draft/daemon operations." },
  "logs.showingRecent": { zh: "显示 inkos.log 的最近 100 条记录", en: "Showing last 100 entries from inkos.log" },

  // Truth Files
  "truth.title": { zh: "事实文件", en: "Truth Files" },
  "truth.empty": { zh: "暂无事实文件", en: "No truth files" },
  "truth.notFound": { zh: "文件不存在", en: "File not found" },
  "truth.selectFile": { zh: "选择一个文件查看内容", en: "Select a file to view" },
  "truth.chars": { zh: "字符", en: "chars" },

  // Style
  "style.title": { zh: "风格分析", en: "Style Analysis" },
  "style.sourceName": { zh: "来源名称", en: "Source Name" },
  "style.sourceExample": { zh: "例如：金庸、畅销样文、个人草稿", en: "e.g. Jin Yong, bestseller sample, personal draft" },
  "style.textSample": { zh: "文本样本", en: "Text Sample" },
  "style.pasteHint": { zh: "粘贴一段能代表目标风格的文本...", en: "Paste a representative writing sample..." },
  "style.analyze": { zh: "分析风格", en: "Analyze Style" },
  "style.analyzing": { zh: "分析中...", en: "Analyzing..." },
  "style.results": { zh: "分析结果", en: "Results" },
  "style.avgSentence": { zh: "平均句长", en: "Avg Sentence" },
  "style.vocabDiversity": { zh: "词汇多样性", en: "Vocab Diversity" },
  "style.avgParagraph": { zh: "平均段长", en: "Avg Paragraph" },
  "style.sentenceStdDev": { zh: "句长波动", en: "Sentence Std Dev" },
  "style.topPatterns": { zh: "高频模式", en: "Top Patterns" },
  "style.rhetoricalFeatures": { zh: "修辞特征", en: "Rhetorical Features" },
  "style.importToBook": { zh: "导入到书籍", en: "Import to Book" },
  "style.selectBook": { zh: "选择书籍", en: "Select Book" },
  "style.importGuide": { zh: "导入风格指南", en: "Import Style Guide" },
  "style.emptyHint": { zh: "输入样本文本后即可分析写作风格。", en: "Paste a sample to analyze the writing style." },
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
