export type {
  SensitiveWord,
  SensitiveHit,
  SensitiveScanResult,
  BookSensitiveScanResult,
  SupportedPlatform,
  SensitiveWordCategory,
  SensitiveWordSeverity,
  RulePackMetadata,
  ComplianceEvidence,
  ChapterAiTasteSignal,
  BookAiTasteReport,
  FormatIssue,
  FormatIssueSeverity,
  FormatCheckResult,
  PublishReadinessReport,
  PublishReadinessStatus,
  AiDisclosure,
} from "./types.js";

export { loadDictionary, scanChapter, scanBook, type ChapterInput } from "./sensitive-scanner.js";
export {
  AI_TASTE_METHODOLOGY,
  AI_TASTE_RULE_PACK,
  assessBookAiTaste,
  assessChapterAiTaste,
  normalizeAiTasteScore,
  type ChapterAiTasteInput,
} from "./ai-taste-assessment.js";
export { NOVELFORK_RISK_RULE_PACK } from "./rule-pack.js";
export { checkFormat, type BookFormatConfig, type FormatChapterInput } from "./format-checker.js";
export { checkPublishReadiness, type PublishReadinessChapterInput } from "./publish-readiness.js";
export { generateAiDisclosure, type AiDisclosureInput } from "./ai-disclosure-generator.js";
export {
  checkRegisterGuardrail,
  collectBookForbiddenSourceTerms,
  DEFAULT_ALLOWED_ASCII_ACRONYMS,
  extractConfirmedLoreExemptions,
  runBookRegisterGuardrail,
  type CheckRegisterGuardrailInput,
  type ConfirmedEntryLike,
  type ConfirmedLoreExemptions,
  type ForbiddenTermSourceEntry,
  type RegisterGuardrailReport,
  type RegisterGuardrailViolation,
  type RegisterViolationKind,
} from "./register-guardrail.js";
