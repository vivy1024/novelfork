/**
 * 项目档案的数据盘点：哪些文件、哪些表属于哪个模块，哪些不随档案迁移以及为什么。
 *
 * 这里是档案格式的唯一清单。新增按 book_id 存数据的表，要么登记进 ARCHIVE_TABLES，
 * 要么登记进 NOT_ARCHIVED_TABLES 并写明原因；两处都没有的表在导出时会被逐条列为
 * 「未包含」，不会被悄悄丢掉。
 */

export const BOOK_ARCHIVE_FORMAT = "novelfork-book-archive";
/** 当前档案格式版本。读取更新的版本会被明确拒绝；更旧的版本在 upgradeManifest 里逐级升级。 */
export const BOOK_ARCHIVE_FORMAT_VERSION = 1;

export type BookArchiveModuleId =
  | "chapters"
  | "jingwei"
  | "narrative"
  | "workflow"
  | "style"
  | "skills"
  | "references";

export interface BookArchiveModuleMeta {
  readonly id: BookArchiveModuleId;
  readonly label: string;
  readonly description: string;
}

export const BOOK_ARCHIVE_MODULES: readonly BookArchiveModuleMeta[] = [
  { id: "chapters", label: "正文", description: "章节正文与索引、候选稿与草稿、写作日志、章节审计、状态增量，以及 story/ 下的其他故事文件与快照" },
  { id: "jingwei", label: "经纬", description: "经纬分类、条目、修订历史、条目关系与依赖、推进记录、因果链、拆书待审条目" },
  { id: "narrative", label: "叙事记忆", description: "叙事事实与事件、结算证据与台账、角色内核、实体与关系、场景、剧情线与挂载、结构评分" },
  { id: "workflow", label: "工作流", description: "本书的工作流方案（story/workflow_recipes.json）" },
  { id: "style", label: "文风", description: "文风预设、旧文风档案、文风指南、文风蒸馏任务与文风金库（AI 原稿）" },
  { id: "skills", label: "技能", description: "书级写作技能（.novelfork/skills/）" },
  { id: "references", label: "参考来源", description: "文风蒸馏的来源正文快照、拆书草稿与作者素材记录" },
];

export const BOOK_ARCHIVE_MODULE_IDS: readonly BookArchiveModuleId[] = BOOK_ARCHIVE_MODULES.map((module) => module.id);

export function isBookArchiveModuleId(value: unknown): value is BookArchiveModuleId {
  return typeof value === "string" && (BOOK_ARCHIVE_MODULE_IDS as readonly string[]).includes(value);
}

export function moduleLabel(id: BookArchiveModuleId): string {
  return BOOK_ARCHIVE_MODULES.find((module) => module.id === id)?.label ?? id;
}

export interface ArchiveTableSpec {
  readonly name: string;
  readonly module: BookArchiveModuleId;
  /** 没有 book_id 列的子表：经父表的 id 选出本书的行。 */
  readonly parent?: { readonly table: string; readonly column: string };
}

/** 随档案迁移的表。顺序只影响档案内的排列；导入时外键检查延迟到提交，不依赖插入顺序。 */
export const ARCHIVE_TABLES: readonly ArchiveTableSpec[] = [
  // 正文：正式章节在文件里，这里是候选稿 / 草稿历史与章节级记录。
  { name: "writing_resource", module: "chapters" },
  { name: "writing_log", module: "chapters" },
  { name: "chapter_audit_log", module: "chapters" },
  { name: "filter_report", module: "chapters" },
  { name: "chapter_state_delta", module: "chapters" },
  // 经纬
  { name: "story_jingwei_section", module: "jingwei" },
  { name: "story_jingwei_entry", module: "jingwei" },
  { name: "jingwei_revision", module: "jingwei" },
  { name: "jingwei_relations", module: "jingwei" },
  { name: "jingwei_dependency", module: "jingwei" },
  { name: "jingwei_progressions", module: "jingwei" },
  { name: "jingwei_custom_category", module: "jingwei" },
  { name: "jingwei_causal_chains", module: "jingwei" },
  { name: "jingwei_cooccurrence", module: "jingwei" },
  { name: "jingwei_character", module: "jingwei" },
  { name: "jingwei_character_arc", module: "jingwei" },
  { name: "jingwei_event", module: "jingwei" },
  { name: "jingwei_setting", module: "jingwei" },
  { name: "jingwei_chapter_summary", module: "jingwei" },
  { name: "jingwei_conflict", module: "jingwei" },
  { name: "jingwei_world_model", module: "jingwei" },
  { name: "jingwei_premise", module: "jingwei" },
  { name: "questionnaire_response", module: "jingwei" },
  { name: "core_shift", module: "jingwei" },
  { name: "dissection_staging", module: "jingwei" },
  // 叙事记忆
  { name: "narrative_fact", module: "narrative" },
  { name: "narrative_event", module: "narrative" },
  { name: "narrative_settlement_artifact", module: "narrative" },
  { name: "narrative_chapter_settlement", module: "narrative" },
  { name: "character_kernel", module: "narrative" },
  { name: "narrative_chapter_mention", module: "narrative" },
  { name: "narrative_storyline", module: "narrative" },
  { name: "narrative_scene", module: "narrative" },
  { name: "narrative_scene_storyline", module: "narrative", parent: { table: "narrative_scene", column: "scene_id" } },
  { name: "narrative_structure_score", module: "narrative" },
  { name: "narrative_tag", module: "narrative" },
  { name: "narrative_card_tag", module: "narrative" },
  { name: "narrative_tag_edge", module: "narrative" },
];

export interface NotArchivedSpec {
  readonly name: string;
  readonly explanation: string;
  readonly parent?: { readonly table: string; readonly column: string };
  /** 导入时会为新书重新生成：导入报告里只作说明，不算缺失。 */
  readonly regenerated?: boolean;
}

/** 按书存数据、但不随档案迁移的表，以及原因。导出时有数据就逐条列入「未包含」。 */
export const NOT_ARCHIVED_TABLES: readonly NotArchivedSpec[] = [
  { name: "book_runtime_bindings", explanation: "书籍与 Runtime 项目的可信绑定属于本机；导入时为新书重新建立。", regenerated: true },
  { name: "book_provision_operations", explanation: "建书流程记录属于本机；导入时为新书重新生成。", regenerated: true },
  { name: "jingwei_fts_doc", explanation: "经纬检索索引是派生数据；导入后按经纬条目重建。", regenerated: true },
  { name: "narrative_context_vector", explanation: "实体向量缓存依赖本机配置的 embedding 模型；导入后可在叙事记忆里重新回填。" },
  { name: "narrative_retrieval_log", explanation: "上下文检索诊断日志只用于排查当次装配，不影响继续写作。" },
  { name: "request_log", explanation: "AI 调用用量与计费日志绑定源机器的账号和会话，不随作品迁移。" },
  { name: "workflow_runs", explanation: "工作流运行记录绑定源机器的叙述者会话，导入后无法继续执行；工作流方案本身在「工作流」模块里。" },
  { name: "workflow_run_steps", explanation: "随工作流运行记录一起不迁移。", parent: { table: "workflow_runs", column: "run_id" } },
  { name: "workflow_run_candidates", explanation: "随工作流运行记录一起不迁移。", parent: { table: "workflow_runs", column: "run_id" } },
  { name: "workflow_run_events", explanation: "随工作流运行记录一起不迁移。", parent: { table: "workflow_runs", column: "run_id" } },
  ...entityIndexNotArchived(),
];

/**
 * 实体索引：由经纬条目、叙事事实与事件派生（实体 ID 形如 ent:<bookId>:<经纬条目id>）。
 * 不随档案导出；导入完成后按新书重建。导入失败补偿时也要连同这些表一起清掉。
 */
export const DERIVED_ENTITY_INDEX_TABLES: readonly string[] = [
  "narrative_entity",
  "narrative_entity_alias",
  "narrative_event_participant",
  "narrative_relation",
  "narrative_state_change",
  "narrative_knowledge",
];

function entityIndexNotArchived(): NotArchivedSpec[] {
  return [
    { name: "narrative_entity", explanation: "实体索引由经纬条目、叙事事实与事件派生，不随档案导出；导入后按新书自动重建。", regenerated: true },
    { name: "narrative_entity_alias", explanation: "实体别名属于实体索引，导入后随实体索引重建。", regenerated: true },
    { name: "narrative_event_participant", explanation: "事件参与者属于实体索引，导入后随实体索引重建。", regenerated: true },
    { name: "narrative_relation", explanation: "实体关系属于实体索引（由事实派生），导入后随实体索引重建。", regenerated: true },
    { name: "narrative_state_change", explanation: "实体状态变化属于实体索引（由事实派生），导入后随实体索引重建。", regenerated: true },
    { name: "narrative_knowledge", explanation: "角色知识边界依附于实体索引，目前没有写入来源；重建实体索引时会被清空，不随档案迁移。" },
  ];
}

/** Runtime 与本机侧的数据：不在产品数据库里，档案里如实列出。 */
export const NOT_ARCHIVED_RUNTIME: readonly { readonly name: string; readonly explanation: string }[] = [
  { name: "叙述者会话与消息", explanation: "叙述者会话、消息与工具调用记录存放在 Runtime 数据库，属于 Runtime，不在本档案范围；导入后的新书会有新的叙述者。" },
  { name: "Runtime 项目配置", explanation: "书籍 Runtime 项目下的例程、Runtime 技能、钩子、MCP 与规则属于 Runtime 配置，不随作品迁移。" },
  { name: "版本库历史", explanation: "作品目录里的 .git 历史与 .worktrees 章节工作区由 Runtime 管理，不随档案迁移。" },
];

export type BookFileClass =
  | { readonly kind: "book" }
  | { readonly kind: "module"; readonly module: BookArchiveModuleId }
  | { readonly kind: "excluded"; readonly explanation: string };

const DERIVED_MEMORY_DB = new Set(["story/memory.db", "story/memory.db-wal", "story/memory.db-shm"]);
const REFERENCE_FILES = new Set(["story/dissect_draft.json", "story/market_radar.md", "story/web_materials.md"]);
const STYLE_FILES = new Set(["story/style_preset.json", "story/style_profile.json", "story/style_guide.md"]);
/** 作品根目录下允许迁移的点文件；其余点文件（如 .env）一律不导出也不导入。 */
const ALLOWED_ROOT_DOT_FILES = new Set([".writing-resource-migrated"]);

/**
 * 按作品根目录下的相对路径（正斜杠）判定文件归属。导出与导入共用：
 * 导入时档案里出现被判为 excluded 的路径（例如 .git/hooks）会被拒收，
 * 防止借档案往作品目录里放可执行配置。
 */
export function classifyBookFile(relativePath: string): BookFileClass {
  const segments = relativePath.split("/");
  const first = segments[0] ?? "";
  const last = segments[segments.length - 1] ?? "";
  if (relativePath === "book.json") return { kind: "book" };
  if (first.startsWith(".")) {
    if (first === ".novelfork") {
      if (last.startsWith(".env")) return { kind: "excluded", explanation: "环境变量文件可能含密钥，不随作品迁移。" };
      if (segments[1] === "skills" && segments.length > 2) return { kind: "module", module: "skills" };
      return { kind: "module", module: "chapters" };
    }
    if (segments.length === 1 && ALLOWED_ROOT_DOT_FILES.has(first)) return { kind: "module", module: "chapters" };
    return { kind: "excluded", explanation: "作品根目录下的隐藏目录与点文件（版本库、Runtime 工作区、编辑器与环境配置等）属于本机，不随作品迁移。" };
  }
  if (last.startsWith(".env")) return { kind: "excluded", explanation: "环境变量文件可能含密钥，不随作品迁移。" };
  if (last === ".write.lock" || last.endsWith(".lock") || last.endsWith(".tmp")) {
    return { kind: "excluded", explanation: "写锁与临时文件只在写入过程中存在，不随作品迁移。" };
  }
  if (DERIVED_MEMORY_DB.has(relativePath)) {
    return { kind: "excluded", explanation: "story/memory.db 是旧版派生索引，按需重建，不随作品迁移。" };
  }
  if (first === "chapters") return { kind: "module", module: "chapters" };
  if (relativePath === "story/workflow_recipes.json") return { kind: "module", module: "workflow" };
  if (relativePath.startsWith("story/style-distillations/")) {
    return last.endsWith(".source.json") ? { kind: "module", module: "references" } : { kind: "module", module: "style" };
  }
  if (STYLE_FILES.has(relativePath)) return { kind: "module", module: "style" };
  // 文风金库：每章的 AI 原稿（story/style-vault/chapter-NNNN.json），是作者数据，随「文风」迁移。
  if (relativePath.startsWith("story/style-vault/")) return { kind: "module", module: "style" };
  if (REFERENCE_FILES.has(relativePath)) return { kind: "module", module: "references" };
  return { kind: "module", module: "chapters" };
}

/** 导入时会为新书重新生成的表名。 */
export const REGENERATED_ON_IMPORT: ReadonlySet<string> = new Set(
  NOT_ARCHIVED_TABLES.filter((spec) => spec.regenerated).map((spec) => spec.name),
);
