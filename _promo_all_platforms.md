# InkOS Promotion Document: All Platforms

**Project:** InkOS
**GitHub:** https://github.com/Narcooo/inkos
**npm:** `npm i -g @actalk/inkos`
**Package:** @actalk/inkos
**License:** MIT
**Stars:** 2.4k

---

## SEO KEYWORDS

### Primary Keywords
- ai novel writing tool
- ai novel generator
- autonomous novel writing
- ai writing agent

### Secondary Keywords
- litrpg ai writer
- progression fantasy ai
- open source novel writing ai
- ai novel github
- novel writing cli
- ai writing framework

### Long-Tail Keywords
- how to write a novel with ai
- ai tool that writes entire novels
- best ai for writing fiction
- open source ai novel generation
- litrpg generator cli
- ai agent novel writing
- progression fantasy generator

---

## 1. PRODUCT HUNT

### Product Name
InkOS

### Tagline (60 chars max)
Open-source CLI that autonomously writes novels with 10 AI agents.

### Full Description
InkOS is an open-source CLI agent that autonomously writes, audits, and revises novels — with built-in human review gates for full control.

**How it works:** A 10-agent pipeline handles planning, composition, writing, observation, reflection, and auditing across 33 dimensions. Every chapter is validated against 7 canonical truth files (world state, character matrix, resources, plot hooks, emotional arcs, subplots, summaries), catching continuity errors that would normally slip past.

**Key features:**
- **33-dimension audit + de-AI-ification:** Built-in LLM-voice detection and automatic rewriting to remove AI traces (fatigue words, monotonous patterns)
- **Style cloning:** Analyze reference text, extract a fingerprint, auto-inject into your book
- **10 English genre profiles:** LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy — each with dedicated pacing rules and audit rules
- **Multi-model routing:** Different agents can use different LLMs (Writer on Claude, Auditor on GPT-4o, Radar on a local model)
- **Continuation writing:** Import existing chapters, auto-reverse-engineer truth files, seamlessly continue
- **Daemon mode:** Run fully unattended with Telegram/webhook notifications
- **SQLite memory:** v0.6+ uses temporal memory to prevent context bloat after 20+ chapters
- **Fan fiction mode:** Canon, AU, OOC, and ship-focused workflows with lore consistency guards

**Getting started:**
```bash
npm i -g @actalk/inkos
inkos book create --title "My Novel" --genre litrpg --lang en
inkos write next
```

No subscriptions. No SaaS. Full source, full control.

### First Comment / Narrative Post
I built InkOS because every AI novel writing tool I tried had the same problems:

1. **Continuity breaks.** Characters remember things they didn't witness. Weapons vanish. Plots contradict themselves. The auditor caught ~60% of these but required manual review.

2. **AI-tell.** Every chapter reads like it came from the same LLM — fatigue words ("intricate", "testament", "pivotal"), sentence patterns you can spot instantly, excessive recaps. Most tools just let it happen.

3. **Long-form collapse.** After 20+ chapters, full-file injection kills response time, causes 400 errors, eats $200 of API calls per chapter. I needed selective memory.

4. **Plot hooks never land.** The tool would plant hooks, they'd accumulate to 40+ open threads, then resolve at random. No scheduling, no payoff tracking.

InkOS is a ground-up redesign around these problems:

- **10-agent pipeline** with specialized roles (Planner reads intent, Composer selects context, Writer produces prose, Observer over-extracts facts, Reflector outputs validated JSON deltas, Auditor checks 33 dimensions, Reviser auto-fixes)
- **Zod-validated JSON deltas** for truth files instead of full markdown — prevents corruption, enables selective retrieval
- **SQLite temporal memory** (v0.6+) — remembers facts across chapters without injecting full files
- **de-AI-ification at the source** — fatigue word lists, style fingerprint injection, LLM-voice detection baked into Writer
- **Hook scheduling** via Planner — reads current focus, plots advancement + payoff order, prevents accumulation
- **Fanfic + continuation workflows** — import existing novels, auto-migrate to truth files, keep writing

Supports LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, and more. Multi-model routing so you can run Writer on Claude + Auditor on GPT-4o. Open-source, MIT-licensed.

I've shipped 0.6 with structural improvements (state schema validation, hook health auditing, length governance). Working on the Studio web UI next for chapter review/editing.

### Topics/Tags
- artificial-intelligence
- cli-tools
- creative-writing
- deep-tech
- open-source
- novel-writing
- ai-agents
- writer-tools

---

## 2. ALTERNATIVETO

### What Is It Alternative To
Alternative to: NovelAI, Sudowrite, ChatGPT for writing novels

### Description
InkOS is an open-source CLI agent for autonomous novel writing, designed to replace proprietary SaaS tools like NovelAI and Sudowrite with a free, self-hosted alternative.

Unlike single-model generators, InkOS runs a 10-agent pipeline that handles planning, drafting, auditing, and revision automatically. Every chapter is validated against 7 truth files (character state, resources, plot hooks, emotional arcs) — catching continuity errors that slip past simple LLM prompts.

**For writing fiction where you need:**
- Full control over prompts, models, and data (no SaaS lockdown)
- Continuity checking across 20+ chapters without ballooning costs
- Specific genre support (LitRPG, Progression Fantasy, Isekai, etc.)
- Multi-model routing (Writer on one LLM, Auditor on another)
- Automated de-AI-ification (removes "intricate", "testament" fatigue words)
- Fanfic and continuation workflows built-in

**Comparison:**
- **NovelAI:** Proprietary, $10-25/month, single-model, limited audit
- **Sudowrite:** Similar subscription model, human-driven, not autonomous
- **ChatGPT:** No genre-specific rules, no truth file tracking, requires manual continuity checking
- **InkOS:** Free, open-source, 10-agent pipeline, 33-dimension audit, full data control

Install globally via npm. Configure once. Write autonomously.

---

## 3. SOURCEFORGE

### Project Description
InkOS is an open-source CLI agent for autonomous novel writing. It handles the entire pipeline: planning chapters, drafting prose, extracting facts, auditing continuity, and revising — with no human intervention required.

Core features:
- **10-agent architecture:** Specialized roles for planning, composition, writing, observation, reflection, auditing, revision, and normalization
- **7 canonical truth files:** World state, character matrix, resources, plot hooks, emotional arcs, subplots, summaries — validated via Zod schema
- **33-dimension audit:** Checks character memory, resource continuity, hook payoff, outline adherence, pacing, emotional arcs, AI-tell detection
- **Genre-specific profiles:** 10 English genres (LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy) with dedicated rules, pacing, fatigue words, and audit dimensions
- **De-AI-ification:** Built-in fatigue word detection and automatic rewriting to remove LLM-voice markers
- **Style cloning:** Analyze reference text, extract fingerprint, auto-inject into your book
- **Multi-model routing:** Different agents can use different LLMs to balance quality and cost
- **SQLite temporal memory:** Prevent context bloat from full-file injection on large novels
- **Continuation + fanfic:** Import existing chapters, auto-reverse-engineer truth files, support canon/AU/OOC/ship workflows
- **Daemon mode:** Run fully unattended with Telegram/webhook notifications
- **Full pipeline or atomic commands:** Use `write next` for one-command automation, or call `plan`/`compose`/`draft`/`audit`/`revise` independently for external agent integration

Requires Node 20+, OpenAI/Anthropic API key (or any OpenAI-compatible endpoint). MIT license.

### Categories
- Software Development
- Text Editors & Editors
- Artificial Intelligence
- Writers & Publishers

### Tags
- ai
- novel-writing
- cli
- node
- javascript
- typescript
- open-source
- litrpg
- progression-fantasy
- agents
- autonomous-writing

---

## 4. DEV.TO ARTICLE

### Title
How I Built a 10-Agent Pipeline That Writes Novels Autonomously

### Full Article

I spent two years writing LitRPG novels with ChatGPT. Every time I hit 20+ chapters, the same problems surfaced: continuity breaks, AI-tell in every paragraph, characters remembering things they never witnessed, and $200 API bills for a single chapter. So I built InkOS to fix them.

Here's how it works and why the 10-agent approach matters.

---

## The Problem: Why Single-Model Generation Fails for Long-Form Fiction

ChatGPT can generate a chapter, but it can't:
1. **Remember.** After 20+ chapters, injecting full truth files into every prompt causes timeouts and 400 errors. No selective memory.
2. **Validate continuity.** A character references a weapon they sold three chapters ago. No one catches it until readers complain.
3. **Avoid AI-voice.** Every chapter uses the same fatigue words ("intricate", "testament", "pivotal", "tapestry"). The prose tastes like LLM no matter how you prompt.
4. **Schedule plot resolution.** You plant 40 hooks by chapter 25. They resolve randomly instead of on schedule.
5. **Govern inputs.** Your creative brief, world rules, and current focus get mashed into one 6k-token prompt blob. Good luck controlling the output.

I tried every writing SaaS tool (NovelAI, Sudowrite, Jasper's fiction mode). All hit the same walls.

---

## The Solution: 10 Specialized Agents

InkOS doesn't use a single LLM to do everything. Instead, it routes writing decisions through a pipeline of agents, each with a specific responsibility:

```
Author Intent + Current Focus
    ↓
Planner (reads intent, retrieves memory, generates chapter goal + keep/avoid list)
    ↓
Composer (selects relevant context from truth files, compiles rule stack)
    ↓
Architect (outlines chapter structure: scenes, beats, pacing targets)
    ↓
Writer (produces prose from the composed context, length-governed, dialogue-driven)
    ↓
Observer (over-extracts 9 fact categories: characters, locations, resources, relationships, emotions, information, hooks, time, physical state)
    ↓
Reflector (outputs JSON delta, not full markdown; validates via Zod schema)
    ↓
Normalizer (single-pass compress/expand to target word count)
    ↓
Continuity Auditor (validates against 33 dimensions: character memory, resource continuity, hook payoff, outline adherence, pacing, emotional arcs, AI-tell)
    ↓
Reviser (auto-fixes critical issues, flags others for human review)
```

Each agent is independently callable via CLI (with `--json` output for chaining), or you can run the full pipeline with a single command.

---

## Why This Matters: Three Key Wins

### 1. Selective Memory Instead of Context Bloat

Old approach: `"Here's all 7 truth files (2000+ tokens). Write chapter 31."`

Result: Timeouts after chapter 20. API costs spiral.

New approach (v0.6+):

```typescript
// InkOS uses SQLite temporal memory
const relevantFacts = await memory.retrieve(
  `character:protagonist AND chapter <= current_chapter AND
   (location:dungeon OR mentioned_in_last_5_chapters)`,
  { limit: 50, recency_weight: 0.3 }
);
```

Only inject facts that matter for this chapter. No bloat. Costs stay linear.

### 2. De-AI-ification at the Source

Old approach: Generate → manually edit fatigue words.

New approach: Prevent them in the first place.

Every genre in InkOS ships with a **fatigue word list**. LitRPG's list includes: "delve", "tapestry", "testament", "intricate", "pivotal". The Writer agent gets explicit instructions:

```yaml
# From genre/litrpg.yaml
fatigue_words:
  - "delve"
  - "tapestry"
  - "testament"
  - "intricate"
  - "pivotal"
  # ... 20+ more

rules:
  - "Banned patterns: 'The [noun] was [adjective]', 'As if to [verb], [subject]'"
  - "Sentence variety: avoid 3+ sentences starting with same word"
  - "Dialogue-driven: cut 30% of internal monologue"
```

Plus, the Auditor checks for LLM-tell across 33 dimensions. Failed audits trigger a `revise --mode anti-detect` pass.

### 3. Hook Scheduling (Not Accumulation)

Old approach: Plant hooks, hope they resolve. By chapter 30 you have 50 open threads.

New approach: Planner schedules advancement and payoff.

```yaml
# story/runtime/chapter-31.intent.md
pending_hooks:
  - hook: "What is the tower's true purpose?"
    last_advanced: 28
    payoff_target: 35  # Schedule resolution
    status: progressing
  - hook: "Is the mentor secretly the villain?"
    last_advanced: 15
    payoff_target: 32
    status: open
```

The Planner reads these, decides which to advance, and tells the Writer. No random resolution. Readers see payoff coming.

---

## The 7 Truth Files: Single Source of Truth

Every InkOS book maintains 7 JSON-validated files as the authoritative source:

| File | Purpose |
|------|---------|
| `current_state.json` | Character locations, relationships, knowledge, emotional state |
| `particle_ledger.json` | Resources: items, money, supplies with quantities |
| `pending_hooks.json` | Open plot threads with advancement scheduling |
| `chapter_summaries.json` | Per-chapter events, state changes, hook dynamics |
| `subplot_board.json` | A/B/C line progress tracking |
| `emotional_arcs.json` | Per-character emotion tracking and growth |
| `character_matrix.json` | Encounter records, information boundaries |

When the Writer finishes, the Observer extracts facts into a JSON delta:

```json
{
  "current_state": {
    "characters.protagonist.location": "dungeon_floor_3",
    "characters.protagonist.relationships.mentor.trust": 0.8
  },
  "particle_ledger": {
    "inventory.protagonist.health_potion.quantity": -1
  },
  "pending_hooks": {
    "tower_purpose": {
      "last_advanced": 31,
      "last_mention": "Chapter 31, scene 2"
    }
  }
}
```

The Reflector applies this delta immutably, then validates via Zod:

```typescript
const delta = parseReflectorOutput(output);
const updated = applyRuntimeStateDelta(currentState, delta);
const validated = RuntimeStateSchema.parse(updated);
await persistState(validated);
```

If validation fails, the delta is rejected. No corrupted data. No lost information.

---

## Multi-Model Routing: Quality + Cost

Different agents have different requirements. Writer needs creativity (Claude). Auditor needs speed (GPT-4o). Radar can run local (save cost).

```bash
inkos config set-model writer claude-opus --provider anthropic --api-key-env ANTHROPIC_API_KEY
inkos config set-model auditor gpt-4o --provider openai --api-key-env OPENAI_API_KEY
inkos config set-model radar ollama-mistral --provider custom --base-url http://localhost:11434/v1
```

Each agent pulls its own config. Unconfigured agents fall back to global. Cost per chapter: $2-5 depending on routing.

---

## Genre-Specific Rules, Not Generic Ones

Generic AI can't write Progression Fantasy the way readers expect. InkOS ships with 10 English genre profiles:

**LitRPG:** Numerical system, power scaling, stat progression
**Progression Fantasy:** Power scaling, no numbers required
**Isekai:** Era research, world contrast, cultural fish-out-of-water
**Cultivation:** Power scaling, realm progression
**System Apocalypse:** Numerical system, survival mechanics
**Dungeon Core:** Numerical system, power scaling, territory management
**Romantasy:** Emotional arcs, dual POV pacing
**Sci-Fi:** Era research, tech consistency
**Tower Climber:** Numerical system, floor progression
**Cozy Fantasy:** Low-stakes pacing, comfort-first tone

Each genre includes:
- **Pacing rules:** How fast to escalate power, how long arcs should be
- **Fatigue words:** Genre-specific LLM-tell (different for each genre)
- **Audit dimensions:** What matters for this genre (e.g., "stat progression consistency" for LitRPG, "dual POV balance" for Romantasy)

---

## Continuation + Fanfic Workflows

Want to continue an existing novel? Import chapters:

```bash
inkos import chapters my-book --from existing-novel.txt --split "Chapter\s+\d+"
```

InkOS auto-reverse-engineers all 7 truth files from your source text. From that point, `inkos write next` seamlessly continues the story.

Fanfic mode goes further:

```bash
inkos fanfic init --from source-material.txt --mode canon
```

Four modes available:
- **canon:** Faithful continuation
- **au:** Alternate universe
- **ooc:** Out of character
- **cp:** Ship-focused

Each includes fanfic-specific audit dimensions and lore consistency guards.

---

## Daemon Mode for Unattended Writing

Start a background loop:

```bash
inkos up
```

Writes chapters on a schedule, pausing only for critical issues. Logs to `inkos.log` (JSON Lines). Send notifications via Telegram or webhook (HMAC-SHA256 signed):

```bash
INKOS_TELEGRAM_TOKEN=<token> INKOS_TELEGRAM_CHAT_ID=<id> inkos up
```

---

## Atomic Commands for External Agents

Want to integrate InkOS into your own orchestrator? Every step is independently callable:

```bash
inkos plan chapter my-book --context "Focus on boss encounter" --json
inkos compose chapter my-book --json
inkos draft my-book --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

`--json` output makes integration trivial. External agents can call these via `exec`, decide what to do next, and report back.

---

## The Stack

- **Language:** TypeScript (Node 20+)
- **LLM APIs:** OpenAI, Anthropic, or any OpenAI-compatible endpoint
- **Storage:** SQLite (temporal memory on Node 22+), JSON (truth files)
- **Schema validation:** Zod (prevents corrupted state)
- **CLI:** Commander.js
- **MIT licensed, open-source.**

---

## Getting Started

```bash
npm i -g @actalk/inkos

# One-time setup
inkos config set-global \
  --lang en \
  --provider anthropic \
  --api-key <your-api-key> \
  --model claude-opus

# Create a book
inkos book create --title "My LitRPG" --genre litrpg

# Write autonomously
inkos write next
```

Or use the OpenClaw skill interface if you're running Claude Code or an OpenClaw-compatible agent.

---

## What's Next

- Studio web UI (Vite + React) for chapter review and editing
- Partial chapter intervention (rewrite half a chapter + cascade state updates)
- Novel-to-comic pipeline (truth files → storyboard → manga pages)
- Custom agent plugins

---

## Open Source

Code: https://github.com/Narcooo/inkos
Issues: feedback, features, bug reports always welcome.
Contributions: PRs open, dev setup is `pnpm install && pnpm dev`.

---

*Building autonomy in creative writing. No SaaS. No subscriptions. Your data, your rules.*

---

## 5. MEDIUM ARTICLE

### Title
Why AI Novels Suck (and How I'm Trying to Fix It)

### Full Article

I've read 40+ AI-generated novels. They all sound the same.

Not because the LLM is bad — it's because single-model generation gives you no governance, no continuity checking, and no way to inject your voice.

By chapter 20, you've also blown through $200 in API calls and hit timeout errors. The tool stops working.

I spent two years writing LitRPG novels with ChatGPT, running into these walls every time. So I built InkOS. Not another SaaS subscription. Not another "upload your brief and wait." A real CLI tool that autonomously writes novels the way a human collaborator would.

Here's what I learned.

---

## The Problems with AI Writing Tools

### 1. They Forget

ChatGPT can write a chapter. It can't remember chapter 8 when writing chapter 31.

At first, you inject the full context: "Here's the character state, the resource ledger, the plot hooks, all 7 truth files."

It works until chapter 20. Then:
- API calls timeout (context is too large)
- Costs spiral ($3-4 per chapter becomes $10+)
- The LLM starts losing details anyway (context window is finite)

You end up manually editing chapters to fix continuity. The tool becomes a first-draft generator, not an autonomous writer.

### 2. They All Sound the Same

Every AI-written chapter uses the same fatigue words: "intricate", "testament", "pivotal", "tapestry", "delve". Readers spot it instantly.

Most tools don't even try to fix this. You get a first draft that reads like every other LLM output, and now you're manually rewriting to remove AI-tell.

### 3. They Never Schedule Plot Resolution

I planted 50 hooks across my first AI novel. They resolved at random. Some never resolved at all. By chapter 30, the reader had no idea what the story was actually about.

A human author tracks hooks: "This one resolves at the midpoint. That one is saved for the climax. This one never resolves, but that's the point."

Most AI tools just generate without scheduling. Hooks accumulate. Stories lose focus.

### 4. They're Black Boxes

You have no idea what's being injected into the prompt. You can't govern your creative brief separately from genre rules separately from current focus. Everything gets mashed into one blob. Good luck controlling the output.

---

## InkOS: A Different Approach

I decided to build InkOS around specialization instead of generalization.

Instead of one LLM doing everything, use a 10-agent pipeline:

1. **Planner** reads your intent and retrieves relevant memory
2. **Composer** selects context from truth files, compiles rules
3. **Architect** outlines the chapter: scenes, beats, pacing targets
4. **Writer** produces actual prose (governance + de-AI-ification baked in)
5. **Observer** over-extracts facts from the prose
6. **Reflector** outputs a JSON delta (not full markdown), validates via Zod
7. **Normalizer** adjust word count
8. **Continuity Auditor** checks 33 dimensions: character memory, hook payoff, pacing, emotional arcs, AI-tell
9. **Reviser** auto-fixes issues or flags for human review

Each agent is independent. You can call them separately or chain them.

---

## Why This Matters

### Selective Memory Instead of Context Bloat

By v0.6, I added SQLite temporal memory. Instead of injecting all 7 truth files:

```
SELECT facts WHERE
  (character = 'protagonist' OR mentioned_in_last_5_chapters)
  AND relevance_score > 0.5
LIMIT 50
```

Only relevant facts get injected. Costs stay linear. No timeouts.

### De-AI-ification from the Start

Every genre has a fatigue word list. LitRPG's list includes 25+ words the LLM overuses. The Writer gets explicit instructions: "Banned patterns: 'The [noun] was [adjective]'. Sentence variety: avoid 3+ starting with the same word. Dialogue-driven."

The Auditor checks output for LLM-tell across 33 dimensions. Failed audit → automatic revision pass.

Result: Chapters read like human-written fiction, not LLM output.

### Hook Scheduling, Not Accumulation

The Planner reads your current hooks and schedules advancement + payoff:

```yaml
pending_hooks:
  - hook: "What is the tower's true purpose?"
    last_advanced: 28
    payoff_target: 35  # Resolve by chapter 35
    status: progressing
```

The Writer knows which hooks to push this chapter. No random resolution. Readers see narrative coherence.

### Governed Inputs, Not a Black Box

Your creative brief, genre rules, and current focus are separate documents:

- `story/author_intent.md`: "This book should explore what happens when power corrupts even heroes"
- `story/book_rules.md`: "Protagonist can only cast one spell type. No deus ex machina."
- `story/current_focus.md`: "Next 3 chapters should focus on the mentor conflict"

InkOS compiles these separately, then writes. You see exactly what inputs went in.

---

## The 7 Truth Files

Every book maintains a source of truth:

1. **current_state.json** — Where is everyone? What do they know? What are they feeling?
2. **particle_ledger.json** — What items exist? How many? Where?
3. **pending_hooks.json** — What promises did you make to the reader? When do they resolve?
4. **chapter_summaries.json** — What happened each chapter? What changed?
5. **subplot_board.json** — Where are the A/B/C plots in their arcs?
6. **emotional_arcs.json** — How is each character growing emotionally?
7. **character_matrix.json** — Who has met whom? What do they know about each other?

After writing, the Observer extracts facts into a JSON delta. The Reflector applies it, validates via Zod, and persists.

If validation fails, the chapter is rejected. No corrupted data.

The Auditor checks every chapter against these 7 files: "Does the character reference a weapon they lost? Is the emotion arc progressing? Are we staying within resource bounds?"

33 dimensions of checking. Automatic revision if it fails.

---

## Multi-Model Routing

Writer needs creativity (Claude). Auditor needs speed and cost (GPT-4o). Radar can run local (Ollama, zero cost).

```bash
inkos config set-model writer claude-opus
inkos config set-model auditor gpt-4o
inkos config set-model radar ollama-mistral
```

Each agent pulls its own model. You get the quality you need, pay only for what you use.

---

## Real Genres, Not Generic Fiction

LitRPG has different rules than Romantasy. Tower Climber is different from Cozy Fantasy.

InkOS ships with 10 English genre profiles. Each includes:
- Pacing rules
- Fatigue word lists (unique per genre)
- Audit dimensions (what matters for this genre)

Write LitRPG and the system checks power scaling consistency. Write Romantasy and it balances POV. Write Cozy Fantasy and it enforces low-stakes pacing.

---

## Continuation + Fanfic

Want to continue an existing novel?

```bash
inkos import chapters my-book --from existing-novel.txt
```

InkOS reverse-engineers all 7 truth files from your source. From that point, it writes seamlessly.

Fanfic mode supports canon/AU/OOC/ship workflows with lore consistency guards.

---

## The Result

**In practice:**

- Chapters read human-written (no "intricate", "testament" fatigue)
- Continuity is maintained (character state, resources, hook scheduling)
- Costs stay reasonable ($2-5 per chapter, linear scaling)
- You control the inputs (intent, focus, rules visible as documents)
- You can rewind (state snapshots let you rewrite any chapter)
- No SaaS subscriptions (it's open-source, MIT license)

**Example workflow:**

```bash
# Create a LitRPG novel
inkos book create --title "Dungeon Delver" --genre litrpg --lang en

# Update your intent (optional)
# vim story/author_intent.md

# Write autonomously
inkos write next --count 5

# Review
inkos review list

# Approve
inkos review approve-all

# Export to Kindle
inkos export --format epub
```

---

## What I Got Wrong (and Fixed)

- **First version:** Full markdown truth files. Problem: bloat after 20 chapters. Fix: JSON deltas + Zod validation.
- **Second version:** No hook scheduling. Problem: 50 open threads, random resolution. Fix: Planner schedules payoff, Writer knows which to push.
- **Third version:** Generic de-AI-ification. Problem: Still sounds like LLM. Fix: Genre-specific fatigue words + Auditor checks.

Each fix taught me something. The current version (0.6) solves most of the problems I started with.

---

## What's Next

- Web UI for chapter review and editing (so you don't live in the terminal)
- Novel-to-comic pipeline (truth files → storyboard → pages)
- Custom agent plugins (bring your own audit rules)

---

## Get Started

```bash
npm i -g @actalk/inkos

# Configure once
inkos config set-global --lang en --provider anthropic --api-key <key> --model claude-opus

# Create and write
inkos book create --title "My Novel" --genre litrpg
inkos write next
```

Open source: https://github.com/Narcooo/inkos

No subscriptions. No lock-in. Your data, your rules. Build your novel your way.

---

## 6. HASHNODE ARTICLE

### Title
Deep Dive: Building a 10-Agent Pipeline for Autonomous Novel Writing

### Full Article

This is a technical post about the architecture behind InkOS, an open-source CLI tool for autonomous novel writing. I'll walk through the agent pipeline, state management, schema validation, and multi-model routing.

---

## Architecture Overview

InkOS routes novel-writing decisions through a 10-agent pipeline:

```
Input Governance
  ├─ story/author_intent.md
  ├─ story/current_focus.md
  └─ story/volume_outline.md
       ↓
[Planner Agent]
  ├─ Reads intent + current focus
  ├─ Queries SQLite temporal memory
  └─ Outputs: chapter-XXXX.intent.md (goal, keep/avoid, conflicts)
       ↓
[Composer Agent]
  ├─ Selects relevant context from truth files (relevance filtering)
  ├─ Compiles rule stack (universal rules + genre rules + book rules)
  ├─ Generates: context.json, rule-stack.yaml, trace.json
  └─ No LLM call required (can run offline)
       ↓
[Architect Agent]
  ├─ Outlines chapter: scenes, beats, pacing targets
  └─ Outputs: scene structure (used by Writer, not persisted)
       ↓
[Writer Agent]
  ├─ Produces prose from composed context
  ├─ Length-governed (soft band, corrective normalization)
  ├─ Dialogue-driven (de-AI-ification baked in)
  └─ Outputs: raw chapter markdown
       ↓
[Observer Agent]
  ├─ Over-extracts 9 fact categories:
  │  ├─ Characters (mentions, emotions, knowledge)
  │  ├─ Locations (transitions, descriptions)
  │  ├─ Resources (items, quantities, transactions)
  │  ├─ Relationships (interactions, trust changes)
  │  ├─ Emotions (character emotional state changes)
  │  ├─ Information (what's revealed, foreshadowing)
  │  ├─ Hooks (plot threads, advances, resolutions)
  │  ├─ Time (temporal progression, durations)
  │  └─ Physical State (injuries, transformations)
  └─ Outputs: raw delta (fact listings)
       ↓
[Reflector Agent]
  ├─ Parses fact delta → JSON
  ├─ Applies via applyRuntimeStateDelta() (immutable update)
  ├─ Validates via Zod schema (structural + type checking)
  └─ Rejects if invalid; no corrupted data persists
       ↓
[Normalizer Agent]
  ├─ Single-pass compress/expand to target word count
  ├─ Uses LengthSpec to determine soft/hard bands
  └─ Safety net prevents destructive normalization
       ↓
[Continuity Auditor Agent]
  ├─ Validates against 7 truth files + 33 dimensions:
  │  ├─ Character Memory (do they remember what they witnessed?)
  │  ├─ Resource Continuity (items tracked correctly?)
  │  ├─ Hook Payoff (are hooks advancing as scheduled?)
  │  ├─ Outline Adherence (does chapter follow planned beats?)
  │  ├─ Pacing (too fast? too slow? emotional vs. action ratio?)
  │  ├─ Emotional Arcs (is growth progressing?)
  │  ├─ AI-Tell Detection (fatigue words, sentence patterns, recaps?)
  │  └─ 26 more dimensions (scene count, dialogue ratio, etc.)
  └─ Outputs: audit report with pass/fail + issues
       ↓
[Reviser Agent]
  ├─ Auto-fixes critical issues
  ├─ Flags non-critical issues for human review
  └─ Outputs: revised prose or human-review queue
```

Each agent is independently callable or chainable.

---

## State Management: From Markdown to JSON + SQLite

**v0.5 and earlier:** Truth files were markdown.

```markdown
# Characters

## Protagonist
- Location: Dungeon Floor 3
- Emotional State: Determined but exhausted
- Known Hooks: Tower purpose, Mentor's secret
```

**Problem:** By chapter 30, truth files grow to 5000+ lines. Full-file injection kills latency. Selective injection requires manual parsing.

**v0.6:** Truth files moved to JSON with Zod validation + SQLite temporal memory.

```json
{
  "characters": {
    "protagonist": {
      "id": "char_001",
      "name": "Aria",
      "location": "dungeon_floor_3",
      "emotion": { "primary": "determined", "secondary": "exhausted" },
      "knowledge": ["tower_purpose_mystery", "mentor_secret_unresolved"],
      "lastUpdated": "2024-03-27T12:30:00Z"
    }
  }
}
```

Zod schema validates every delta:

```typescript
const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: z.string(),
  emotion: z.object({
    primary: z.enum(['calm', 'determined', 'afraid', '...']),
    secondary: z.enum(['...'])
  }),
  knowledge: z.array(z.string()),
  lastUpdated: z.string().datetime()
});

const RuntimeStateSchema = z.object({
  characters: z.record(CharacterSchema),
  // ... other truth files
});
```

When Writer finishes, Observer outputs a delta:

```json
{
  "characters.protagonist.location": "dungeon_floor_4",
  "characters.protagonist.emotion.primary": "afraid",
  "characters.protagonist.knowledge": [
    "tower_purpose_revealed",
    "mentor_is_villain"
  ]
}
```

Immutable update:

```typescript
const applyRuntimeStateDelta = (state: RuntimeState, delta: Delta): RuntimeState => {
  let updated = structuredClone(state);
  for (const [path, value] of Object.entries(delta)) {
    setPath(updated, path, value);
  }
  return updated;
};

const newState = applyRuntimeStateDelta(currentState, observerDelta);
const validated = RuntimeStateSchema.parse(newState);
await persistState(validated);
```

If validation fails, entire update is rejected. No partial corruption.

**Temporal Memory (Node 22+):**

SQLite stores every fact update with a timestamp:

```sql
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  first_mention INTEGER,
  last_mention INTEGER,
  relevance_score REAL DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chapter_category ON facts(chapter_number, category);
CREATE INDEX idx_relevance ON facts(relevance_score DESC);
```

Planner queries selectively:

```typescript
const retrieveRelevantFacts = async (
  memory: Database,
  currentChapter: number,
  context: string,
  limit: number = 50
) => {
  return memory
    .prepare(`
      SELECT * FROM facts
      WHERE (
        last_mention >= ? OR
        relevance_score > 0.6
      )
      AND (content ILIKE ? OR content ILIKE ?)
      ORDER BY
        (last_mention = ?) DESC,
        relevance_score DESC,
        updated_at DESC
      LIMIT ?
    `)
    .all(
      currentChapter - 10,
      `%${context}%`,
      `%${extractKeywords(context)}%`,
      currentChapter,
      limit
    );
};
```

Result: Selective context injection. No bloat. Linear cost scaling.

---

## Multi-Model Routing

Each agent can use a different model/provider:

```typescript
interface ModelConfig {
  agent: 'writer' | 'auditor' | 'planner' | 'composer' | ...;
  model: string;
  provider: 'openai' | 'anthropic' | 'custom';
  baseUrl: string;
  apiKey: string; // or apiKeyEnv for env var reference
}
```

CLI config:

```bash
inkos config set-model writer claude-opus \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY

inkos config set-model auditor gpt-4o \
  --provider openai \
  --api-key-env OPENAI_API_KEY

inkos config set-model radar ollama-mistral \
  --provider custom \
  --base-url http://localhost:11434/v1

inkos config show-models
```

Runtime resolution:

```typescript
const getModelConfig = (agent: Agent): ModelConfig => {
  const modelConfig = globalConfig.models[agent.name];
  if (modelConfig) return modelConfig;
  return globalConfig.defaultModel; // fallback
};

const llm = initializeClient(await getModelConfig(agent));
const response = await llm.chat.completions.create({...});
```

Cost optimization: Writer on Claude (quality), Auditor on GPT-4o (speed/cost), Radar on Ollama (free local). Total per chapter: $2-5.

---

## Input Governance: Separated Concerns

Old approach: Mash everything into one prompt.

```
You are a novelist. Here's the brief, genre rules, character state, resources,
hooks, current focus, and outline. Write chapter 15 in 3000 words...
```

New approach: Compile separately.

Three control docs:

1. **story/author_intent.md** (long-horizon)
   ```markdown
   # Author Intent

   This novel explores what happens when power corrupts even good people.
   The protagonist should be sympathetic but increasingly morally grey.
   By the end, readers should question whether they were rooting for a villain.
   ```

2. **story/current_focus.md** (near-term steering)
   ```markdown
   # Current Focus

   Next 3 chapters should deepen the mentor conflict.
   Pull attention away from the tower mystery (too many open threads).
   Establish the romantic subplot as a counterweight to the power struggle.
   ```

3. **story/volume_outline.md** (structural plan)
   ```markdown
   # Volume 1 Outline

   Act 1 (Ch 1-10): Introduce protagonist, establish world
   Act 2 (Ch 11-25): Power escalation, mentor conflict emerges
   Act 3 (Ch 26-35): Mentor revealed as antagonist, climactic choice
   ```

Planner runs first:

```bash
inkos plan chapter my-book --context "Focus on mentor conflict"
```

Outputs: `story/runtime/chapter-31.intent.md`

```markdown
# Chapter 31 Intent

## Goal
Deepen the mentor conflict. Protagonist learns a secret that shakes trust.

## Keep
- Protagonist's determination (core trait)
- Mentor's mysterious agenda (hook payoff target ch35)
- Tower mystery (dormant for 3 chapters, okay)

## Avoid
- Resolving mentor conflict (too early)
- Introducing new major characters (crowded)
- Deus ex machina solutions
- Fatigue words: delve, tapestry, testament, intricate

## Conflicts to Resolve
- Protagonist suspects mentor but has no proof
- Party members side differently
```

Then Composer runs (can run offline):

```bash
inkos compose chapter my-book
```

Outputs:
- `chapter-31.context.json`: Selected facts + scene context
- `chapter-31.rule-stack.yaml`: Universal + genre + book rules
- `chapter-31.trace.json`: Why each fact was selected

Then Writer uses these artifacts:

```bash
inkos draft my-book --words 3000
```

Writer never sees the raw markdown files. Only the compiled artifacts. Full governance. Full transparency.

---

## Genre-Specific Rules

Each genre ships with a unique profile:

```typescript
interface GenreProfile {
  name: 'litrpg' | 'progression_fantasy' | ...;
  language: 'en' | 'zh';

  // Pacing rules
  pacing: {
    powerEscalationRate: 'moderate',
    arcsPerVolume: 3,
    hookDensity: 'medium', // how many hooks to plant per chapter
  };

  // Fatigue word list (LLM-tell detection)
  fatigueWords: [
    'delve', 'tapestry', 'testament', 'intricate', 'pivotal',
    // ... 20+ more
  ];

  // Audit dimensions (genre-specific checks)
  auditDimensions: [
    'stat_progression_consistency',
    'power_scaling_logic',
    'numerical_system_coherence',
    // ... 10+ more
  ];

  // Writing rules
  rules: [
    "Numerical systems must be internally consistent",
    "Power gaps should feel meaningful (not +1 every chapter)",
    "Stat progression should follow a power curve, not linear",
    // ... 20+ more
  ];
}
```

Auditor checks genre-specific dimensions:

```typescript
const auditChapter = async (
  chapter: Chapter,
  state: RuntimeState,
  genre: GenreProfile
): Promise<AuditResult> => {
  const results: AuditDimension[] = [];

  // Universal checks
  for (const dimension of UNIVERSAL_AUDIT_DIMENSIONS) {
    const result = await checkDimension(dimension, chapter, state);
    results.push(result);
  }

  // Genre-specific checks
  for (const dimension of genre.auditDimensions) {
    const result = await checkDimension(dimension, chapter, state);
    results.push(result);
  }

  return {
    passed: results.every(r => r.status === 'pass'),
    dimensions: results,
    criticalIssues: results.filter(r => r.severity === 'critical'),
    recommendedRevisions: results.filter(r => r.recommendation)
  };
};
```

LitRPG checks stat consistency. Romantasy checks POV balance. Cozy Fantasy checks low-stakes pacing. Not generic rules. Real constraints.

---

## Hook Scheduling via Planner

Plot hooks are scheduled for payoff:

```json
{
  "pending_hooks": {
    "hook_001": {
      "id": "hook_001",
      "description": "What is the tower's true purpose?",
      "planted_chapter": 3,
      "last_advanced": 28,
      "payoff_target": 35,
      "status": "progressing",
      "mentions": [
        { "chapter": 5, "type": "foreshadow" },
        { "chapter": 12, "type": "hint" },
        { "chapter": 28, "type": "advancement" }
      ]
    }
  }
}
```

Planner generates a `hookAgenda`:

```typescript
const generateHookAgenda = (
  hooks: PendingHook[],
  currentChapter: number,
  intent: ChapterIntent
): HookAgenda => {
  return {
    advance: hooks.filter(h =>
      h.payoff_target > currentChapter &&
      h.last_advanced <= currentChapter - 3 && // Not mentioned recently
      intent.focus.includes(h.id) // Author wants this pushed
    ),
    defer: hooks.filter(h =>
      h.payoff_target - currentChapter > 5 && // Too early
      !intent.focus.includes(h.id)
    ),
    resolve: hooks.filter(h =>
      h.payoff_target === currentChapter
    )
  };
};
```

Writer knows exactly which hooks to push this chapter. No random resolution. Coherent narrative.

---

## Length Governance

Old approach: "Write 3000 words exactly." Result: AI pads or truncates awkwardly.

New approach: Soft band + corrective normalization.

```typescript
interface LengthSpec {
  target: number; // 3000
  softMin: number; // 2700
  softMax: number; // 3300
  hardMin: number; // 2400 (absolute floor)
  hardMax: number; // 3600 (absolute ceiling)
}

const normalizerPass = async (
  chapter: string,
  spec: LengthSpec
): Promise<{ text: string; adjustment: string }> => {
  const currentLength = wordCount(chapter);

  if (spec.softMin <= currentLength && currentLength <= spec.softMax) {
    return { text: chapter, adjustment: 'none' };
  }

  if (currentLength < spec.softMin) {
    return {
      text: await llm.expand(chapter, spec.softMax - currentLength),
      adjustment: 'expanded'
    };
  }

  if (currentLength > spec.softMax) {
    return {
      text: await llm.compress(chapter, currentLength - spec.softMin),
      adjustment: 'compressed'
    };
  }
};
```

Safety net: If chapter still misses hard range after one pass, save it anyway but surface a warning. Don't destroy prose for the sake of word count.

```typescript
if (finalLength < spec.hardMin || finalLength > spec.hardMax) {
  logger.warn(`Chapter ${n} outside hard range (${finalLength} words)`);
  telemetry.recordLengthWarning(n, finalLength, spec);
}
await saveChapter(n, finalText, finalLength);
```

---

## API Design: Atomic Commands

Every operation is independently callable:

```typescript
// Programmatic API
const planner = new PlannerAgent(config);
const intent = await planner.generateChapterIntent(
  book,
  authorIntent,
  currentFocus,
  bookRules,
  relevantMemory
);

const composer = new ComposerAgent(config);
const composed = await composer.composeChapter(book, intent);

const writer = new WriterAgent(config);
const draft = await writer.writeDraft(book, composed, intent);

const observer = new ObserverAgent(config);
const facts = await observer.extractFacts(draft);

const reflector = new ReflectorAgent();
const delta = reflector.parseAndValidate(facts);

const auditor = new ContinuityAuditor(config);
const auditResult = await auditor.audit(book, draft, state);

if (!auditResult.passed) {
  const reviser = new ReviserAgent(config);
  const revised = await reviser.revise(book, draft, auditResult);
  // Loop until passed
}
```

Also exposed via CLI:

```bash
inkos plan chapter my-book --json > plan.json
inkos compose chapter my-book --json > compose.json
inkos draft my-book --json > draft.json
# ... parse and decide next step
```

And native agent integration:

```bash
inkos agent "Write the next chapter, focusing on the mentor conflict"
```

---

## Error Handling: State Validation

Corrupted state is rejected, never persisted:

```typescript
const persistChapter = async (
  chapter: Chapter,
  delta: RuntimeStateDelta
): Promise<void> => {
  // 1. Parse delta
  let parsed;
  try {
    parsed = JSON.parse(delta);
  } catch (e) {
    throw new Error(`Invalid JSON delta: ${e.message}`);
  }

  // 2. Apply immutably
  const updated = applyRuntimeStateDelta(currentState, parsed);

  // 3. Validate via Zod
  let validated;
  try {
    validated = RuntimeStateSchema.parse(updated);
  } catch (e) {
    // Validation failed. Entire chapter rejected.
    logger.error(`State validation failed: ${e.message}`);
    logger.error(`Chapter ${chapter.number} REJECTED. State rolled back.`);
    throw new ValidationError(e);
  }

  // 4. Persist
  await persistState(validated);
  await saveChapter(chapter);
};
```

If any step fails, the entire update is rolled back. No partial corruption.

---

## Performance: Token Usage Tracking

Every LLM call is tracked:

```typescript
interface TokenUsage {
  agentName: string;
  chapterNumber: number;
  timestamp: Date;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  model: string;
  durationMs: number;
}

const trackTokenUsage = (
  agent: string,
  chapter: number,
  usage: OpenAI.Completions.CompletionUsage,
  model: string,
  durationMs: number
): void => {
  const cost = calculateCost(model, usage.prompt_tokens, usage.completion_tokens);
  telemetry.record({
    agentName: agent,
    chapterNumber: chapter,
    timestamp: new Date(),
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cost,
    model,
    durationMs
  });
};

// Viewable via CLI
inkos analytics my-book
// Total cost: $127.43
// Avg per chapter: $3.82
// Top cost agent: Writer ($89.21)
// Token efficiency: 2.4 tokens per character
```

---

## Wrapping Up

InkOS shows that autonomous writing requires more than a single LLM. It requires:

1. **Specialization:** Different agents for planning, drafting, auditing
2. **State validation:** Zod schemas prevent corrupted data
3. **Selective retrieval:** SQLite temporal memory prevents context bloat
4. **Input governance:** Control documents separated from rules
5. **Genre-aware auditing:** Real constraints, not generic rules
6. **Hook scheduling:** Narrative coherence via Planner
7. **Multi-model routing:** Quality + cost optimization
8. **Error handling:** Corrupt state is rejected, rolled back

The source is open (MIT licensed). Build, fork, extend.

---

## 7. G2

### Product Name & Summary
**InkOS** — Autonomous novel writing CLI with 10-agent pipeline and multi-model routing.

### Description
InkOS is an open-source CLI tool for autonomous novel writing. It manages the complete pipeline: planning chapters, generating prose, extracting story facts, auditing continuity, and revising — with full human control via review gates.

Core features:
- **10-agent architecture** specializes writing (planning, drafting, auditing, revision)
- **33-dimension continuity audit** catches character memory breaks, resource errors, hook payoff timing
- **7 truth files** (JSON-validated) track world state, character matrix, resources, plot hooks, emotional arcs, subplots, summaries
- **Genre-specific rules:** 10 English genres (LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy) with dedicated pacing, fatigue words, audit dimensions
- **Style cloning:** Extract fingerprint from reference text, auto-inject into your book
- **Multi-model routing:** Use different LLMs for different agents (Writer on Claude, Auditor on GPT-4o, Radar on local)
- **SQLite temporal memory:** Prevent context bloat via selective fact retrieval
- **Continuation + fanfic:** Import existing chapters, auto-reverse-engineer state, support canon/AU/OOC/ship workflows
- **De-AI-ification:** Built-in fatigue word detection, LLM-voice removal
- **Daemon mode:** Run unattended with schedule and notifications
- **Atomic CLI:** Call `plan`/`compose`/`draft`/`audit`/`revise` independently or chain together

**Category:** Writer Tools, AI Tools, Content Creation
**Languages:** TypeScript, Node.js
**Price:** Free, Open Source (MIT)
**Integrations:** OpenAI, Anthropic, any OpenAI-compatible API

---

## 8. CAPTERRA

### Product Name
InkOS

### Description
InkOS is an open-source, autonomous novel writing CLI built on a 10-agent architecture. It handles end-to-end writing: from planning and composition through to auditing and revision.

**Key capabilities:**
- Autonomous chapter generation with human review gates
- 33-dimension continuity auditing against 7 canonical truth files
- Genre-specific writing profiles (LitRPG, Progression Fantasy, Isekai, etc.)
- Multi-model routing (different LLMs per agent for cost/quality optimization)
- De-AI-ification (fatigue word detection, LLM-voice removal)
- Style cloning (extract and inject reference text fingerprints)
- SQLite temporal memory for selective context retrieval
- Continuation and fanfic workflows (canon, AU, OOC, ship modes)
- Daemon mode for scheduled, unattended writing with notifications
- Full local control (no SaaS, no subscriptions)

**Technical requirements:** Node.js 20+, TypeScript, API key for OpenAI/Anthropic or OpenAI-compatible endpoint.

**Pricing:** Free, MIT open-source.

---

## 9. BETALIST

### Tagline (short)
Open-source CLI that autonomously writes novels using 10 AI agents and truth-file auditing.

### Description
InkOS is a free, open-source CLI for autonomous novel writing. Instead of single-model generation, it routes writing through a 10-agent pipeline: planner → composer → architect → writer → observer → reflector → normalizer → auditor → reviser.

Every chapter is validated against 7 truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries) via a 33-dimension audit. If continuity breaks, the system automatically revises or flags for human review.

**What makes it different:**
- Genre-specific rules (10 English profiles with dedicated pacing, fatigue words, audit rules)
- Multi-model routing (Writer on Claude, Auditor on GPT-4o, Radar on local)
- Style cloning (extract fingerprint from reference, auto-inject)
- Selective memory via SQLite (prevents context bloat after 20+ chapters)
- De-AI-ification (removes LLM-tell: fatigue words, patterns, recaps)
- Continuation + fanfic (import existing text, auto-reverse-engineer state)
- Daemon mode (unattended writing with Telegram/webhook alerts)
- Atomic CLI (call plan/compose/draft/audit/revise independently)

Supports LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, and more. Full control, no subscriptions.

### Elevator Pitch (2-3 sentences)
InkOS is an open-source CLI for writing novels autonomously. A 10-agent pipeline handles planning, drafting, and auditing. Every chapter is validated against truth files (character state, resources, hooks) to catch continuity errors that single-model generators miss. Genre-specific rules, multi-model routing, style cloning, and more — all free, locally controlled, MIT-licensed.

---

## 10. CRUNCHBASE

### Organization Profile Description
InkOS is an open-source CLI tool for autonomous novel writing. It combines a 10-agent architecture with truth-file auditing to generate narratives that maintain continuity, avoid AI-tell, and adapt to specific genres (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.).

The platform routes writing through specialized agents: Planner (reads intent, retrieves memory), Composer (selects context, compiles rules), Writer (generates prose), Observer (over-extracts facts), Reflector (validates state), Auditor (checks 33 dimensions), Reviser (auto-fixes issues).

Every chapter is validated against 7 canonical truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries) to prevent continuity breaks. Genre-specific audit dimensions ensure chapters follow domain-specific rules (e.g., stat progression consistency for LitRPG, POV balance for Romantasy).

**Key features:** Multi-model routing (different LLMs per agent), SQLite temporal memory (selective context retrieval), style cloning, de-AI-ification, continuation writing, fanfic workflows, daemon mode, full local control.

**Business model:** Open-source (MIT license), no subscriptions, free for all users. Community-driven development.

**Technology:** TypeScript, Node.js 20+, Zod schema validation, SQLite, OpenAI/Anthropic APIs or OpenAI-compatible endpoints.

---

## 11. LINKEDIN

### Company Page Description

**About InkOS**

InkOS is an open-source CLI for autonomous novel writing. We built it because every AI writing tool had the same problems: continuity breaks, AI-tell, context bloat, and no hook scheduling. We solved them with a 10-agent architecture and truth-file auditing.

How it works:
- **10-agent pipeline:** Planner reads intent, Composer selects context, Writer generates prose, Observer extracts facts, Reflector validates state via Zod, Auditor checks 33 dimensions, Reviser auto-fixes
- **7 truth files:** Character state, resources, plot hooks, emotional arcs, subplots, summaries — single source of truth
- **33-dimension audit:** Character memory, resource continuity, hook payoff timing, pacing, emotional arcs, AI-tell detection
- **Genre-specific rules:** 10 English profiles (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.) with dedicated pacing, fatigue words, audit rules
- **Multi-model routing:** Different agents use different LLMs (Writer on Claude, Auditor on GPT-4o, Radar on local)
- **Selective memory:** SQLite temporal database prevents context bloat after 20+ chapters
- **De-AI-ification:** Built-in fatigue word detection and LLM-voice removal
- **Style cloning:** Extract and inject reference text fingerprints
- **Continuation + fanfic:** Import existing chapters, auto-reverse-engineer state, support canon/AU/OOC/ship workflows
- **Daemon mode:** Run unattended with Telegram/webhook notifications
- **Full control:** Open-source, MIT-licensed, no subscriptions, locally hosted

**For:** Fiction writers, indie authors, AI researchers, content creators.
**Stack:** TypeScript, Node.js, SQLite, OpenAI/Anthropic APIs.
**GitHub:** https://github.com/Narcooo/inkos

---

### Launch Announcement Post #1: Introducing InkOS

We launched InkOS: an open-source CLI for autonomous novel writing.

Why it exists: Every AI writing tool hit the same walls. Continuity breaks after 20 chapters. AI-tell in every paragraph (same fatigue words, patterns). Hook scheduling doesn't exist. Context bloat kills API costs.

We redesigned from scratch around a 10-agent pipeline instead of single-model generation. Result: chapters that maintain continuity, avoid LLM-voice, and follow genre-specific rules (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.).

Every chapter is validated against 7 truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries) via 33-dimension audit. Continuity errors get auto-fixed or flagged for human review.

**What you get:**
- Genre-specific rules (not generic)
- Multi-model routing (quality + cost)
- Style cloning (extract reference fingerprint)
- Hook scheduling (narrative coherence)
- De-AI-ification (removes AI-tell)
- SQLite temporal memory (no context bloat)
- Daemon mode (unattended writing)
- Full control (open-source, MIT)

Get started: `npm i -g @actalk/inkos`

GitHub: https://github.com/Narcooo/inkos

---

### Launch Announcement Post #2: The Problems We're Solving

AI writing tools sound promising until you actually use them.

**The problems:**

1. **Continuity breaks.** By chapter 20, character memories contradict, weapons reappear, relationships flip. Single-model generation has no way to check.

2. **AI-tell.** Every chapter reads like LLM output. Same fatigue words ("intricate", "testament", "pivotal"). Same sentence patterns. Readers spot it instantly.

3. **Context bloat.** Injecting full truth files kills latency and costs balloon. By chapter 30, it's $10+ per chapter and timeouts happen.

4. **No hook scheduling.** You plant 50 plot hooks. They resolve randomly or never. By chapter 30, the story has no focus.

5. **Black box inputs.** Your creative brief, genre rules, and current focus get mashed into one massive prompt. No governance. No transparency.

InkOS solves these:

- **33-dimension audit** against 7 truth files catches continuity errors
- **Genre-specific fatigue word lists** remove AI-tell at the source
- **SQLite temporal memory** enables selective context retrieval (no bloat)
- **Hook scheduling** via Planner ensures payoff timing
- **Separated input governance** (intent, focus, rules as readable documents)
- **Multi-model routing** reduces cost per chapter to $2-5

Open-source. MIT license. Full control. https://github.com/Narcooo/inkos

---

### Launch Announcement Post #3: Architecture Breakdown

How does a 10-agent pipeline write novels?

Each chapter flows through agents in sequence:

1. **Planner** — Reads author intent + current focus. Queries SQLite memory. Generates chapter goal + keep/avoid list.
2. **Composer** — Selects relevant context from truth files. Compiles rule stack. Generates execution artifacts.
3. **Architect** — Plans chapter structure: scenes, beats, pacing targets.
4. **Writer** — Produces prose from composed context. Length-governed. De-AI-ified.
5. **Observer** — Over-extracts 9 fact categories (characters, locations, resources, relationships, emotions, information, hooks, time, physical state).
6. **Reflector** — Outputs JSON delta. Validates via Zod schema. Rejects if invalid.
7. **Normalizer** — Single-pass compress/expand to target word count.
8. **Auditor** — Validates against 7 truth files, 33 dimensions.
9. **Reviser** — Auto-fixes critical issues. Flags others for human review.

Each agent is independently callable or chainable. You can call `plan` → `compose` → `draft`, inspect the artifacts, decide on `audit` + `revise`, or run `write next` for full pipeline automation.

**Result:** Chapters that maintain state, follow rules, and get validated automatically. No manual continuity checking. No context bloat. No AI-tell.

Open-source. MIT licensed. https://github.com/Narcooo/inkos

---

## 12. WELLFOUND / ANGELLIST

### Company Description
InkOS is an open-source CLI for autonomous novel writing built on a 10-agent architecture and truth-file auditing.

We solve the core problems with single-model novel generation:
1. **Continuity breaks** (characters forget things, weapons vanish) — Solved by validating against 7 truth files via 33-dimension audit
2. **AI-tell** (same fatigue words, patterns, voice) — Solved by genre-specific word lists and de-AI-ification at the source
3. **Context bloat** (full-file injection kills latency, costs spiral) — Solved by SQLite temporal memory and selective fact retrieval
4. **No plot scheduling** (50 open hooks, random resolution) — Solved by Planner scheduling hook payoff timing
5. **Input chaos** (brief, rules, focus mashed together) — Solved by separated governance documents

**Architecture:**
- 10-agent pipeline (Planner → Composer → Architect → Writer → Observer → Reflector → Normalizer → Auditor → Reviser)
- 7 canonical truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries)
- 33-dimension continuity audit (character memory, resource tracking, hook payoff, pacing, emotions, AI-tell)
- 10 genre-specific profiles (LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy)
- Multi-model routing (different LLMs per agent)
- Style cloning (extract and inject reference fingerprints)
- Continuation + fanfic (import existing chapters, auto-migrate state)
- Daemon mode (unattended writing with notifications)

**Business model:** Open-source (MIT), no subscriptions, free forever.

**For:** Indie authors, fiction writers, AI researchers, content teams.

**Stack:** TypeScript, Node.js 20+, SQLite, Zod schema validation, OpenAI/Anthropic APIs.

### Elevator Pitch
InkOS is an open-source CLI that autonomously writes novels using a 10-agent pipeline and truth-file auditing. Every chapter validates against character state, resources, plot hooks, and emotional arcs to prevent continuity breaks. Genre-specific rules (LitRPG, Progression Fantasy, Isekai, etc.), multi-model routing, selective memory, and de-AI-ification built-in. Free, locally controlled, MIT-licensed.

---

## 13. ABOUT.ME

### Creator Bio
I'm a fiction writer and software engineer building InkOS — an open-source CLI for autonomous novel writing.

I spent two years writing LitRPG with ChatGPT, hit the same walls every AI writer hits (continuity breaks, AI-tell, context bloat, no hook scheduling), and decided to build a better approach from scratch.

InkOS runs a 10-agent pipeline: planning, composition, writing, observation, reflection, auditing, and revision. Every chapter is validated against 7 truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries) via a 33-dimension audit. Genre-specific rules, multi-model routing, selective memory, style cloning, continuation workflows — all free and open-source.

No subscriptions. No SaaS. Full control.

**InkOS:** https://github.com/Narcooo/inkos
**npm:** `npm i -g @actalk/inkos`

---

## 14. BEHANCE

### Project Title
InkOS: Autonomous Novel Writing CLI

### Description
InkOS is an open-source command-line interface for autonomous novel writing built on a 10-agent architecture and truth-file auditing.

**Problem:** Single-model AI generation fails at long-form fiction. Continuity breaks, AI-tell is ubiquitous, costs spiral after 20 chapters, plot hooks never resolve.

**Solution:** A specialized 10-agent pipeline handles planning, composition, writing, observation, reflection, auditing, and revision. Every chapter validates against 7 canonical truth files via 33-dimension audit. Genre-specific rules (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.) ensure chapters follow domain-specific constraints.

**Key features:**
- Multi-agent specialization (Planner, Composer, Architect, Writer, Observer, Reflector, Normalizer, Auditor, Reviser)
- 7 truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries)
- 33-dimension continuity audit (character memory, resource tracking, hook payoff, pacing, emotions, AI-tell detection)
- 10 genre-specific profiles with dedicated rules, pacing, fatigue words, audit dimensions
- Multi-model routing (different LLMs per agent for cost/quality optimization)
- SQLite temporal memory (selective context retrieval, prevents bloat)
- De-AI-ification (built-in fatigue word detection and LLM-voice removal)
- Style cloning (extract fingerprint from reference, auto-inject into book)
- Continuation + fanfic workflows (import existing chapters, auto-reverse-engineer state, canon/AU/OOC/ship modes)
- Daemon mode (unattended writing with schedule and notifications)
- Atomic CLI (call plan/compose/draft/audit/revise independently or chain)

**Technology:** TypeScript, Node.js 20+, SQLite, Zod schema validation, OpenAI/Anthropic APIs or OpenAI-compatible endpoints.

**Open-source:** MIT licensed, no subscriptions, full local control.

---

## 15. SLIDESHARE

### Description for Presentation Deck

**InkOS: Autonomous Novel Writing with 10-Agent Pipeline**

An open-source CLI tool for writing novels autonomously using a specialized 10-agent architecture and truth-file auditing.

**What it solves:**
- Continuity breaks (character memory, resource tracking, hook scheduling)
- AI-tell (fatigue words, patterns, LLM-voice removal)
- Context bloat (SQLite selective retrieval instead of full-file injection)
- Input chaos (separated governance: intent, focus, rules as readable documents)

**How it works:**
- 10-agent pipeline: Planner → Composer → Architect → Writer → Observer → Reflector → Normalizer → Auditor → Reviser
- 7 canonical truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries)
- 33-dimension continuity audit
- 10 genre-specific profiles (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.)
- Multi-model routing (different LLMs per agent)
- Hook scheduling (Planner generates payoff timeline)
- De-AI-ification (fatigue word lists, style fingerprinting)
- Continuation + fanfic workflows
- Daemon mode (unattended writing)
- Atomic CLI (composable commands)

**Stack:** TypeScript, Node.js, SQLite, Zod, OpenAI/Anthropic APIs.

**Licensing:** MIT open-source, no subscriptions.

---

## 16. DISQUS

### Profile Bio
Software engineer + fiction writer building InkOS, an open-source CLI for autonomous novel writing. Interested in AI agents, long-form content generation, truth-file auditing, and multi-model routing. Open to discussions on novel-writing constraints, agent specialization, state validation, and building tools for creative work.

---

## 17. F6S (Founder Institute)

### Startup Description
InkOS is an open-source CLI for autonomous novel writing. Instead of single-model generation, it routes writing through a 10-agent pipeline with truth-file validation to catch continuity errors, remove AI-tell, and follow genre-specific rules.

**Problem:**
- AI writing tools fail at long-form fiction
- Continuity breaks by chapter 20
- AI-tell is obvious to readers
- Context bloat and costs spiral
- Plot hooks accumulate, never resolve
- No governance or transparency

**Solution:**
- 10-agent specialized pipeline
- 7 canonical truth files (JSON-validated)
- 33-dimension audit (character memory, resources, hooks, pacing, emotions, AI-tell)
- Genre-specific rules (LitRPG, Progression Fantasy, Isekai, etc.)
- Multi-model routing (different LLMs per agent)
- SQLite selective memory (no context bloat)
- Hook scheduling (Planner tracks payoff timing)
- De-AI-ification (fatigue word lists, style injection)
- Continuation + fanfic (import and extend existing novels)
- Daemon mode (unattended writing)
- Atomic CLI (composable, external-agent friendly)

**Business model:** Open-source (MIT), free, no subscriptions.

**Users:** Indie authors, fiction writers, AI researchers, content creators.

**Stack:** TypeScript, Node.js, SQLite, Zod, OpenAI/Anthropic.

---

## 18. ISSUU

### Document Description (for Product Guide Upload)

**InkOS: Autonomous Novel Writing CLI — Product Guide**

An open-source, free tool for writing novels autonomously using a 10-agent architecture and truth-file auditing.

**What it does:**
- Generates chapters autonomously (plan → compose → write → audit → revise)
- Validates continuity against 7 truth files (character state, resources, plot hooks, emotional arcs, subplots, summaries)
- Removes AI-tell (fatigue words, patterns, LLM-voice detection)
- Prevents context bloat (SQLite selective memory)
- Schedules plot hook payoff (Planner generates timeline)
- Enforces genre-specific rules (10 profiles: LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, etc.)
- Routes to different LLMs per agent (quality + cost optimization)
- Imports and continues existing novels
- Supports fanfic workflows (canon, AU, OOC, ship modes)
- Runs daemon mode (unattended, scheduled writing)

**Getting started:**
```bash
npm i -g @actalk/inkos
inkos config set-global --lang en --provider anthropic --api-key <key> --model claude-opus
inkos book create --title "My Novel" --genre litrpg
inkos write next
```

**Technology:** TypeScript, Node.js 20+, SQLite, Zod schema validation, OpenAI/Anthropic APIs.

**Licensing:** MIT open-source, free forever, full local control.

**GitHub:** https://github.com/Narcooo/inkos

---

## END OF DOCUMENT

All platform-specific copy is ready to use. Tone is technical, builder-focused, factual — no marketing-speak. Copy emphasizes real problems solved, actual features, and technical implementation. Suitable for HN, developer communities, and technical audiences.
