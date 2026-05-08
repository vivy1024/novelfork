---
name: kiro-spec-adapter
description: Use when a project uses Kiro-style `.kiro/specs/<feature>/requirements.md`, `design.md`, and `tasks.md` instead of generic Superpowers spec or plan files.
---

# Kiro Spec Adapter

## Overview

This skill adapts generic Superpowers planning and execution to Kiro-style specs without forking the core Superpowers methodology.

## When to Use

Use when:
- the project has `.kiro/specs/<feature>/requirements.md`, `design.md`, or `tasks.md`
- translating a design into Kiro `requirements.md` and `design.md`
- translating approved Kiro requirements/design into `tasks.md`
- executing Kiro tasks while keeping requirements and design authoritative

## File Contract

```text
.kiro/specs/<feature>/
  requirements.md  # what must be true
  design.md        # how the solution is structured
  tasks.md         # ordered implementation and verification work
```

## Mapping from Superpowers

| Generic Superpowers concept | Kiro equivalent |
|---|---|
| Brainstormed spec/design | `requirements.md` + `design.md` |
| Implementation plan | `tasks.md` |
| Plan execution | Execute `tasks.md` while reading all three files |
| Review against plan | Review against requirements + design + tasks |

## Rules

1. Do not invent requirements in `tasks.md`.
2. Do not execute tasks that conflict with `requirements.md` or `design.md`.
3. If a requirement has no task, the plan is incomplete.
4. If a task has no requirement/design basis, it is drift.
5. If a task is only an enabler, mark it as an enabler; do not claim feature completion.
6. User-visible requirements must include feature closure evidence, not only internal tests.

## Recommended Task Labels

Use labels to prevent checkbox illusions:

```markdown
- [ ] FEATURE: user-visible end-to-end behavior
- [ ] ENABLER: internal foundation needed by a feature
- [ ] GUARD: regression, mock, security, or contract protection
- [ ] DOCS: documentation and status truth
- [ ] RELEASE: packaging, versioning, distribution
```

## Execution Gate

Before marking a Kiro task complete, confirm:

```text
- task checkbox work is done
- relevant requirement outcome is satisfied
- design constraints are still respected
- verification evidence matches the task class
```

If tasks are complete but requirements are not satisfied, the work is not complete.
