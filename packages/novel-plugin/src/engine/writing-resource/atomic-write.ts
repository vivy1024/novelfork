/**
 * 原子写文本文件（临时文件 + fsync + rename；Windows 瞬时占用 EPERM / EACCES / EBUSY 时短退避重试）。
 *
 * 全仓唯一实现在 core（`@vivy1024/novelfork-core` 的 utils/atomic-write.ts）；这里只保留原导入路径，
 * 免得牵动本插件与 product-runtime 的现有调用方。改行为只改 core 那一份，不要在这里再写一份。
 */
export {
  ATOMIC_RENAME_MAX_RETRIES,
  ATOMIC_RENAME_RETRYABLE_CODES,
  ATOMIC_RENAME_RETRY_STEP_MS,
  writeFileAtomic,
} from "@vivy1024/novelfork-core";
