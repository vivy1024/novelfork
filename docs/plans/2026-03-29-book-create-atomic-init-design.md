# Book Create Atomic Init Design

**Goal:** Eliminate half-initialized books by making `inkos book create` fail-closed: foundation generation must either produce a complete book or leave no book directory behind.

## Problem

Current `book create` is not atomic:

- `PipelineRunner.initBook()` writes `book.json` before foundation generation.
- `ArchitectAgent.parseSections()` silently substitutes placeholder text when a required section is missing.
- CLI treats an existing but incomplete directory as resumable state.

This creates dirty `books/<bookId>/` directories with partial files. Re-running create on the same title can then behave unpredictably.

## Design

### 1. Stage to a temporary book directory

`initBook()` should build the full book in a temporary directory under `books/`:

- write `book.json`
- generate foundation
- write foundation files
- initialize control docs
- create chapter index
- snapshot chapter 0

Only after all of that succeeds should the temp directory be renamed to the final `books/<bookId>/`.

If any step fails, the temp directory is deleted.

### 2. Treat missing Architect sections as hard failure

`ArchitectAgent.parseSections()` should no longer emit placeholder text like:

- `[book_rules 生成失败，需要重新生成]`

Missing required sections should throw an error immediately. This prevents malformed foundations from being persisted as if they were valid content.

### 3. Remove resumable incomplete-init semantics

CLI should no longer “resume incomplete book creation”.

If `books/<bookId>/` exists:

- if it looks complete, `book create` should fail with “already exists”
- if it looks incomplete, it should be treated as stale partial state and removed before a fresh atomic create starts

This keeps the behavior simple:

- success => complete book exists
- failure => no book directory remains

## Scope

In scope:

- `book create`
- `PipelineRunner.initBook()`
- Architect foundation parsing
- stale incomplete directory cleanup
- regression tests

Out of scope:

- `initFanficBook()` atomic staging
- state-validator robustness
- interactive-fiction work

## Validation

Add regressions for:

1. `ArchitectAgent` throws when a required section is missing.
2. `PipelineRunner.initBook()` leaves no final book directory when foundation generation fails.
3. CLI `book create` removes stale incomplete directories and does not keep a dirty directory when create fails downstream.
