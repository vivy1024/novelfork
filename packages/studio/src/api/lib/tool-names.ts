/**
 * 工具名常量 — 确保 system prompt 和 tool registry 引用相同的名字。
 * 
 * 来源：
 * - 通用工具：packages/studio/src/api/lib/session-tool-registry.ts
 * - 小说工具：packages/novel-plugin/src/handlers/tool-registry.ts
 */

// ── 通用文件/搜索工具 ──
export const TOOL_READ = "Read";
export const TOOL_WRITE = "Write";
export const TOOL_EDIT = "Edit";
export const TOOL_APPLY_PATCH = "ApplyPatch";
export const TOOL_GLOB = "Glob";
export const TOOL_GREP = "Grep";

// ── Shell / 运行时 ──
export const TOOL_BASH = "Bash";
export const TOOL_TERMINAL = "Terminal";
export const TOOL_AWAIT = "Await";

// ── 交互 ──
export const TOOL_ASK_USER_QUESTION = "AskUserQuestion";
export const TOOL_ENTER_PLAN_MODE = "EnterPlanMode";
export const TOOL_EXIT_PLAN_MODE = "ExitPlanMode";

// ── 任务管理 ──
export const TOOL_TASK_CREATE = "TaskCreate";

// ── Agent / 协作 ──
export const TOOL_AGENT = "Agent";
export const TOOL_SEND = "Send";
export const TOOL_FORK_NARRATOR = "ForkNarrator";

// ── 浏览器 / 搜索 ──
export const TOOL_BROWSER = "Browser";
export const TOOL_WEB_SEARCH = "WebSearch";
export const TOOL_WEB_FETCH = "WebFetch";

// ── 上下文 ──
export const TOOL_RECALL = "Recall";
export const TOOL_START_PIPELINE = "StartPipeline";
export const TOOL_END_PIPELINE = "EndPipeline";
export const TOOL_LEARNING_GUIDE = "LearningGuide";

// ── 目标 ──
export const TOOL_GET_GOALS = "GetGoals";
export const TOOL_ADD_GOAL = "AddGoal";
export const TOOL_UPDATE_GOAL = "UpdateGoal";

// ── Skills ──
export const TOOL_SKILL = "Skill";
export const TOOL_TOOL_SEARCH = "ToolSearch";

// ── 文件分享 ──
export const TOOL_SHARE_FILE = "ShareFile";

// ── Worktree ──
export const TOOL_ENTER_WORKTREE = "EnterWorktree";
export const TOOL_EXIT_WORKTREE = "ExitWorktree";

// ═══════════════════════════════════════════════════
// 小说领域工具 (novel-plugin)
// ═══════════════════════════════════════════════════

// ── Cockpit（驾驶舱） ──
export const TOOL_COCKPIT_SNAPSHOT = "cockpit.snapshot";
export const TOOL_COCKPIT_GET_SNAPSHOT = "cockpit.get_snapshot";
export const TOOL_COCKPIT_LIST_OPEN_HOOKS = "cockpit.list_open_hooks";
export const TOOL_COCKPIT_LIST_RECENT_CANDIDATES = "cockpit.list_recent_candidates";

// ── PGI（追问引擎） ──
export const TOOL_PGI_ASK = "pgi.ask";
export const TOOL_PGI_GENERATE_QUESTIONS = "pgi.generate_questions";
export const TOOL_PGI_RECORD_ANSWERS = "pgi.record_answers";
export const TOOL_PGI_FORMAT_ANSWERS = "pgi.format_answers_for_prompt";

// ── 引导式创作 ──
export const TOOL_GUIDED_ENTER = "guided.enter";
export const TOOL_GUIDED_ANSWER = "guided.answer_question";
export const TOOL_GUIDED_EXIT = "guided.exit";

// ── 问卷 ──
export const TOOL_QUESTIONNAIRE_LIST = "questionnaire.list_templates";
export const TOOL_QUESTIONNAIRE_START = "questionnaire.start";
export const TOOL_QUESTIONNAIRE_SUGGEST = "questionnaire.suggest_answer";
export const TOOL_QUESTIONNAIRE_SUBMIT = "questionnaire.submit_response";

// ── 经纬（Jingwei） ──
export const TOOL_JINGWEI_READ = "jingwei.read";
export const TOOL_JINGWEI_READ_BRIEF = "jingwei.read_brief";
export const TOOL_JINGWEI_READ_CATEGORY = "jingwei.read_category";
export const TOOL_JINGWEI_SEARCH = "jingwei.search";
export const TOOL_JINGWEI_READ_CONTEXT = "jingwei.read_context";
export const TOOL_JINGWEI_WRITE = "jingwei.write";
export const TOOL_JINGWEI_UPSERT = "jingwei.upsert_entry";

// ── 章节 ──
export const TOOL_CHAPTER_READ = "chapter.read";
export const TOOL_CHAPTER_LIST = "chapter.list";
export const TOOL_CHAPTER_AUDIT = "chapter.audit";

// ── 候选稿 ──
export const TOOL_CANDIDATE_CREATE = "candidate.create_chapter";

// ── 写作管线 ──
export const TOOL_PIPELINE_WRITE = "pipeline.write";
export const TOOL_PIPELINE_GENERATE_CHAPTER = "pipeline.generate_chapter";
export const TOOL_PIPELINE_REVISE = "pipeline.revise";
export const TOOL_PIPELINE_IMPORT = "pipeline.import_chapters";

// ── 场景蓝图 ──
export const TOOL_SCENE_SPEC = "scene.spec";

// ── 改写 ──
export const TOOL_REWRITE_SEGMENT = "rewrite.segment";

// ── 文风 ──
export const TOOL_STYLE_IMPORT = "style.import";

// ── 大纲 ──
export const TOOL_OUTLINE_SUGGEST = "outline.suggest_next";

// ── 角色 ──
export const TOOL_CHARACTER_CHECK = "character.check_consistency";

// ── 伏笔 ──
export const TOOL_HOOKS_MANAGE = "hooks.manage";

// ── 健康度 ──
export const TOOL_HEALTH_SUMMARY = "health.read_summary";

// ── 预设（Presets） ──
export const TOOL_PRESETS_READ = "presets.read";
export const TOOL_PRESETS_WRITE = "presets.write";
export const TOOL_PRESETS_CHECK_COMPLIANCE = "presets.check_compliance";
// deprecated（v2 合并为 presets.read/write，handler 保留兼容）
export const TOOL_PRESETS_GET_RULES = "presets.get_rules";
export const TOOL_PRESETS_SET_RULES = "presets.set_rules";
export const TOOL_PRESETS_CREATE_CUSTOM = "presets.create_custom";
export const TOOL_PRESETS_LIST_AVAILABLE = "presets.list_available";

// ── 节拍模板（Beat） ──
export const TOOL_BEAT_READ = "beat.read";
export const TOOL_BEAT_WRITE = "beat.write";
// deprecated（v2 合并为 beat.read/write，handler 保留兼容）
export const TOOL_BEAT_GET_CURRENT = "beat.get_current";
export const TOOL_BEAT_SET_TEMPLATE = "beat.set_template";
export const TOOL_BEAT_CREATE_CUSTOM = "beat.create_custom";

// ── 叙事行编辑 ──
export const TOOL_NARRATIVE_READ_LINE = "narrative.read_line";
export const TOOL_NARRATIVE_PROPOSE_CHANGE = "narrative.propose_change";

// ── 资源管理 ──
export const TOOL_RESOURCE_MANAGE = "resource.manage";
