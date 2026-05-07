---
name: novelfork-project-profile
description: Use when working on NovelFork-specific features, release readiness, Studio /next, CLI/headless, Agent runtime, or Chinese web-novel writing workflows.
---

# NovelFork Project Profile

## Overview

This is the NovelFork-specific adapter on top of generic Superpowers. It keeps project facts in `.kiro/steering/project-profile.md` and uses skills for executable gates.

## Required Reads

Before NovelFork-specific planning, editing, validation, or completion claims:

1. Read `.kiro/steering/README.md` for task routing.
2. Read `.kiro/steering/project-profile.md` for stable project facts and completion standards.
3. Use `kiro-spec-adapter` for `.kiro/specs` work.
4. Use `feature-closure-gate` before claiming user-visible behavior is complete.

## Core Gates

| Work | Gate |
|---|---|
| Studio `/next` UI | Real route/browser/component evidence plus contract source |
| CLI/headless | Real command/API output and artifact/session evidence |
| Novel writing | Candidate/draft first, user confirmation before formal chapter mutation |
| Agent/tool runtime | Transcript/tool/session/resource evidence; no fake current status |
| Release | compile + clean-root smoke + GitHub Release artifact + SHA256 |
| Docs/rules | CHANGELOG Unreleased and affected docs updated |

## Forbidden Shortcuts

- Do not declare FEATURE complete from ENABLER/GUARD/DOCS evidence alone.
- Do not restore deprecated frontends, legacy routes, old providers, or fake adapters.
- Do not use mock/noop/hardcoded success outside explicit tests.
- Do not write unsupported/planned capabilities as current.
- Do not bypass Backend Contract clients from app-next UI.

## Reporting

When reporting NovelFork work, include:

```text
Task class:
Project facts used:
Verification run:
Not verified:
Docs/changelog updated:
```
