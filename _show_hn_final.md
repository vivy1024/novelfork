# Show HN — FINAL VERSION (March 2026)

## Title
Show HN: InkOS – Open-source 10-agent pipeline that writes novels with continuity tracking

## URL
https://github.com/Narcooo/inkos

## Text

Hi HN, I built InkOS — an open-source CLI that writes, audits, and revises novels using a pipeline of 10 specialized AI agents. 2.4k stars, MIT licensed.

The problem: AI writing tools generate text chapter by chapter with no memory. After 20 chapters you get continuity breaks, unresolved plot hooks, context window bloat (400 errors, $200/chapter API costs), and prose that all sounds the same ("delve", "tapestry", "testament").

InkOS is a ground-up redesign around these problems.

**Architecture — 10 agents in sequence:**

Planner → Composer → Architect → Writer → Observer → Reflector → Normalizer → Auditor → Reviser

Each agent has one job. The Planner reads author intent and schedules hook advancement. The Composer selects relevant context (not full-file injection). The Observer over-extracts 9 categories of facts. The Reflector outputs Zod-validated JSON deltas — not full markdown rewrite. The Auditor checks 33 dimensions. Failed audits trigger auto-revision loops.

**What changed in v0.6 (the version that actually works for long-form):**

- Truth files moved from markdown to `story/state/*.json` (Zod schema validated). Settler outputs JSON deltas applied immutably. Corrupted data rejected, not propagated.
- SQLite temporal memory on Node 22+ — selective retrieval instead of full-file injection. Solves context bloat after 20+ chapters.
- Hook governance: Planner generates `hookAgenda`, Settler working set expanded to cover dormant debt, `analyzeHookHealth` audits hook debt, `evaluateHookAdmission` blocks duplicates. Hooks now actually resolve instead of accumulating to 40+ open threads.
- Length governance: `LengthSpec` + Normalizer single-pass with safety net against destructive normalization. Word count deviation went from 50%+ to within target band.
- Cross-chapter repetition detection, dialogue-driven guidance, multi-character scene resistance.

**How it compares to similar tools:**

AutoNovel (NousResearch) produces one novel start-to-finish with adversarial editing — impressive but single-run, no continuation workflow. kimi-writer and gemini-writer are single-agent wrappers. InkOS is designed for ongoing serial writing: import existing chapters, reverse-engineer truth files, write 100+ chapters with state tracking that doesn't degrade.

**Genre support:**

10 English profiles (LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy) + 5 Chinese web novel genres. Each has pacing rules, fatigue word lists, and audit dimensions.

**Other features:** style cloning (extract statistical fingerprint from reference text), fan fiction mode (canon/AU/OOC/ship), daemon mode (`inkos up`), multi-model routing (Writer on Claude, Auditor on GPT-4o), EPUB export. Also published as an OpenClaw skill on ClawHub.

```
npm i -g @actalk/inkos
inkos book create --title "The Last Delver" --genre litrpg
inkos write next
```

Would love feedback from anyone working on multi-agent systems, long-context state management, or creative AI.

GitHub: https://github.com/Narcooo/inkos
