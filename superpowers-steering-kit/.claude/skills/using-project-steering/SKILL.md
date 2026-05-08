---
name: using-project-steering
description: Use when working in any repository that has steering, rules, AGENTS, CLAUDE, GEMINI, or project guidance files, before planning, editing, validating, committing, or reporting completion.
---

# Using Project Steering

## Overview

Generic Superpowers tells you how to work. Project steering tells you what is true in this repository. Use this skill to load only the project guidance needed for the current task, then continue with the appropriate Superpowers or project adapter skill.

## When to Use

Use before:
- planning or writing implementation tasks
- editing code, docs, config, prompts, or skills
- validating, committing, pushing, releasing, or reporting completion
- adapting a generic workflow to a specific repo

Do not use for a one-off answer that does not depend on repository facts.

## Steering Sources

Check for these sources, in priority order:

| Source | Purpose |
|---|---|
| Direct user request | Immediate task and constraints |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Agent-level operating rules |
| `.kiro/steering/*.md` | Project rules, architecture, workflow guidance |
| `.narrafork/skills/*` or `.claude/skills/*` | Installed local process skills |
| `docs/` or package README files | Product, status, and usage facts |
| `PROJECT_PROFILE.md` or equivalent | Completion standard and domain gates |

If multiple sources conflict, user instructions win, then project agent rules, then steering, then generic skills.

## Routing Checklist

1. Identify the task category: feature, bugfix, refactor, docs, release, ops, prompt/skill, or research.
2. Read the minimum relevant steering files for that category.
3. Extract three things before acting:
   - required completion evidence
   - forbidden actions or unsafe zones
   - docs/tests/commit/release obligations
4. If the task is user-visible, invoke or apply `feature-closure-gate` before claiming completion.
5. If the project uses `.kiro/specs`, invoke or apply `kiro-spec-adapter` for spec work.
6. Continue with the relevant Superpowers skill.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Loading every steering file into context | Route by task category and read only relevant files |
| Treating generic Superpowers as higher priority than project rules | Project rules specialize generic process |
| Claiming completion from unit tests alone | Use the project completion evidence and feature closure gate |
| Editing skills/prompts without checking local conventions | Read agent rules and existing skill style first |

## Handoff Note

When reporting, mention which steering sources shaped the decision only when it affects the outcome. Do not dump steering content.
