# Implementation Plan

## Overview

This plan completes the current NovelFork simplification work: remove candidate/draft as primary concepts, make file-system-backed formal chapters the main writing result, reposition writing tools, clarify narrative memory and jingwei boundaries, then finish by turning CodeWiki into a real code-backed wiki and renaming the docs first entry from `01-当前状态` to `01-codewiki`.

## Tasks

- [x] 1. Inventory current candidate/draft/writing-resource usage
  - Search for candidate/draft/writing-resource references across routes, handlers, engine, UI, tests, docs.
  - Produce a code-backed inventory page under CodeWiki cleanup docs.
  - Classify each reference as remove, rename, compatibility, or keep temporarily.
  - Verify inventory references real files with `bun run docs:drift`.

- [x] 2. Define the canonical writing model in code and docs
  - Update or add documentation that formal chapters are result-layer objects.
  - Mark candidate/draft as deprecated compatibility concepts.
  - Confirm dynamic facts belong to narrative memory and static references belong to jingwei.
  - Ensure CodeWiki concept pages reflect the canonical model.

- [x] 3. Refactor writing-resource service toward file-system chapter semantics
  - Audit `packages/novel-plugin/src/engine/writing-resource/*`.
  - Stop expanding SQLite writing-resource repository as chapter primary storage.
  - Mark repository-backed candidate/draft paths as compatibility only or remove where safe.
  - Preserve formal chapter behavior.
  - Add or update focused tests for remaining service behavior.

- [x] 4. Remove candidate/draft from primary writing routes
  - Audit `packages/novel-plugin/src/routes/writing-resource.ts`.
  - Audit `packages/studio/src/api/routes/chapter-candidates.ts`.
  - Audit `packages/novel-plugin/src/handlers/candidate-tool-service.ts`.
  - Remove, deprecate, or redirect candidate/draft primary flows.
  - Ensure routes no longer advertise candidate/draft as preferred product concepts.

- [x] 5. Reposition writing-modes tools as edit/version actions
  - Audit `packages/novel-plugin/src/routes/writing-modes.ts`.
  - Replace candidate/draft apply target semantics with chapter edit, version, or explicit deprecated compatibility behavior.
  - Keep user-facing capabilities: segment expansion, rewrite, style extraction, variants.
  - Ensure tool outputs have one of four destinations: formal chapter, version, preset suggestion, NarrativeEvent.

- [x] 6. Clarify style extraction to preset workflow
  - Locate current style extraction and preset handling code.
  - Ensure extracted style is treated as suggestion, not automatic truth.
  - Add Agent/user confirmation path in docs and, if already supported by UI/API, align naming.
  - Document user-editable presets/templates/beats as configuration layer.

- [x] 7. Separate multi-version from candidate/draft cleanup
  - Document multi-version as its own UX domain.
  - Inventory existing variant UI and agent code.
  - Define version result storage/representation separately from candidate/draft.
  - Do not implement a full multi-version redesign in this cleanup unless required to remove candidate coupling.

- [x] 8. Move dynamic fact writeback to narrative memory boundaries
  - Audit NarrativeEvent creation and application paths.
  - Ensure writing result finalization can trigger narrative memory writeback without relying on candidate accept flow.
  - Keep high-risk events pending through reducer/approval mechanisms.
  - Update CodeWiki workflow docs with exact files and functions.

- [x] 9. Keep jingwei static-only boundary intact
  - Audit jingwei write paths that may receive dynamic facts.
  - Document which tools may read jingwei and which may write it.
  - Ensure dynamic facts are directed to narrative memory instead of jingwei.

- [x] 10. Convert current CodeWiki from principle notes to code-backed wiki
  - Keep current principle/decision pages but reposition them as decisions/cleanup context.
  - Add module pages under `docs/01-codewiki/modules/` for writing-resource, narrative-memory, jingwei, writing-modes, pipeline-write, presets, chapter-storage, writing-workbench-ui, agent-runtime.
  - Each page must include real files, main functions/routes/tools, inputs, outputs, current problems, and cleanup direction.
  - Use Codebase Memory MCP / CODEMAP evidence for routes, functions, and call relationships.

- [x] 11. Add API/data/UI CodeWiki sections
  - Add `docs/01-codewiki/api/` pages for novel routes, studio routes, agent tools.
  - Add `docs/01-codewiki/data/` pages for file-system layout, SQLite remaining duties, narrative memory schema, deprecated writing-resource model.
  - Add `docs/01-codewiki/ui/` pages for writing workbench, resource viewers, panels, and multi-version UI.
  - Ensure every referenced file exists.

- [x] 12. Rename docs first entry from `01-当前状态` to `01-codewiki`
  - Move the CodeWiki root to `docs/01-codewiki` according to the chosen design.
  - Update `docs/README.md` table to point to `01-codewiki` as the first entry.
  - Keep `docs/01-当前状态` only as a migration note for old links.
  - Avoid two competing authoritative CodeWiki roots.

- [x] 13. Update documentation indexes and drift checks
  - Update docs root README and relevant section READMEs.
  - Run `bun run docs:drift` and fix every stale reference.
  - If codegraph/CODEMAP should reference the new CodeWiki entry, regenerate or update as appropriate.

- [x] 14. Verification pass
  - Run focused tests for changed modules/routes/tools.
  - Run package typecheck for affected packages.
  - Run `bun run docs:drift`.
  - If UI behavior changed, run browser verification and capture screenshot.

- [x] 15. Final CodeWiki completion gate
  - Confirm CodeWiki can answer: what exists, where it lives, who calls it, what it reads/writes, whether it is kept/deprecated/deleted.
  - Confirm candidate/draft cleanup status is explicitly recorded.
  - Confirm docs first entry is `01-codewiki`.
  - Save final architecture decision to Engram.
