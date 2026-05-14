/**
 * Post-write preset compliance checker.
 * Checks chapter content against enabled preset rules.
 */

export interface ComplianceViolation {
  presetId: string;
  presetName: string;
  rule: string;
  violation: string;
  severity: "warning" | "error";
  location?: { line?: number; excerpt?: string };
}

export interface ComplianceCheckResult {
  violations: ComplianceViolation[];
  checkedPresets: number;
  passedPresets: number;
}

/**
 * Check chapter content against enabled preset rules.
 * This is a local check (no LLM call) — uses regex/keyword matching.
 */
export function checkPresetCompliance(
  chapterContent: string,
  enabledPresets: Array<{ id: string; name: string; rules: string; antiPatterns?: string[] }>,
): ComplianceCheckResult {
  const violations: ComplianceViolation[] = [];
  let passed = 0;

  for (const preset of enabledPresets) {
    let hasViolation = false;

    // Check anti-patterns (regex patterns that should NOT appear)
    if (preset.antiPatterns) {
      for (const pattern of preset.antiPatterns) {
        try {
          const regex = new RegExp(pattern, "g");
          const matches = chapterContent.match(regex);
          if (matches && matches.length > 0) {
            hasViolation = true;
            violations.push({
              presetId: preset.id,
              presetName: preset.name,
              rule: `禁止模式: ${pattern}`,
              violation: `发现 ${matches.length} 处匹配: "${matches[0]}"`,
              severity: "warning",
              location: { excerpt: matches[0] },
            });
          }
        } catch {
          /* invalid regex, skip */
        }
      }
    }

    // Check rules text for common constraint patterns
    const ruleLines = preset.rules.split("\n").filter((l) => l.trim());
    for (const rule of ruleLines) {
      // "禁止" / "不要" / "避免" rules — check if content contains the forbidden thing
      const forbidMatch = rule.match(/(?:禁止|不要|避免|不得|不可)(?:使用|出现|写)?[：:]?\s*(.+)/);
      if (forbidMatch) {
        const forbidden = forbidMatch[1].trim().split(/[，,、]/);
        for (const word of forbidden) {
          const trimmed = word.trim().replace(/[。.！!？?]/g, "");
          if (trimmed.length >= 2 && chapterContent.includes(trimmed)) {
            hasViolation = true;
            violations.push({
              presetId: preset.id,
              presetName: preset.name,
              rule: rule.trim(),
              violation: `内容中出现了"${trimmed}"`,
              severity: "warning",
            });
          }
        }
      }
    }

    if (!hasViolation) passed++;
  }

  return { violations, checkedPresets: enabledPresets.length, passedPresets: passed };
}
