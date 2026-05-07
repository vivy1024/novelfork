---
name: applying-project-profile
description: Use when adapting generic Superpowers workflows to a specific project, product domain, repository convention, completion standard, or prompt/agent system.
---

# Applying Project Profile

## Overview

A project profile is the adapter between generic agent methodology and a real product. Keep Superpowers generic; put repository-specific goals, gates, and evidence in the project profile.

## When to Use

Use when:
- copying this skill pack into a new project
- deciding whether a task is a feature, enabler, guard, docs, release, or ops work
- translating generic Superpowers guidance into project-specific behavior
- writing or refreshing `AGENTS.md`, `CLAUDE.md`, `.kiro/steering`, or prompt rules
- deciding what evidence is required before saying something is complete

## Required Profile Fields

Every project should define these fields in `PROJECT_PROFILE.md`, `AGENTS.md`, `CLAUDE.md`, or steering:

| Field | What to capture |
|---|---|
| Product identity | What this repo exists to deliver |
| Primary users | Who uses the product and through which entry points |
| Completion standard | What evidence proves user-visible work is done |
| Task classes | Feature, enabler, guard, docs, release, ops definitions |
| Verification ladder | Unit, integration, browser, CLI, smoke, release checks |
| Persistence evidence | Files, DB rows, APIs, artifacts, or logs that must round-trip |
| Safety rules | Forbidden commands, secrets, data loss, branch rules |
| Documentation sync | Which docs must change with code/config/process changes |
| Domain gates | Product-specific quality gates that generic tests cannot prove |

## Adaptation Rule

Do not modify upstream Superpowers for one project. Add a project profile or adapter skill unless the change is truly cross-project and belongs upstream.

## Decision Table

| Situation | Put the rule in |
|---|---|
| Applies to every coding project | Superpowers/core skill |
| Applies to projects with `.kiro/specs` | `kiro-spec-adapter` |
| Applies to a repo's product/domain | Project profile or project skill |
| Applies to one feature | Feature spec/tasks |
| Can be mechanically enforced | Script/test/check, not prose |

## Output Pattern

Before implementation, reduce the profile to a task-local note:

```text
Project profile for this task:
- task class: FEATURE | ENABLER | GUARD | DOCS | RELEASE | OPS
- user entry point:
- completion evidence:
- required verification:
- forbidden shortcuts:
- docs/changelog obligations:
```

Use that note to constrain the next skill you invoke.
