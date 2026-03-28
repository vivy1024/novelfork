# Book Create Atomic Init Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `book create` atomic so malformed Architect output or failed initialization never leaves a half-built book directory behind.

**Architecture:** Stage new books in a temporary directory, require Architect to return all mandatory sections, and delete stale incomplete directories instead of resuming them. Promote the staged directory into place only after all initialization steps succeed.

**Tech Stack:** TypeScript, Vitest, Commander CLI, Node `fs/promises`

---

### Task 1: Lock down Architect missing-section failure

**Files:**
- Modify: `packages/core/src/__tests__/architect.test.ts`
- Modify: `packages/core/src/agents/architect.ts`

**Step 1: Write the failing test**

Add a test showing `generateFoundation()` rejects when `book_rules` is missing from the LLM response.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/architect.test.ts -t "throws when a required foundation section is missing"`

**Step 3: Write minimal implementation**

Change `parseSections()` to throw on missing required sections instead of returning placeholder content.

**Step 4: Run test to verify it passes**

Run the same Vitest command and confirm it passes.

### Task 2: Lock down atomic init rollback

**Files:**
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/state/manager.ts`
- Modify: `packages/core/src/pipeline/runner.ts`

**Step 1: Write the failing test**

Add a regression showing `initBook()` leaves no final `books/<bookId>/` when foundation generation fails.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/pipeline-runner.test.ts -t "cleans staged files when initBook fails before foundation is complete"`

**Step 3: Write minimal implementation**

Implement staged initialization in a temporary directory, then rename into place only after success. Add helper methods in `StateManager` as needed for path-based control-doc/index/snapshot writes.

**Step 4: Run test to verify it passes**

Run the same Vitest command and confirm it passes.

### Task 3: Lock down stale incomplete-directory cleanup at CLI level

**Files:**
- Modify: `packages/cli/src/__tests__/cli-integration.test.ts`
- Modify: `packages/cli/src/commands/book.ts`

**Step 1: Write the failing test**

Add a CLI regression where a stale incomplete `books/<bookId>/` exists before `book create`, and verify the command does not preserve that stale directory when create later fails.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/cli-integration.test.ts -t "removes stale incomplete book directories before retrying create"`

**Step 3: Write minimal implementation**

Replace “resume incomplete book creation” behavior with stale-directory cleanup plus fresh atomic create.

**Step 4: Run test to verify it passes**

Run the same Vitest command and confirm it passes.

### Task 4: Run focused verification

**Files:**
- No production changes expected

**Step 1: Run targeted suite**

Run:

```bash
pnpm vitest run src/__tests__/architect.test.ts src/__tests__/pipeline-runner.test.ts
```

in `packages/core`, and:

```bash
pnpm vitest run src/__tests__/cli-integration.test.ts
```

in `packages/cli`.

**Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

in `packages/core` and `packages/cli`.

**Step 3: Commit**

```bash
git add docs/plans/2026-03-29-book-create-atomic-init-design.md docs/plans/2026-03-29-book-create-atomic-init-implementation-plan.md packages/core/src/agents/architect.ts packages/core/src/pipeline/runner.ts packages/core/src/state/manager.ts packages/core/src/__tests__/architect.test.ts packages/core/src/__tests__/pipeline-runner.test.ts packages/cli/src/commands/book.ts packages/cli/src/__tests__/cli-integration.test.ts
git commit -m "fix: make book creation fail closed"
```
