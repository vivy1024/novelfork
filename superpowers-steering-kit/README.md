# Superpowers Steering Kit

A portable adapter layer for projects that use upstream Superpowers plus repository-specific steering, project profiles, Kiro specs, or product completion gates.

## Purpose

Keep upstream Superpowers generic and updateable. Put project-specific behavior in adapter skills and project profile files.

## Recommended Layers

```text
1. Upstream Superpowers core
   Generic engineering method: brainstorming, TDD, debugging, planning, execution, review, verification.

2. Project adapter skills
   Route generic workflow through project steering, Kiro specs, and completion gates.

3. Project profile / steering
   Product identity, task classes, completion evidence, docs obligations, unsafe zones.

4. Feature specs/tasks
   Concrete work for one feature, release, or operational change.
```

## Install

Copy the adapter skills into the target project after installing upstream Superpowers:

```text
.claude/skills/
.narrafork/skills/   # optional, for NarraFork projects
```

Then add a project profile using `templates/PROJECT_PROFILE.md` or fold those sections into `AGENTS.md` / `CLAUDE.md`.

## Included Skills

| Skill | Use |
|---|---|
| `using-project-steering` | Load relevant project steering before acting |
| `applying-project-profile` | Adapt generic methodology to one repo/product |
| `kiro-spec-adapter` | Map Superpowers workflow to `.kiro/specs` |
| `feature-closure-gate` | Prevent task-checkbox completion from being misreported as feature completion |

## Porting Rule

Do not fork upstream Superpowers for product-specific behavior. Add or update adapter skills/profile instead.
