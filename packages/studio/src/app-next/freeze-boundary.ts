export const FRONTEND_REWRITE_BOUNDARY = {
  sequence: [
    "freeze-legacy-frontend",
    "build-bypass-next-entry",
    "validate-first-phase-paths",
    "replace-after-acceptance",
  ],
  legacyFallback: true,
  allowedLegacyEditTypes: [
    "build-fix",
    "security-fix",
    "blocking-runtime-fix",
  ],
  nextEntryPath: "/next",
  replacementCondition: "第一阶段创作工作台、设置页、套路页浏览器验收通过后，才计划删除旧页面。",
} as const;
