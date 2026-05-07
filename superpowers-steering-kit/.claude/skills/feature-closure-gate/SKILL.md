---
name: feature-closure-gate
description: Use when you are about to claim a user-visible feature, product workflow, CLI command, UI path, agent capability, or release-facing behavior is complete.
---

# Feature Closure Gate

## Overview

Feature completion is not the same as task completion. Internal APIs, tests, contracts, docs, and refactors can enable a feature, but only user-visible evidence closes it.

## When to Use

Use before saying:
- done, complete, fixed, ready, shipped, implemented, parity achieved, release-ready
- a UI workflow works
- a CLI/headless command works
- an agent/tool/runtime behavior works
- a product capability is now available

## Task Classifier

Classify each completed item before reporting:

| Class | Meaning | Can it prove feature completion alone? |
|---|---|---|
| FEATURE | User can complete a meaningful action through a product entry point | Yes, with closure evidence |
| ENABLER | Internal implementation, route, type, adapter, contract, refactor | No |
| GUARD | Test, lint, mock guard, security check, regression protection | No |
| DOCS | Documentation, status, changelog, rules | No |
| RELEASE | Build, package, tag, publish, artifact upload | Only for release claims |
| OPS | Environment, config, deployment, migration | Only for ops claims |

## Closure Evidence

A FEATURE claim needs evidence for all applicable rows:

| Evidence | Question |
|---|---|
| Entry point | How does the user trigger it? UI, CLI, API, agent command, or headless flow |
| Real operation | Did the real workflow run, not just a mocked unit? |
| Visible result | What can the user see or receive? |
| Persistence | Did the result save and round-trip if persistence is part of the feature? |
| Non-destructive boundary | Did it avoid overwriting or deleting protected user data? |
| Failure path | What happens when required config/data/model/tool is missing? |
| Regression guard | What test/check prevents backsliding? |

## Claim Calibration

Use precise language:

| Evidence found | Allowed wording |
|---|---|
| Unit tests only | “The internal unit is covered” |
| API/contract tests only | “The backend contract path is covered” |
| Component tests only | “The component behavior is covered” |
| End-to-end/user path evidence | “The feature workflow is complete” |
| No verification run | “Implemented but not verified” |

## Stop Conditions

Do not claim feature completion when:
- only enabler/guard/docs tasks are done
- the user entry point was not exercised
- persistence was not round-tripped for persistent features
- the implementation uses fake, noop, or hardcoded behavior outside explicit tests
- verification output is unavailable or guessed

## Reporting Template

```text
Task class: FEATURE | ENABLER | GUARD | DOCS | RELEASE | OPS
Claim:
Evidence:
Not verified:
Next closure gap, if any:
```
