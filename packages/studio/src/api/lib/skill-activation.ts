/**
 * Skill Conditional Activation — dynamically enables/disables tools
 * based on project context.
 *
 * Instead of always injecting all 90+ tools into every prompt,
 * this module determines which tools are relevant based on:
 * - File types present in the project (e.g., .ts → TypeScript tools)
 * - Directory structure (e.g., has packages/ → monorepo tools)
 * - Session state (e.g., writing mode → novel tools)
 * - Explicit user configuration
 *
 * This reduces prompt size and improves model focus.
 */

import { readdirSync, existsSync } from "node:fs";
import { extname } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface ProjectSignals {
  /** File extensions found in the project root (e.g., [".ts", ".tsx", ".json"]) */
  fileExtensions?: string[];
  /** Key directories found (e.g., ["packages", "src", "node_modules"]) */
  directories?: string[];
  /** Whether the project has a specific framework indicator */
  frameworks?: string[];
  /** Current session mode (e.g., "novel-writing", "coding", "research") */
  sessionMode?: string;
  /** Explicit tool allowlist from user config */
  userAllowlist?: string[];
  /** Explicit tool denylist from user config */
  userDenylist?: string[];
}

export interface ActivationRule {
  /** Human-readable description */
  description: string;
  /** Condition function — returns true if the rule matches */
  condition: (signals: ProjectSignals) => boolean;
  /** Tools to ENABLE when condition matches */
  enableTools?: string[];
  /** Tools to DISABLE when condition matches */
  disableTools?: string[];
  /** Priority (higher = evaluated later, can override earlier rules) */
  priority?: number;
}

export interface ActivationResult {
  /** Tools that should be enabled */
  enabledTools: Set<string>;
  /** Tools that should be disabled */
  disabledTools: Set<string>;
  /** Rules that fired */
  matchedRules: string[];
}

// ── Built-in Rules ───────────────────────────────────────────────────────

const BUILTIN_RULES: ActivationRule[] = [
  // Novel writing mode — enable all novel tools
  {
    description: "Novel writing mode active",
    condition: (s) => s.sessionMode === "novel-writing" || s.sessionMode === "novel",
    enableTools: [
      "jingwei.read", "jingwei.write", "cockpit.snapshot",
      "chapter.read", "chapter.list", "chapter.audit",
      "pipeline.write", "pipeline.revise",
      "scene.spec", "pgi.ask", "resource.manage",
      "candidate.create_chapter", "beat.read", "beat.write",
      "style.import", "outline.suggest_next",
      "character.check_consistency", "hooks.manage",
      "presets.read", "presets.write", "presets.check_compliance",
      "rewrite.segment", "rewrite.apply",
    ],
  },

  // No novel plugin detected — disable novel tools
  {
    description: "No novel context — disable novel-specific tools",
    condition: (s) => s.sessionMode !== "novel-writing" && s.sessionMode !== "novel",
    disableTools: [
      "jingwei.read", "jingwei.write", "cockpit.snapshot",
      "chapter.read", "chapter.list", "chapter.audit",
      "pipeline.write", "pipeline.revise",
      "scene.spec", "pgi.ask", "resource.manage",
      "candidate.create_chapter", "beat.read", "beat.write",
    ],
    priority: -1, // low priority, can be overridden
  },

  // TypeScript/JavaScript project — enable code-related tools
  {
    description: "TypeScript/JavaScript project",
    condition: (s) => {
      const exts = s.fileExtensions ?? [];
      return exts.some((e) => [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(e));
    },
    enableTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Terminal"],
  },

  // Git repository — enable git tools
  {
    description: "Git repository detected",
    condition: (s) => (s.directories ?? []).includes(".git"),
    enableTools: ["Bash"], // git operations via Bash
  },

  // User explicit allowlist — highest priority
  {
    description: "User allowlist",
    condition: (s) => Boolean(s.userAllowlist?.length),
    enableTools: [], // dynamically set in evaluate
    priority: 100,
  },

  // User explicit denylist — highest priority
  {
    description: "User denylist",
    condition: (s) => Boolean(s.userDenylist?.length),
    disableTools: [], // dynamically set in evaluate
    priority: 100,
  },
];

// ── Evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate activation rules against project signals.
 * Returns which tools should be enabled/disabled.
 */
export function evaluateActivation(
  signals: ProjectSignals,
  customRules?: ActivationRule[],
): ActivationResult {
  const allRules = [...BUILTIN_RULES, ...(customRules ?? [])];
  // Sort by priority (lower first)
  allRules.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const enabled = new Set<string>();
  const disabled = new Set<string>();
  const matched: string[] = [];

  for (const rule of allRules) {
    if (rule.condition(signals)) {
      matched.push(rule.description);

      // Handle user allowlist/denylist dynamically
      if (rule.description === "User allowlist" && signals.userAllowlist) {
        for (const tool of signals.userAllowlist) enabled.add(tool);
      } else if (rule.description === "User denylist" && signals.userDenylist) {
        for (const tool of signals.userDenylist) disabled.add(tool);
      } else {
        if (rule.enableTools) {
          for (const tool of rule.enableTools) {
            enabled.add(tool);
            disabled.delete(tool); // enable overrides earlier disable
          }
        }
        if (rule.disableTools) {
          for (const tool of rule.disableTools) {
            if (!enabled.has(tool)) { // don't disable already-enabled
              disabled.add(tool);
            }
          }
        }
      }
    }
  }

  return { enabledTools: enabled, disabledTools: disabled, matchedRules: matched };
}

/**
 * Filter a tool list based on activation result.
 * Tools not mentioned in either set pass through unchanged.
 */
export function filterToolsByActivation<T extends { name: string }>(
  tools: readonly T[],
  activation: ActivationResult,
): T[] {
  return tools.filter((tool) => {
    // Explicitly disabled — remove
    if (activation.disabledTools.has(tool.name)) return false;
    // Everything else passes (enabled or neutral)
    return true;
  });
}

/**
 * Quick helper: detect project signals from a working directory.
 * Synchronous scan of top-level directory structure.
 */
export function detectProjectSignals(workDir: string): ProjectSignals {
  const signals: ProjectSignals = {
    fileExtensions: [],
    directories: [],
    frameworks: [],
  };

  try {
    if (!existsSync(workDir)) return signals;
    const entries = readdirSync(workDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        signals.directories!.push(entry.name);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext && !signals.fileExtensions!.includes(ext)) {
          signals.fileExtensions!.push(ext);
        }
      }
    }

    // Framework detection
    if (signals.directories!.includes("node_modules")) signals.frameworks!.push("node");
    if (existsSync(`${workDir}/package.json`)) signals.frameworks!.push("npm");
    if (existsSync(`${workDir}/tsconfig.json`)) signals.frameworks!.push("typescript");
    if (existsSync(`${workDir}/Cargo.toml`)) signals.frameworks!.push("rust");
    if (existsSync(`${workDir}/go.mod`)) signals.frameworks!.push("go");
    if (existsSync(`${workDir}/pyproject.toml`) || existsSync(`${workDir}/setup.py`)) {
      signals.frameworks!.push("python");
    }
  } catch {
    // Non-fatal — return partial signals
  }

  return signals;
}
