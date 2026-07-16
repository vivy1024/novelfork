import type { RuntimeLearningContribution, RuntimeLearningLocalizedText } from "@vivy1024/novelfork-core/plugins";

const text = (en: string, zh: string): RuntimeLearningLocalizedText => ({ en, "zh-CN": zh });
const booksAction = (labelEn: string, labelZh: string, descriptionEn: string, descriptionZh: string) => ({
  label: text(labelEn, labelZh),
  description: text(descriptionEn, descriptionZh),
  href: "/next/books",
});

/**
 * Product-owned learning content. Every statement and action is grounded in the
 * current controlled Runtime book contract and retained NovelFork workbench.
 */
export const NOVEL_LEARNING_CONTRIBUTION = {
  categories: [
    {
      id: "novelfork-writing",
      label: text("NovelFork writing", "NovelFork 写作"),
      description: text(
        "Create books, work in the retained IDE, write chapters, and collaborate with a bound narrator.",
        "创建作品、使用保留的 IDE 工作台、编写章节，并与绑定叙述者协作。",
      ),
    },
    {
      id: "novelfork-context",
      label: text("NovelFork context and memory", "NovelFork 设定与记忆"),
      description: text(
        "Static Jingwei/Lore, dynamic Narrative Memory, and controlled writing resources.",
        "静态经纬/Lore、动态 Narrative Memory 与受控写作资源。",
      ),
    },
    {
      id: "novelfork-review",
      label: text("NovelFork review and versions", "NovelFork 审查与版本"),
      description: text(
        "Audit generated writing, understand candidate states, and inspect version lineage.",
        "审查生成内容、理解候选稿状态并检查版本谱系。",
      ),
    },
  ],
  docs: [
    {
      id: "novelfork-books",
      category: "novelfork-writing",
      tags: ["novelfork", "books", "create", "binding", "作品", "书籍"],
      title: text("Create and manage novels", "小说创建与书籍管理"),
      summary: text(
        "Create a Runtime-owned book, open its workbench, or let an administrator claim and repair a legacy book under the controlled storage root.",
        "创建由 Runtime 管理的作品并进入工作台；管理员也可接管或修复受控书籍根目录中的旧作品。",
      ),
      sections: [
        {
          title: text("Trusted book identity", "可信书籍身份"),
          body: text(
            "The product passes a semantic book ID. The Runtime owns the real path and narrator binding, and the browser never submits an arbitrary filesystem path.",
            "产品前端只提交语义 bookId；真实目录与叙述者绑定由 Runtime 服务端维护，浏览器不会提交任意文件路径。",
          ),
        },
        {
          title: text("Available management operations", "当前管理操作"),
          body: text(
            "The My Books page lists status, opens the workbench, creates books, lets administrators claim an existing controlled book, and revalidates a damaged Runtime binding.",
            "“我的作品”页面可查看状态、打开工作台、新建作品；管理员可接管受控目录中的旧作品，并重新校验异常的 Runtime 绑定。",
          ),
        },
      ],
      workflow: [
        text("Open My Books and choose New Book.", "打开“我的作品”，选择“新建作品”。"),
        text("Enter the product metadata required by the creation dialog, then wait for Runtime provisioning to finish.", "填写创建对话框要求的作品信息，等待 Runtime 完成受控初始化。"),
        text("Open the created book's workbench and create the first chapter there.", "从作品卡片进入工作台，再在工作台中创建第一章。"),
      ],
      bestPractices: [
        text("Use Claim Legacy Book only for a book already present under the Runtime-controlled root.", "仅对已位于 Runtime 受控根目录中的旧作品使用“接管旧作品”。"),
        text("Use Repair Binding when the workbench reports a binding problem; do not edit binding records by hand.", "工作台报告绑定异常时使用“修复绑定”，不要手工修改绑定记录。"),
      ],
      pitfalls: [
        text("A book ID is not a filesystem path and cannot be used to escape the controlled storage root.", "bookId 不是文件路径，不能用它绕过受控书籍根目录。"),
        text("Claiming legacy books is an administrator operation, not a general import dialog.", "接管旧作品是管理员操作，不是任意目录导入器。"),
      ],
      agentHints: [
        text("Never ask the model to invent a book path or switch bookId through tool arguments.", "不要让模型猜测书籍路径，也不要通过工具参数切换 bookId。"),
      ],
      actions: [booksAction("Open My Books", "打开我的作品", "Create, claim, repair, or open a novel.", "创建、接管、修复或打开作品。")],
    },
    {
      id: "novelfork-workbench",
      category: "novelfork-writing",
      tags: ["novelfork", "workbench", "ide", "resources", "工作台"],
      title: text("Use the writing workbench", "写作工作台"),
      summary: text(
        "The retained IDE workbench loads chapters, drafts, candidates, references, Jingwei, Narrative Memory, tools, and the bound narrator through the authenticated Runtime contract.",
        "保留的 IDE 工作台通过认证 Runtime 契约加载章节、草稿、候选稿、参考资料、经纬、Narrative Memory、工具与绑定叙述者。",
      ),
      sections: [
        {
          title: text("Resource tree", "资源树"),
          body: text(
            "Runtime resources are grouped into Chapters, Candidates, Drafts, Archived, and Outline & Settings. Jingwei and Narrative Memory have dedicated entries. Archived and rejected resources remain separated from active writing.",
            "Runtime 资源按“章节、候选稿、草稿、已归档、大纲与设定”分组；经纬与 Narrative Memory 有独立入口，归档和已拒绝资源不会混入当前写作区。",
          ),
        },
        {
          title: text("Controlled editing", "受控编辑"),
          body: text(
            "Only resources whose Runtime capabilities allow update are editable. Saving goes back through the book-scoped product client, which revalidates the server-owned binding.",
            "只有 Runtime capability 允许 update 的资源才能编辑；保存经由书籍作用域产品客户端回写，并由服务端再次校验可信绑定。",
          ),
        },
      ],
      workflow: [
        text("Open a book from My Books.", "从“我的作品”打开一本书。"),
        text("Select a resource in the left tree; use the center editor for writing and the right narrator panel for collaboration.", "在左侧资源树选择资源，使用中间编辑器写作，并在右侧叙述者面板协作。"),
        text("Use the Tools section for quality, health, progress, structure, collaboration, and version views.", "使用“工具”分区查看质量、健康、进度、结构、协作与版本信息。"),
      ],
      bestPractices: [
        text("Keep one concrete writing goal per narrator conversation and verify the resulting resource in the editor.", "每次叙述者对话聚焦一个明确写作目标，并在编辑器中核对产物。"),
        text("Treat readonly and unsupported badges as real capability boundaries.", "把“只读”和“不支持”标记视为真实能力边界。"),
      ],
      pitfalls: [
        text("The workbench does not turn every file under the book directory into an editable resource.", "工作台不会把书籍目录下的每个文件都变成可编辑资源。"),
      ],
      agentHints: [
        text("Use book-scoped tools and the current trusted binding instead of generic file operations.", "优先使用书籍作用域工具与当前可信绑定，不要改用通用文件操作绕过边界。"),
      ],
      actions: [booksAction("Open a workbench", "打开写作工作台", "Choose a book and open its retained IDE workbench.", "选择作品并进入保留的 IDE 工作台。")],
    },
    {
      id: "novelfork-chapter-flow",
      category: "novelfork-writing",
      tags: ["novelfork", "chapter", "editor", "autosave", "章节", "创作流程"],
      title: text("Chapter creation workflow", "章节创作流程"),
      summary: text(
        "Create chapters through the controlled workbench, edit Markdown with the TipTap chapter editor, and let the authenticated product client save the resource.",
        "通过受控工作台创建章节，使用 TipTap 章节编辑器编写 Markdown，并由认证产品客户端保存资源。",
      ),
      sections: [
        {
          title: text("Create and save", "创建与保存"),
          body: text(
            "New Chapter calls the Runtime workspace chapter endpoint, appends the returned resource to the chapter group, and opens it. Editor changes are debounced for 1.5 seconds before the workbench save callback runs.",
            "“新建章节”调用 Runtime 工作区章节接口，将返回资源加入章节分组并打开；编辑器改动经过 1.5 秒防抖后触发工作台保存。",
          ),
        },
        {
          title: text("Editor capabilities", "编辑器能力"),
          body: text(
            "The editor keeps Markdown, counts Chinese characters and English words, supports Ctrl/Cmd+F and Ctrl/Cmd+H, preserves local undo history, and can show a minimap.",
            "编辑器保存 Markdown，统计中文字与英文词，支持 Ctrl/Cmd+F、Ctrl/Cmd+H、本地撤销历史和小地图。",
          ),
        },
      ],
      workflow: [
        text("Open the target book and choose New Chapter.", "打开目标作品，点击“新建章节”。"),
        text("Write or paste the chapter, then pause long enough for the debounced save to complete.", "编写或粘贴正文，停顿片刻让防抖保存完成。"),
        text("Run the relevant audit or quality tools before treating the chapter as final.", "将章节视为定稿前，运行相关审查或质量工具。"),
      ],
      bestPractices: [
        text("Create new chapters from the workbench instead of asking a model to invent chapter files.", "从工作台创建新章节，不要让模型自行创建或猜测章节文件。"),
        text("Use search and replace for mechanical edits, and review AI changes before they are saved.", "机械修改优先用查找替换；AI 改动保存前仍需人工检查。"),
      ],
      pitfalls: [
        text("Closing the page immediately after typing can race the 1.5-second debounced save.", "输入后立即关闭页面可能与 1.5 秒防抖保存发生竞态。"),
      ],
      agentHints: [
        text("chapter.write edits an existing bound chapter and remains permission-gated; it is not the new-chapter entry point.", "chapter.write 用于修改已绑定章节且受权限门控，不是新建章节入口。"),
      ],
      actions: [booksAction("Write a chapter", "开始章节创作", "Choose a book, enter the workbench, and create or edit a chapter.", "选择作品，进入工作台并创建或编辑章节。")],
    },
    {
      id: "novelfork-jingwei-lore",
      category: "novelfork-context",
      tags: ["novelfork", "jingwei", "lore", "worldbuilding", "经纬", "设定"],
      title: text("Jingwei and Lore", "经纬与 Lore"),
      summary: text(
        "Use Jingwei for static authorial facts such as characters, locations, factions, rules, and reference material; keep changing story state in Narrative Memory.",
        "用经纬保存角色、地点、势力、规则与参考资料等静态作者设定；会随剧情变化的状态应进入 Narrative Memory。",
      ),
      sections: [
        {
          title: text("Editable static entries", "可编辑的静态条目"),
          body: text(
            "Jingwei entries support title and Markdown content editing, preview mode, deletion when permitted, related-entry navigation, and revision history with source labels.",
            "经纬条目支持标题与 Markdown 内容编辑、预览、按权限删除、关联条目跳转，以及带来源标记的修改历史。",
          ),
        },
        {
          title: text("Context priority", "上下文优先级"),
          body: text(
            "Priority can be automatic, core, relevant, or reference. Auto context includes core and relevant layers; core and relevant modes restrict selection to that layer, while full mode also includes reference entries.",
            "优先级可设为自动、核心、相关或参考：auto 上下文包含核心与相关层；core、relevant 模式分别只选对应层，full 模式还会包含参考条目。"
          ),
        },
      ],
      workflow: [
        text("Open a book, choose Jingwei Data, and select or create the appropriate static category entry.", "打开作品，进入“经纬资料”，选择或创建合适的静态分类条目。"),
        text("Write stable facts and set the lowest priority that still matches their importance.", "只写稳定事实，并选择足以表达重要性的最低优先级。"),
        text("Use Relations and History to inspect references and previous edits.", "使用“关联”和“历史”检查引用关系与既往修改。"),
      ],
      bestPractices: [
        text("Use core sparingly so the Agent context is not crowded by low-value facts.", "谨慎使用“核心”，避免低价值设定长期占用 Agent 上下文。"),
        text("Keep a fact in one authoritative entry and link related entries instead of duplicating it.", "同一事实保留一个权威条目，通过关联链接其他条目，避免重复。"),
      ],
      pitfalls: [
        text("Do not record changing relationships, unresolved events, or chapter-by-chapter state as static Lore.", "不要把变化中的关系、未确认事件或逐章状态写成静态 Lore。"),
      ],
      agentHints: [
        text("Use lore tools for static facts and memory tools for dynamic story facts.", "静态事实使用 lore 工具，动态剧情事实使用 memory 工具。"),
      ],
      actions: [booksAction("Open Jingwei", "打开经纬资料", "Choose a book and open the Jingwei entry in its workbench.", "选择作品并在工作台打开经纬资料。")],
    },
    {
      id: "novelfork-narrative-memory",
      category: "novelfork-context",
      tags: ["novelfork", "narrative-memory", "facts", "events", "timeline", "叙事记忆"],
      title: text("Narrative Memory", "Narrative Memory 叙事记忆"),
      summary: text(
        "Narrative Memory stores dynamic story facts and events, exposes recall diagnostics and pending events, and keeps them separate from static Jingwei/Lore.",
        "Narrative Memory 保存动态剧情事实与事件，展示召回诊断和待处理事件，并与静态经纬/Lore 保持边界。",
      ),
      sections: [
        {
          title: text("What the panel shows", "面板展示内容"),
          body: text(
            "The workbench loads the latest recall diagnostics and pending events, displays dynamic fact categories, channel latency and token estimates, warnings, and an optional wave summary.",
            "工作台会加载最近一次召回诊断与待处理事件，并展示动态事实分类、通道耗时、token 估算、警告与可用的 Wave 摘要。",
          ),
        },
        {
          title: text("Current view boundary", "当前视图边界"),
          body: text(
            "The navigation lists overview, graph, timeline, character arcs, foreshadowing, conflicts, and event chains. Several side views currently direct the user to the full memory graph rather than rendering a complete embedded view.",
            "导航包含总览、关系图、时间线、角色弧线、伏笔网络、矛盾地图和事件链；部分侧栏视图当前会引导打开完整记忆图谱，而不是在侧栏内完整渲染。",
          ),
        },
      ],
      workflow: [
        text("Run a writing or settlement flow so dynamic facts and events exist.", "先运行一次写作或结算流程，让动态事实与事件产生。"),
        text("Open Narrative Memory from the book resource tree and inspect warnings, pending events, and channel status.", "从书籍资源树打开 Narrative Memory，检查警告、待处理事件与通道状态。"),
        text("Use the full graph entry when a side view reports that no embedded view exists.", "侧栏提示暂无内置视图时，使用“打开完整记忆图谱”。"),
      ],
      bestPractices: [
        text("Treat confidence, risk, evidence, and chapter range as part of a dynamic fact's meaning.", "把置信度、风险、证据和章节范围视为动态事实的一部分。"),
        text("Review warnings and degraded channels before trusting a recall result.", "信任召回结果前先检查警告与降级通道。"),
      ],
      pitfalls: [
        text("No records before the first writing run is a valid empty state, not fabricated memory loss.", "首次写作运行前没有记录是正常空状态，不代表系统应伪造记忆。"),
      ],
      agentHints: [
        text("Pending or high-risk events must not be presented as confirmed canonical facts.", "待处理或高风险事件不得冒充已确认的正史事实。"),
      ],
      actions: [booksAction("Open Narrative Memory", "打开 Narrative Memory", "Choose a book and open its Narrative Memory entry.", "选择作品并打开其 Narrative Memory 入口。")],
    },
    {
      id: "novelfork-writing-resources",
      category: "novelfork-context",
      tags: ["novelfork", "resources", "context", "draft", "candidate", "写作资源", "上下文"],
      title: text("Writing resources and context", "写作资源与上下文"),
      summary: text(
        "NovelFork models chapters, drafts, and candidates as book-scoped writing resources and merges legacy database rows with current chapter files without resetting user data.",
        "NovelFork 将章节、草稿和候选稿建模为书籍作用域写作资源，并在不重置用户数据的前提下合并旧数据库记录与当前章节文件。",
      ),
      sections: [
        {
          title: text("Resource model", "资源模型"),
          body: text(
            "A writing resource has a type, status, title, content, optional chapter number and parent, version, source, metadata, word count, and timestamps. Active and archived resources are presented separately in the workbench.",
            "写作资源包含类型、状态、标题、正文、可选章节号与父版本、版本号、来源、元数据、字数和时间戳；工作台会区分当前资源与归档资源。",
          ),
        },
        {
          title: text("Hybrid storage", "混合存储"),
          body: text(
            "The service reads existing writing_resource rows and v3 chapter files together. It prefers the newer accepted chapter when both stores contain the same chapter number and does not run an implicit migration or reset.",
            "服务会同时读取既有 writing_resource 记录与 v3 章节文件；同一章节号同时存在时选择更新时间较新的正式章节，不会隐式迁移或重置。",
          ),
        },
      ],
      workflow: [
        text("Open the book workbench and locate the resource under Chapters, Drafts, Candidates, or Archived.", "打开书籍工作台，在章节、草稿、候选稿或已归档分组中定位资源。"),
        text("Edit only resources marked editable and verify their status before applying or deleting them.", "只编辑标记为可编辑的资源，应用或删除前确认其状态。"),
        text("Use version history when a formal chapter has a parent/version chain.", "正式章节存在 parent/version 链时使用版本历史检查来源。"),
      ],
      bestPractices: [
        text("Keep drafts and candidates separate from accepted chapters until review is complete.", "审查完成前，让草稿和候选稿与正式章节保持分离。"),
        text("Use source metadata to distinguish user edits from pipeline or session-tool output.", "利用来源元数据区分人工编辑、写作管线与会话工具产物。"),
      ],
      pitfalls: [
        text("Deleting a resource is a soft-delete or controlled file operation, not permission to delete arbitrary book files.", "删除资源是软删除或受控文件操作，不代表可以删除任意书籍文件。"),
      ],
      agentHints: [
        text("resource.manage currently exposes list, archive, and delete to the bound Agent; other state changes remain product-controlled.", "当前绑定 Agent 的 resource.manage 仅暴露列表、归档和删除；其他状态变更仍由产品契约控制。"),
      ],
      actions: [booksAction("Browse writing resources", "浏览写作资源", "Choose a book and inspect its Runtime resource tree.", "选择作品并检查其 Runtime 资源树。")],
    },
    {
      id: "novelfork-agent-writing",
      category: "novelfork-writing",
      tags: ["novelfork", "agent", "narrator", "inline-write", "rewrite", "续写", "AI 写作"],
      title: text("Agent-assisted writing", "Agent 辅助写作"),
      summary: text(
        "Use the book-bound narrator for larger tasks and the chapter editor's selection actions for continuation, polishing, rewriting, and expansion.",
        "较大任务使用书籍绑定叙述者；局部修改可使用章节编辑器的续写、润色、改写和扩写操作。",
      ),
      sections: [
        {
          title: text("Bound narrator", "书籍绑定叙述者"),
          body: text(
            "The workbench mounts a narrator returned by the book-scoped Runtime contract. Its novel tools receive the trusted book binding from the host, not a model-supplied bookId or path.",
            "工作台挂载书籍作用域 Runtime 契约返回的叙述者；小说工具从宿主获得可信书籍绑定，而不是采用模型提供的 bookId 或路径。",
          ),
        },
        {
          title: text("Inline writing", "局部 AI 写作"),
          body: text(
            "Selecting chapter text exposes Continue, Polish, Rewrite, and Expand. Continue inserts after the selection; the other three replace the selected range with the returned text.",
            "选中章节文字后可使用“续写、润色、改写、扩写”：续写在选区后插入结果，其余三项用返回结果替换选区。",
          ),
        },
      ],
      workflow: [
        text("Use inline actions for a small selected passage and the narrator panel for multi-step writing or analysis.", "小范围选中文本使用局部 AI 操作；多步骤写作或分析使用叙述者面板。"),
        text("State the target chapter and desired outcome, then let the Agent read only the context it needs.", "明确目标章节与预期结果，让 Agent 只读取必要上下文。"),
        text("Review the generated text, audit it, and save only after it fits the current story state.", "检查生成文本并运行审查，确认符合当前剧情状态后再保存。"),
      ],
      bestPractices: [
        text("Use small selections for rewrite and polish so unrelated prose is not replaced.", "改写和润色使用较小选区，避免替换无关正文。"),
        text("Ask for a plan before broad changes across chapters, Lore, and Narrative Memory.", "跨章节、Lore 与 Narrative Memory 的大范围改动先要求计划。"),
      ],
      pitfalls: [
        text("A successful model response is not proof that the prose is consistent, compliant, or saved.", "模型成功返回不代表文本已经一致、合规或完成保存。"),
        text("The Agent cannot create a new chapter by inventing a file path; use the workbench New Chapter action.", "Agent 不能通过猜测文件路径创建新章节，应使用工作台“新建章节”。"),
      ],
      agentHints: [
        text("Read before writing, respect permission gates, and preserve the Lore/Narrative Memory boundary.", "写入前先读取，遵守权限门控，并保持 Lore 与 Narrative Memory 边界。"),
      ],
      actions: [
        booksAction("Open book narrator", "打开书籍叙述者", "Choose a book and use its embedded narrator panel.", "选择作品并使用其内嵌叙述者面板。"),
        {
          label: text("Open narrator sessions", "打开叙述者会话"),
          description: text("Review or continue Runtime narrator sessions.", "查看或继续 Runtime 叙述者会话。"),
          href: "/next/sessions",
        },
      ],
    },
    {
      id: "novelfork-candidates-versions",
      category: "novelfork-review",
      tags: ["novelfork", "candidate", "review", "audit", "history", "rollback", "候选稿", "版本"],
      title: text("Candidate review and version recovery", "候选稿审查与版本回退"),
      summary: text(
        "Review candidates and audit results before acceptance, understand replace/merge/new semantics, and use the parent/version chain to inspect earlier writing and plan a controlled recovery.",
        "候选稿接受前先检查正文与审查结果，理解替换、合并、新建语义，并通过 parent/version 链检查早期版本、规划受控恢复。"
      ),
      sections: [
        {
          title: text("Candidate state machine", "候选稿状态机"),
          body: text(
            "Drafts can become candidates; candidates can be accepted, rejected, archived, or returned to draft. Rejected resources can return to draft, and archived resources can be restored to candidate. Acceptance requires a positive chapter number and replace, merge, or new mode.",
            "草稿可转为候选稿；候选稿可接受、拒绝、归档或退回草稿。已拒绝资源可退回草稿，已归档资源可恢复为候选稿。接受时必须提供正整数章节号，并选择替换、合并或新建模式。",
          ),
        },
        {
          title: text("Versions and current UI boundary", "版本与当前界面边界"),
          body: text(
            "Accepting over an existing chapter archives the old version, increments the new version, and links it through parentId. The workbench can display chapter history and separates candidate/archived groups. Direct candidate transition and one-click rollback controls are not yet exposed in the retained workbench, so do not claim a version was restored merely because it appears in history.",
            "覆盖既有章节时，服务会归档旧版本、递增新版本号并通过 parentId 建立链路。工作台可展示章节历史，并区分候选稿与归档分组；保留的工作台目前尚未暴露完整候选稿状态按钮和一键回退控件，因此历史中可见旧版本不等于已经恢复。",
          ),
        },
        {
          title: text("Audit results", "审查结果"),
          body: text(
            "Pipeline results show whether audit passed, issue severity and category, whether an automatic revision ran, and Jingwei changes. Failed audits offer revise, ignore-and-settle, or regenerate guidance in the narrator conversation.",
            "写作管线结果会显示审查是否通过、问题级别与分类、是否自动修订，以及经纬变更；审查失败时，叙述者对话会提示修订、忽略并结算或重新生成。",
          ),
        },
      ],
      workflow: [
        text("Open the candidate or generated artifact and read the full text before changing its state.", "打开候选稿或生成产物，修改状态前先阅读全文。"),
        text("Review critical, warning, and informational audit findings; revise or regenerate when necessary.", "检查 critical、warning 与 info 审查项，必要时修订或重新生成。"),
        text("Before replacing or merging an existing chapter, inspect its version history and confirm the target chapter number.", "替换或合并既有章节前，检查版本历史并确认目标章节号。"),
        text("After a resource transition or pipeline settlement, verify the formal chapter and any Narrative Memory changes that flow actually produced instead of relying only on a response message.", "资源迁移或写作管线结算后，应核对正式章节，以及该流程实际产生的 Narrative Memory 变更，不要只依赖响应消息。"),
      ],
      bestPractices: [
        text("Prefer new mode when creating a genuinely new chapter and replace/merge only after checking the existing accepted chapter.", "真正的新章节优先使用 new；replace/merge 前先检查现有正式章节。"),
        text("Keep rejected work available as a draft when it may still contain reusable material.", "仍有可复用内容的已拒绝稿件可退回草稿，而不是直接删除。"),
      ],
      pitfalls: [
        text("The current retained workbench does not provide every transition or rollback as a visible button.", "当前保留工作台并未把所有状态迁移或回退能力都做成可见按钮。"),
        text("Merge concatenates the existing and candidate content; inspect the resulting seam and duplicated text.", "merge 会拼接既有正文与候选正文，必须检查衔接和重复内容。"),
      ],
      agentHints: [
        text("Never silently accept, reject, or overwrite a chapter without the user's intended chapter number and mode.", "未经用户明确目标章节号与模式，不要静默接受、拒绝或覆盖章节。"),
      ],
      actions: [booksAction("Review book resources", "审查书籍资源", "Choose a book and inspect candidates, archived resources, audit results, and chapter history.", "选择作品，检查候选稿、归档资源、审查结果与章节历史。")],
    },
  ],
} satisfies RuntimeLearningContribution;
