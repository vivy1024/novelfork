/**
 * Command Semantics — interpret exit codes based on command type.
 *
 * Many commands use non-zero exit codes for non-error conditions:
 * - grep: 1 = no matches found (not an error)
 * - diff: 1 = files differ (expected behavior)
 * - test/[: 1 = condition is false
 *
 * Without this, the model thinks every non-zero exit = failure and wastes
 * turns trying to "fix" commands that worked correctly.
 */

export interface CommandInterpretation {
  isError: boolean;
  message?: string;
}

type CommandSemantic = (exitCode: number, stdout: string, stderr: string) => CommandInterpretation;

const DEFAULT_SEMANTIC: CommandSemantic = (exitCode) => ({
  isError: exitCode !== 0,
  message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
});

const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // grep/rg: 0=matches found, 1=no matches, 2+=error
  ["grep", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "No matches found (not an error)" : undefined,
  })],
  ["rg", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "No matches found (not an error)" : undefined,
  })],
  // find: 0=success, 1=partial (some dirs inaccessible), 2+=error
  ["find", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "Some directories were inaccessible" : undefined,
  })],
  // diff: 0=no differences, 1=differences found, 2+=error
  ["diff", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "Files differ (expected)" : undefined,
  })],
  // test/[: 0=true, 1=false, 2+=error
  ["test", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "Condition is false" : undefined,
  })],
  ["[", (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? "Condition is false" : undefined,
  })],
  // git diff: 0=no changes, 1=changes found (not an error)
  ["git", (exitCode, _stdout, stderr) => ({
    isError: exitCode !== 0 && exitCode !== 1 && !stderr.includes("nothing to commit"),
    message: exitCode === 1 ? "Changes detected" : undefined,
  })],
]);

/**
 * Extract base command name from a command line (last segment for pipes).
 */
function extractBaseCommand(command: string): string {
  // Take last pipe segment, then first word
  const segments = command.split("|");
  const lastSegment = (segments[segments.length - 1] ?? command).trim();
  return lastSegment.split(/\s+/)[0] ?? "";
}

/**
 * Interpret a command's exit code using semantic rules.
 * Returns whether the exit code represents a real error or expected behavior.
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): CommandInterpretation {
  const baseCommand = extractBaseCommand(command);
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC;
  return semantic(exitCode, stdout, stderr);
}
