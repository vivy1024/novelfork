import type {
	RuntimeLearningDocumentOverride,
	RuntimeLearningLocalizedText,
	RuntimeLearningPresentation,
} from "@vivy1024/narrafork-runtime-bridge";

/**
 * 学习中心里 Runtime 自带文档的呈现方式。
 *
 * Runtime 自带的 14 篇文档面向通用 AI 编程工作台；作者打开学习中心应看到 NovelFork 的口径：
 * 品牌名统一替换为 NovelFork，与写书无关的开发者向文档默认隐藏（功能本身仍在，只是不在学习中心介绍），
 * 编程向的说法按写书场景改写。NovelFork 自己的教程（docs/learning/）原样展示、排在 Runtime 文档前面。
 */

const t = (zh: string, en: string): RuntimeLearningLocalizedText => ({ en, "zh-CN": zh });

/** 开发者向、与写书无关的 Runtime 文档：功能仍在（设置页可达），学习中心不再介绍。 */
export const HIDDEN_RUNTIME_LEARNING_DOC_IDS = [
	"mcp-and-hooks",
	"terminal-and-containers",
	"reviews-and-quality",
	"notifications-and-gateway",
] as const;

const overview: RuntimeLearningDocumentOverride = {
	tags: ["入门", "概览", "写作流程"],
	title: t("一页理解 NovelFork", "NovelFork in one page"),
	summary: t(
		"NovelFork 是写网文的工作台：建一本书，和叙述者一起写章，你确认后才落盘，每章写完结算进记忆，写到几百章也不乱。",
		"NovelFork is a workbench for writing web novels: create a book, write chapters together with a narrator, save only what you confirm, and settle each chapter into memory so long books stay consistent.",
	),
	sections: [
		{
			title: t("一本书怎么写下去", "How a book moves forward"),
			body: t(
				"建书：起书名、答建书问题，NovelFork 帮你把人物、世界、大纲放进「作品基础」（经纬）。\n\n写章：在写作台定好本章目标，交给右侧的叙述者写。叙述者是你的 AI 写作搭档，能读这本书的正文、设定和记忆。\n\n确认后落盘：AI 写出的正文和抽出的设定先给你看，你确认了才算数。\n\n章后结算：每章写完，把这一章发生的事记进叙事记忆，下一章 AI 才知道前情。",
				"Create a book: name it and answer the setup questions; characters, world and outline go into the book's foundation.\n\nWrite a chapter: set the chapter goal in the writing desk and hand it to the narrator on the right. The narrator is your AI writing partner and can read this book's text, settings and memory.\n\nSave after you confirm: drafted text and extracted settings are shown to you first and only count once you confirm them.\n\nSettle the chapter: after each chapter, what happened is recorded in narrative memory so the next chapter knows the story so far.",
			),
		},
	],
	workflow: [
		t(
			"先在设置里配好 AI 供应商和默认模型，没配模型也能写字，但叙述者和结算需要模型。",
			"Configure an AI provider and default model in settings first; you can type without one, but the narrator and settlement need a model.",
		),
		t(
			"新建一本书，按引导补齐作品基础。",
			"Create a book and fill in its foundation following the guide.",
		),
		t(
			"在写作侧栏按「写 → 改 → 收尾」写每一章，收尾时确认本章提出的变化。",
			"Write each chapter through Write → Revise → Wrap up in the writing sidebar, confirming the chapter's proposed changes at wrap-up.",
		),
	],
	bestPractices: [
		t(
			"每章只交代一件最该推进的事，比空泛的「写精彩点」更好用。",
			"Give each chapter one concrete thing to move forward; it works better than a vague 'make it exciting'.",
		),
		t(
			"自己改过正文后重新结算一次，记忆才不会过期。",
			"Settle again after editing a chapter yourself so memory stays current.",
		),
	],
	pitfalls: [
		t(
			"AI 写完不等于定稿：读一遍正文，再确认设定和记忆的变化。",
			"A finished AI draft is not the final text: read it, then confirm the setting and memory changes.",
		),
	],
	agentHints: [],
	actions: [
		{
			label: t("我的书", "My books"),
			description: t("新建或打开一本书。", "Create or open a book."),
			href: "/next/books",
		},
		{
			label: t("配置 AI 模型", "Set up AI models"),
			description: t("添加 AI 供应商并选择默认模型。", "Add an AI provider and pick a default model."),
			href: "/next/settings/providers",
		},
	],
};

const narrators: RuntimeLearningDocumentOverride = {
	summary: t(
		"叙述者是 NovelFork 的 AI 写作搭档：能读这本书的正文、设定和记忆，替你写章、查设定、改段落，也能在你切走后继续干活。",
		"Narrators are NovelFork's AI writing partners: they read the book's text, settings and memory, write chapters, look things up and revise passages, and keep working after you switch away.",
	),
	sections: [
		{
			title: t("书内叙述者与独立叙述者", "Book narrators and standalone narrators"),
			body: t(
				"在书里打开的叙述者只管这本书，读写哪本书由系统决定；不绑定书的独立叙述者适合讨论选题、查资料、聊构思。",
				"A narrator opened inside a book works only on that book, and the system decides which book it reads and writes. A standalone narrator suits brainstorming, research and talking through ideas.",
			),
		},
		{
			title: t("后台任务", "Background tasks"),
			body: t(
				"长任务可在你切换页面后继续执行；可通过最近访问或叙述者页面查看状态、未读更新和最终结果。",
				"Long tasks keep running after you switch pages; check status, unread updates and results from recent tabs or the narrators page.",
			),
		},
	],
	workflow: [
		t("写书就在书里打开叙述者；只想聊构思时新建独立叙述者。", "Open the narrator inside the book to write; start a standalone narrator to just talk ideas."),
		t("说清这次要做什么、要守住什么、写到哪算完。", "Say what to do, what must stay intact, and when it counts as done."),
		t("大的改动（重写一卷、调整主线）先让它出方案，你点头再动手。", "For big changes (rewriting a volume, shifting the main plot) ask for a plan first and approve it before it starts."),
		t("接受前读一遍结果，确认设定和记忆的变化。", "Read the result and confirm setting and memory changes before accepting."),
	],
	bestPractices: [
		t("交代具体的事，例如「写第 12 章，主角通过守门人试炼」，而不是「写好一点」。", "Ask for something concrete, e.g. 'write chapter 12 where the hero passes the gatekeeper trial', not 'make it better'."),
		t("一段对话只做一类事：写正文和讨论设定可以分开开对话。", "Keep one kind of work per conversation: drafting and discussing settings can live in separate chats."),
		t("目标变了就及时打断，避免继续消耗额度。", "Interrupt when the goal changes so it stops spending quota."),
	],
	pitfalls: [
		t("叙述者能调用工具，不等于敏感操作不用你批准。", "Being able to use tools does not mean sensitive actions skip your approval."),
	],
};

const subagentsAndPlanMode: RuntimeLearningDocumentOverride = {
	summary: t(
		"子代理把一件专门的事交给另一个 AI 去做（比如审一章、查一段设定）；计划模式要求先出方案、你批准后再动手，适合大改。",
		"Subagents hand a focused job to another AI (reviewing a chapter, checking a setting); plan mode makes the narrator propose a plan and wait for your approval before larger changes.",
	),
	sections: [
		{
			title: t("什么时候用子代理", "When to use subagents"),
			body: t(
				"任务能独立完成、又会占用很多上下文时，交给子代理；它做完只把结论交回来。NovelFork 内置了写作、审校等写书用的子代理。",
				"Hand a job to a subagent when it can be done on its own and would otherwise fill the conversation; it returns only its conclusion. NovelFork ships writing and reviewing subagents for books.",
			),
		},
		{
			title: t("何时使用计划模式", "When to use plan mode"),
			body: t(
				"重写一卷、调整主线、批量改设定、需求还没想清楚时，先进计划模式，让叙述者把要改什么写清楚。",
				"Use plan mode before rewriting a volume, changing the main plot, bulk-editing settings, or when the request is still unclear.",
			),
		},
	],
	workflow: [
		t("先让叙述者读相关章节和设定。", "Let the narrator read the relevant chapters and settings first."),
		t("大改动先出方案，写明改哪些章、哪些设定。", "For big changes get a plan listing which chapters and settings change."),
		t("你批准后再执行，执行完核对结果。", "Execute after you approve, then check the result."),
	],
	bestPractices: [
		t("让子代理交回提炼后的结论，不要整章转贴。", "Ask subagents for distilled conclusions, not whole chapters pasted back."),
	],
	pitfalls: [
		t("一句话能查到的事不必派子代理。", "Do not spawn a subagent for something a single lookup answers."),
	],
};

const permissionsAndSafety: RuntimeLearningDocumentOverride = {
	summary: t(
		"NovelFork 会在敏感操作前停下来等你批准，也支持可复用的权限规则，减少重复弹窗又不丢安全边界。",
		"NovelFork pauses sensitive actions for your approval and supports reusable permission rules, cutting repeated prompts without losing safety.",
	),
	sections: [
		{
			title: t("权限决策", "Permission decisions"),
			body: t(
				"每次批准或拒绝都记在对应的操作上，事后能查到是谁允许了什么。",
				"Every approval or denial is recorded on the action, so you can later see who allowed what.",
			),
		},
		{
			title: t("可复用权限", "Reusable permissions"),
			body: t(
				"常做又安全的操作可以设为自动放行，删除、覆盖这类难以撤回的操作保持手动批准。",
				"Frequent, safe actions can be allowed automatically; keep hard-to-undo actions such as deleting or overwriting on manual approval.",
			),
		},
	],
	workflow: [
		t("刚开始先用默认的严格权限。", "Start with the strict defaults."),
		t("反复弹出又确实安全的操作，再加进自动放行。", "Allow automatically only the prompts that keep appearing and are clearly safe."),
		t("删除、覆盖正文这类操作保持人工批准。", "Keep deleting or overwriting text on manual approval."),
	],
	bestPractices: [
		t("放行规则尽量具体，不要一次放开整类操作。", "Keep allow rules specific instead of opening a whole category at once."),
	],
	pitfalls: [
		t("放得太宽，可能让 AI 未经你确认就改动不该改的内容。", "Rules that are too broad can let the AI change things without your confirmation."),
	],
	agentHints: [
		t("申请敏感操作前先说明目的和必要性。", "Explain the purpose and necessity before asking for a sensitive action."),
	],
};

const routines: RuntimeLearningDocumentOverride = {
	summary: t(
		"套路把常用的指令、工具档位和权限打包起来，让叙述者每次都按同样的规矩干活。",
		"Routines bundle reusable instructions, tool modes and permissions so the narrator follows the same rules every time.",
	),
	sections: [
		{
			title: t("套路适合做什么", "What routines are for"),
			body: t(
				"适合把反复要交代的事沉淀下来，例如小说工具的手动 / 自动 / 常驻档位、固定的审稿要求。",
				"Use them for things you would otherwise repeat every time, such as manual / auto / resident modes for novel tools or a fixed review checklist.",
			),
		},
	],
	bestPractices: [
		t("套路名写清它要达成什么，例如「每章审稿清单」。", "Name routines after their outcome, e.g. 'chapter review checklist'."),
		t("套路行为变了，在描述里写明变化。", "Note changes in the description when a routine's behavior changes."),
	],
};

const skills: RuntimeLearningDocumentOverride = {
	summary: t(
		"技能是写成文字的做事方法，比如怎么写开篇、怎么审一章；启用后，任务对得上时叙述者会先读技能再动手。",
		"Skills are written-down methods, such as how to open a book or review a chapter; once enabled, the narrator loads the matching skill before it starts.",
	),
	sections: [
		{
			title: t("本书技能与全局技能", "Book skills and global skills"),
			body: t(
				"写作技能按书启用，在「技能文风 › 写作技能」里打开；全局技能对所有书生效，适合你自己的通用写法。",
				"Writing skills are enabled per book under Skills & style › Writing skills; global skills apply to every book and suit your general habits.",
			),
		},
		{
			title: t("叙述者怎么用技能", "How the narrator uses skills"),
			body: t(
				"叙述者能看到已启用的技能列表，任务对得上时把完整方法读进当前对话，再照着做。",
				"The narrator sees the enabled skills and, when a task matches, loads the full method into the conversation and follows it.",
			),
		},
	],
	workflow: [
		t("同样的要求反复交代时，把它写成技能。", "Turn instructions you keep repeating into a skill."),
		t("写清什么时候该用这个技能。", "State clearly when the skill should be used."),
		t("在要用的书里启用它。", "Enable it in the books that need it."),
	],
};

const providersModelsAndQuotas: RuntimeLearningDocumentOverride = {
	sections: [
		{
			title: t("供应商配置", "Provider setup"),
			body: t(
				"NovelFork 自己不带 AI，支持接入多个供应商；至少配好一个能用的供应商，叙述者、蒸馏和结算才能运行。",
				"NovelFork has no built-in AI and supports several providers; configure at least one working provider before the narrator, distillation and settlement can run.",
			),
		},
		{
			title: t("模型选择", "Model choice"),
			body: t(
				"写正文、审稿用强一些的模型；摘要、结算这类例行活可以在质量够用时选更快或更便宜的模型。",
				"Use stronger models for drafting and reviewing; routine work such as summaries and settlement can use faster or cheaper models when quality allows.",
			),
		},
	],
};

const filesSnapshotsAndSharing: RuntimeLearningDocumentOverride = {
	summary: t(
		"NovelFork 会记录文件改动，可从快照恢复，支持上传资料，也能为文件生成临时分享链接。",
		"NovelFork tracks file changes, can restore snapshots, accepts uploads, and can create temporary share links for files.",
	),
	workflow: [
		t("参考资料可以上传给叙述者当上下文。", "Upload reference material for the narrator to use as context."),
		t("分享前检查内容，不要外发未公开的稿子或私人信息。", "Check content before sharing; do not send out unpublished drafts or private details."),
		t("在储存空间设置里查看数据占用。", "Check data usage in storage settings."),
	],
	bestPractices: [
		t("多个文件打包后再分享，不要生成一堆单文件链接。", "Bundle several files into one share instead of many single-file links."),
	],
};

export const NOVELFORK_LEARNING_PRESENTATION: RuntimeLearningPresentation = {
	brandName: "NovelFork",
	hiddenBuiltinDocIds: HIDDEN_RUNTIME_LEARNING_DOC_IDS,
	builtinDocOverrides: {
		overview,
		narrators,
		"subagents-and-plan-mode": subagentsAndPlanMode,
		"permissions-and-safety": permissionsAndSafety,
		routines,
		skills,
		"providers-models-and-quotas": providersModelsAndQuotas,
		"files-snapshots-and-sharing": filesSnapshotsAndSharing,
	},
	builtinCategoryOverrides: {
		automation: {
			description: t("套路、技能与可复用的写作流程。", "Routines, skills and reusable writing workflows."),
		},
		runtime: {
			label: t("文件与储存", "Files and storage"),
			description: t("文件、快照、上传、分享与储存空间。", "Files, snapshots, uploads, sharing and storage."),
		},
	},
	// 先讲入门与写书，再讲写作课；Runtime 的通用能力排在后面。
	categoryOrder: ["start", "novelfork-book", "novelfork-craft", "agent", "automation", "admin", "runtime"],
};
