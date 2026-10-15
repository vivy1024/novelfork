/**
 * 章节文件路径守卫（S1.1）。
 *
 * 判定逻辑在 T-01 下沉到 core（`@vivy1024/novelfork-core` 的 utils/chapter-path-guard.ts），
 * 成为全仓唯一实现：core 的 state-bootstrap 与本插件读写章节都走同一套检查，
 * 不再各写一份强弱不一的守卫。这里只保留原导出名，免得牵动现有调用方。
 *
 * 规则摘要（详见 core 实现）：字符串层拒绝越界、绝对路径、盘符、`:`、`.`/`..`、
 * Windows 保留设备名（含 CONIN$、CONOUT$、COM¹²³/LPT¹²³）与段末尾点/空格；
 * 真实落点层拒绝指向书外的联接/符号链接与一切悬空链接。
 * 批量判定（如逐条过滤索引）请用 createChapterFileResolver，章节目录的 realpath 只算一次。
 */
export { createChapterFileResolver, requireChapterFile, resolveChapterFile } from "@vivy1024/novelfork-core";
