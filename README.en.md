<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">Multi-Agent Novel Production System</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

---

Open-source multi-agent system that autonomously writes, audits, and revises novels — with human review gates that keep you in control.

## v0.4 Update

Continuation writing + spinoff writing + style cloning + multi-provider routing + post-write validator + audit-revise hardening.

### Continuation Writing (Import Existing Work)

Import an existing novel (single file or chapter directory) into InkOS. The system auto-splits chapters, reverse-engineers all truth files (world state, hooks, character matrix, etc.), then seamlessly continues writing.

```bash
inkos import chapters my-book --from chapters/          # Import from directory
inkos import chapters my-book --from novel.txt           # Import from single file (auto-splits on "第X章")
inkos import chapters my-book --from novel.txt --split "Chapter\\s+\\d+"  # Custom split regex
inkos write next my-book                                 # Continue writing seamlessly
```

Single-file mode splits on `第X章` by default. Use `--split <regex>` for custom patterns. Interrupted imports can resume with `--resume-from <n>`.

### Spinoff Writing

Create prequels, sequels, side-stories, or what-if branches from existing books. Spinoffs share the parent's world and characters but have independent plot lines.

```bash
inkos import canon my-prequel --from main-novel   # Import parent canon
inkos write next my-prequel                        # Writer auto-reads canon constraints
```

Generates `story/parent_canon.md` containing the parent's world rules, character snapshots (with information boundaries), key event timeline, and foreshadowing state. The auditor auto-activates 4 spinoff-specific dimensions:

| Dimension | Checks |
|-----------|--------|
| Canon Event Conflict | Whether spinoff events contradict the parent's canon constraints |
| Future Info Leak | Whether characters reference information revealed after the divergence point |
| Cross-Book World Consistency | Whether the spinoff violates parent world rules (power systems, geography, factions) |
| Spinoff Foreshadowing Isolation | Whether the spinoff oversteps by resolving parent foreshadowing |

Auto-activates when `parent_canon.md` is detected. No extra configuration needed.

### Style Cloning

Feed in a real novel excerpt. The system extracts a statistical fingerprint + generates a qualitative style guide, then injects both into every chapter's Writer prompt.

```bash
inkos style analyze reference.txt                      # Analyze: sentence length, TTR, rhetorical features
inkos style import reference.txt my-book --name "Author"  # Import style into book
```

Produces two files:
- `style_profile.json` — statistical fingerprint (sentence/paragraph length distribution, vocabulary diversity, rhetorical density)
- `style_guide.md` — LLM-generated qualitative guide (rhythm, tone, word preferences, taboos)

The Writer reads the style guide every chapter; the Auditor cross-checks against it in the style dimension.

### Post-Write Validator

11 deterministic rules, zero LLM cost, fires immediately after each chapter:

| Rule | Description |
|------|-------------|
| Banned Patterns | "not X… but Y…" sentence structure |
| Dash Prohibition | em-dash "——" |
| Transition Word Density | "as if" / "suddenly" / "unexpectedly" — max 1 per 3,000 words |
| High-Fatigue Words | Genre fatigue words: max 1 per word per chapter |
| Meta-Narration | Screenwriter-style commentary |
| Report Terminology | Analytical framework terms banned from prose |
| Author Sermonizing | "obviously" / "needless to say" etc. |
| Collective Shock | "the whole crowd was stunned" cliches |
| Consecutive "le" (了) | ≥ 6 consecutive sentences containing "了" |
| Paragraph Length | ≥ 2 paragraphs over 300 characters |
| Book Prohibitions | Custom bans from book_rules.md |

When the validator finds error-level violations, it auto-triggers `spot-fix` mode for targeted repair before the LLM audit even runs.

### Audit-Revise Loop Hardening

Real testing showed `rewrite` mode introduces 6x more AI markers than the original text. Now:

- Auto-revise mode changed from `rewrite` to `spot-fix` (only fixes flagged sentences, leaves everything else untouched)
- Post-revise AI marker guard: if revision increases AI tell count, the revision is discarded
- Re-audit temperature locked to 0 (deterministic pass/fail gating)
- `polish` mode boundaries strengthened (no adding paragraphs, renaming entities, or changing causality)

### Multi-Provider Agent Routing

Different agents can use completely different API providers — not just different model names, but different API endpoints and keys. For example, use a cheap model for drafting and a strong model for auditing:

```bash
inkos config set-model writer gpt-4o-mini                                    # Simple model override
inkos config set-model auditor gemini-2.5-flash \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --provider openai \
  --api-key-env GEMINI_API_KEY                                                # Route to Gemini API
inkos config set-model reviser claude-sonnet-4-20250514 \
  --base-url https://api.anthropic.com \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY                                             # Route to Anthropic API
inkos config show-models                                                      # View full routing
```

Each agent independently configurable with `--base-url`, `--provider`, `--api-key-env`, `--no-stream`. Unconfigured agents use the project default.

### Analytics

```bash
inkos analytics my-book          # Audit pass rate, top issue categories, chapters with most issues
inkos analytics my-book --json   # Structured output
```

### Other v0.4 Changes

- Audit dimensions expanded from 26 to 33 (+4 spinoff dims + dim 27 sensitive words + dim 32 reader expectation management + dim 33 outline adherence detection)
- All 5 genres now activate dims 24-26 (subplot stagnation / flat emotional arc / monotonous pacing)
- Auditor web search: era-research genres can verify real events/people/geography online (native search)
- Scheduler rewrite: AI-paced (15min cycles), parallel book processing, immediate retry, daily cap
- New `spot-fix` revise mode (targeted repair)
- `additionalAuditDimensions` in `book_rules.md` now supports name-string matching
- `inkos export` supports `--format md`, `--output <path>`, `--approved-only`
- Post-write validator consecutive "了" threshold raised from 4 to 6 (reduces false positives in Chinese prose)
- Safety hardening: `init`/`book create`/`import chapters` overwrite guards, `config set` type coercion + key validation, `update` downgrade prevention, `doctor` works outside projects, consistent status display, `genre show` rejects invalid IDs

---

## v0.3 Update

Three-layer rule separation + cross-chapter memory + AIGC detection + Webhook.

### Cross-Chapter Memory & Writing Quality

The Writer auto-generates chapter summaries, updates subplot/emotion/character matrices — all appended to truth files. Subsequent chapters load full context, so long-term foreshadowing never gets lost.

| Truth File | Purpose |
|------------|---------|
| `chapter_summaries.md` | Per-chapter summaries: characters, key events, state changes, hook dynamics |
| `subplot_board.md` | Subplot progress board: A/B/C line status tracking |
| `emotional_arcs.md` | Emotional arcs: per-character emotion, triggers, arc direction |
| `character_matrix.md` | Character interaction matrix: encounter records, information boundaries |

### AIGC Detection

| Feature | Description |
|---------|-------------|
| AI-Tell Audit | Pure rule-based detection (no LLM): paragraph uniformity, hedge word density, formulaic transitions, list-like structure — auto-merged into audit results |
| AIGC Detection API | External API integration (GPTZero / Originality / custom endpoints), `inkos detect` command |
| Style Fingerprint | Extract StyleProfile from reference text (sentence length, TTR, rhetorical features), inject into Writer prompt |
| Anti-Detect Rewrite | ReviserAgent `anti-detect` mode, detect → rewrite → re-detect loop |
| Detection Feedback Loop | `detection_history.json` records each detection/rewrite result, `inkos detect --stats` for statistics |

```bash
inkos style analyze reference.txt           # Analyze reference text style
inkos style import reference.txt my-book    # Import style into book
inkos detect my-book --all                  # Detect all chapters
inkos detect --stats                        # Detection statistics
```

### Webhook + Smart Scheduler

Pipeline events POST JSON to configured URLs (HMAC-SHA256 signed), with event filtering (`chapter-complete`, `audit-failed`, `pipeline-error`, etc.). Daemon mode adds quality gates: auto-retry on audit failure (with temperature ramp), pause book after consecutive failures.

### Genre Customization

5 built-in genres, each with a complete set of writing rules: chapter types, prohibition lists, fatigue words, language rules, and audit dimensions.

| Genre | Built-in Rules |
|-------|---------------|
| Xuanhuan (Fantasy) | Numerical system, power scaling, same-type absorption decay formula, face-slap/upgrade/payoff pacing |
| Xianxia (Cultivation) | Cultivation/enlightenment pacing, artifact system, heavenly dao rules |
| Urban | Era research, business/social-driven plot, era-matched legal terminology, no numerical system |
| Horror | Atmosphere progression, fear levels, restrained narration, no power scaling audit |
| General | Minimal fallback |

Specify a genre when creating a book and matching rules activate automatically:

```bash
inkos book create --title "Devouring Emperor" --genre xuanhuan
```

View, copy, or create genre rules:

```bash
inkos genre list                      # List all genres
inkos genre show xuanhuan             # View full xuanhuan rules
inkos genre copy xuanhuan             # Copy to project for customization
inkos genre create wuxia --name Wuxia # Create a new genre from scratch
```

After copying to your project, add/remove prohibitions, adjust fatigue words, modify pacing rules, customize language rules — changes take effect on the next chapter.

Each genre has dedicated language rules (with bad → good examples), enforced by both writer and auditor:

- **Xuanhuan**: ✗ "Fire essence increased from 12 to 24 wisps" → ✓ "His arm felt stronger than before, knuckles tightening into a fist"
- **Urban**: ✗ "Quickly analyzed the current debt situation" → ✓ "Flipped through the stack of wrinkled IOUs three times"
- **Horror**: ✗ "Felt a wave of fear" → ✓ "The hairs on the back of his neck stood up one by one"

### Per-Book Rules

Each book has its own `book_rules.md`, auto-generated by the Architect agent when creating a book — also editable anytime. Rules here are injected into every chapter's prompt:

```yaml
protagonist:
  name: Lin Jin
  personalityLock: ["ruthlessly calm", "patient but lethal", "smart, not reckless"]
  behavioralConstraints: ["no mercy, no hesitation", "warm to allies but never sentimental"]
numericalSystemOverrides:
  hardCap: 840000000
  resourceTypes: ["particles", "bloodline density", "spirit stones"]
prohibitions:
  - protagonist goes soft at critical moments
  - pointless harem romance dragging the plot
  - side characters stealing the spotlight
fatigueWordsOverride: ["pupils constricted", "disbelief"]   # Override genre defaults
```

Protagonist personality lock, numerical caps, custom prohibitions, fatigue word overrides — each book's rules are independent, without affecting the genre template.

### 33-Dimension Audit

Auditing is broken down into 33 dimensions, with genre-appropriate subsets auto-enabled:

OOC check, timeline, setting conflicts, power scaling collapse, numerical verification, foreshadowing, pacing, writing style, information leaking, vocabulary fatigue, broken interest chains, era research, side character intelligence drops, side character tool-ification, hollow payoffs, dialogue authenticity, padding detection, knowledge base contamination, POV consistency, paragraph uniformity, hedge word density, formulaic transitions, list-like structure, subplot stagnation, flat emotional arc, monotonous pacing, sensitive word check, canon event conflict, future info leak, cross-book world consistency, spinoff foreshadowing isolation, reader expectation management, outline adherence detection

Dims 20-23 (AI-tell detection) + dim 27 (sensitive words) use a pure rule engine — no LLM calls. Dims 28-31 (spinoff) auto-activate when `parent_canon.md` is detected. Dim 32 (reader expectation management) and dim 33 (outline adherence detection) are always on.

### De-AI-ification

5 universal rules + genre-specific language rules to control AI marker word density and narration habits:

- AI marker word frequency limit: "as if" / "suddenly" / "unexpectedly" / "couldn't help but" — max 1 per 3,000 words
- Narrator never draws conclusions for the reader, only writes actions
- No analytical report language ("core motivation", "information gap" never appear in prose)
- Same imagery rendered no more than twice
- Methodology jargon stays out of prose

Vocabulary fatigue audit + AI-tell audit (dims 20-23) provide dual detection. Style fingerprint injection further reduces AI text characteristics.

### Other

- Supports OpenAI + Anthropic native + all OpenAI-compatible endpoints
- Reviser supports polish / rewrite / rework / anti-detect / spot-fix modes
- Genres without numerical systems skip resource ledger generation
- All commands support `--json` structured output for OpenClaw / external agent integration
- Auto-detect book-id when project has only one book
- `inkos update` for self-updating, `inkos init` supports current directory
- API errors include diagnostic hints, `inkos doctor` includes connectivity test

---

## Why InkOS?

Writing a novel with AI isn't just "prompt and paste." Long-form fiction breaks down fast: characters forget things, items appear from nowhere, the same adjectives repeat every paragraph, and plot threads silently die. InkOS treats these as engineering problems.

- **Canonical truth files** — track the real state of the world, not what the LLM hallucinates
- **Anti-information-leaking** — characters only know what they've actually witnessed
- **Resource decay** — supplies deplete and items break, no infinite backpacks
- **Vocabulary fatigue detection** — catches overused words before readers do
- **Auto-revision** — fixes math errors and continuity breaks before human review

## How It Works

Each chapter is produced by five agents in sequence:

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="Pipeline diagram">
</p>

| Agent | Responsibility |
|-------|---------------|
| **Radar** | Scans platform trends and reader preferences to inform story direction (pluggable, skippable) |
| **Architect** | Plans chapter structure: outline, scene beats, pacing targets |
| **Writer** | Produces prose from the plan + current world state |
| **Continuity Auditor** | Validates the draft against canonical truth files |
| **Reviser** | Fixes issues found by the auditor — auto-fixes critical problems, flags others for human review |

If the audit fails, the pipeline automatically enters a revise → re-audit loop until all critical issues are resolved.

### Canonical Truth Files

Every book maintains 7 truth files as the single source of truth:

| File | Purpose |
|------|---------|
| `current_state.md` | World state: character locations, relationships, knowledge, emotional arcs |
| `particle_ledger.md` | Resource accounting: items, money, supplies with quantities and decay tracking |
| `pending_hooks.md` | Open plot threads: foreshadowing planted, promises to readers, unresolved conflicts |
| `chapter_summaries.md` | Per-chapter summaries: characters, key events, state changes, hook dynamics |
| `subplot_board.md` | Subplot progress board: A/B/C line status tracking |
| `emotional_arcs.md` | Emotional arcs: per-character emotion tracking and growth |
| `character_matrix.md` | Character interaction matrix: encounter records, information boundaries |

The Continuity Auditor checks every draft against these files. If a character "remembers" something they never witnessed, or pulls a weapon they lost two chapters ago, the auditor catches it. Legacy books without new truth files are automatically compatible.

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="Truth files snapshot">
</p>

### Writing Rule System

The Writer agent has ~25 universal writing rules (character craft, narrative technique, logical consistency, language constraints, de-AI-ification), applicable to all genres.

On top of that, each genre has dedicated rules (prohibitions, language rules, pacing, audit dimensions), and each book has its own `book_rules.md` (protagonist personality, numerical caps, custom prohibitions) and `story_bible.md` (worldbuilding), auto-generated by the Architect agent.

See [v0.3 Update](#v03-update-2026-03-13) for details.

## Three Usage Modes

InkOS provides three interaction modes, all sharing the same atomic operations:

### 1. Full Pipeline (One Command)

```bash
inkos write next my-book              # Draft → audit → auto-revise, all in one
inkos write next my-book --count 5    # Write 5 chapters in sequence
```

### 2. Atomic Commands (Composable, External Agent Friendly)

```bash
inkos draft my-book --context "Focus on master-disciple conflict" --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

Each command performs a single operation independently. `--json` outputs structured data. Can be called by OpenClaw or other AI agents via `exec`, or used in scripts.

### 3. Natural Language Agent Mode

```bash
inkos agent "Write an urban cultivation novel with a programmer protagonist"
inkos agent "Write the next chapter, focus on master-disciple conflict"
inkos agent "Scan market trends first, then create a new book based on results"
```

13 built-in tools (write_draft, audit_chapter, revise_chapter, scan_market, create_book, get_book_status, read_truth_files, list_books, write_full_pipeline, web_fetch, import_style, import_canon, import_chapters), with the LLM deciding call order via tool-use.

## Quick Start

### Install

```bash
npm i -g @actalk/inkos
```

### Configure

**Option 1: Global config (recommended, one-time setup)**

```bash
inkos config set-global \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-xxx \
  --model gpt-4o
```

Saved to `~/.inkos/.env`, shared by all projects. New projects just work without extra config.

**Option 2: Per-project `.env`**

```bash
inkos init my-novel     # Initialize project
# Edit my-novel/.env
```

```bash
# Required
INKOS_LLM_PROVIDER=openai                        # openai / anthropic
INKOS_LLM_BASE_URL=https://api.openai.com/v1     # API endpoint (proxy-friendly)
INKOS_LLM_API_KEY=sk-xxx                          # API Key
INKOS_LLM_MODEL=gpt-4o                            # Model name

# Optional
# INKOS_LLM_TEMPERATURE=0.7                       # Temperature
# INKOS_LLM_MAX_TOKENS=8192                        # Max output tokens
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic extended thinking budget
```

Project `.env` overrides global config. Skip it if no override needed.

### Usage

```bash
inkos book create --title "Devouring Emperor" --genre xuanhuan  # Create a book
inkos write next my-book          # Write next chapter (full pipeline)
inkos status                      # Check status
inkos review list my-book         # Review drafts
inkos export my-book              # Export full book
inkos up                          # Daemon mode
```

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="Terminal screenshot">
</p>

## CLI Reference

| Command | Description |
|---------|-------------|
| `inkos init [name]` | Initialize project (omit name to init current directory) |
| `inkos book create` | Create a new book (`--genre`, `--platform`, `--chapter-words`, `--target-chapters`, `--context`) |
| `inkos book update [id]` | Update book settings (`--chapter-words`, `--target-chapters`, `--status`) |
| `inkos book list` | List all books |
| `inkos genre list/show/copy/create` | View, copy, or create genres |
| `inkos write next [id]` | Full pipeline: write next chapter (`--words` to override, `--count` for batch) |
| `inkos write rewrite [id] <n>` | Rewrite chapter N (restores state snapshot, `--force` to skip confirmation, `--words` to override) |
| `inkos draft [id]` | Write draft only (`--words` to override word count) |
| `inkos audit [id] [n]` | Audit a specific chapter |
| `inkos revise [id] [n]` | Revise a specific chapter |
| `inkos agent <instruction>` | Natural language agent mode |
| `inkos review list [id]` | Review drafts |
| `inkos review approve-all [id]` | Batch approve |
| `inkos status [id]` | Project status |
| `inkos export [id]` | Export book (`--format md`, `--output <path>`, `--approved-only`) |
| `inkos radar scan` | Scan platform trends |
| `inkos config set-global` | Set global LLM config (~/.inkos/.env) |
| `inkos config show-global` | Show global config |
| `inkos config set/show` | View/update project config |
| `inkos config set-model <agent> <model>` | Set model override for a specific agent (`--base-url`, `--provider`, `--api-key-env` for multi-provider routing) |
| `inkos config remove-model <agent>` | Remove agent model override (fall back to default) |
| `inkos config show-models` | Show current model routing |
| `inkos doctor` | Diagnose setup issues (includes API connectivity test) |
| `inkos detect [id] [n]` | AIGC detection (`--all` for all chapters, `--stats` for statistics) |
| `inkos style analyze <file>` | Analyze reference text to extract style fingerprint |
| `inkos style import <file> [id]` | Import style fingerprint into a book |
| `inkos import canon [id] --from <parent>` | Import parent canon for spinoff writing |
| `inkos import chapters [id] --from <path>` | Import existing chapters for continuation (`--split`, `--resume-from`) |
| `inkos analytics [id]` | Book analytics (audit pass rate, top issues, chapter ranking) |
| `inkos update` | Update to latest version |
| `inkos up / down` | Start/stop daemon |

`[id]` is auto-detected when the project has only one book. All commands support `--json` for structured output. `draft`/`write next`/`book create` support `--context` for writing guidance and `--words` to override per-chapter word count (OpenClaw can dynamically control this per chapter).

## Key Features

### State Snapshots + Chapter Rewrite

Every chapter automatically creates a state snapshot. Use `inkos write rewrite <id> <n>` to roll back and regenerate any chapter — world state, resource ledger, and plot hooks all restore to the pre-chapter state.

### Write Lock

File-based locking prevents concurrent writes to the same book.

### Pre-Write Checklist + Post-Write Settlement

The Writer agent outputs a pre-write checklist before writing (context scope, current resources, pending hooks, conflict overview, risk scan), and a settlement table after writing (resource changes, hook changes). The Auditor cross-validates the settlement table against prose content.

### Pluggable Radar

Radar data sources are pluggable via the `RadarSource` interface. Built-in sources for Tomato Novel and Qidian. Custom data sources or skipping radar entirely are both supported.

### Daemon Mode

`inkos up` starts an autonomous background loop that writes chapters on a schedule. The pipeline runs fully unattended for non-critical issues, but pauses for human review when the auditor flags problems it cannot auto-fix.

### Notifications

Telegram, Feishu, WeCom, and Webhook. In daemon mode, get notified on your phone when a chapter is done or an audit fails. Webhook supports HMAC-SHA256 signing and event filtering.

### External Agent Integration

Atomic commands + `--json` output make InkOS callable by OpenClaw and other AI agents. OpenClaw executes `inkos draft`/`audit`/`revise` via `exec`, reads JSON results, and decides next steps.

## Architecture

```
inkos/
├── packages/
│   ├── core/              # Agent runtime, pipeline, state management
│   │   ├── agents/        # architect, writer, continuity, reviser, radar, ai-tells, post-write-validator, sensitive-words, detector, style-analyzer
│   │   ├── pipeline/      # runner, agent (tool-use), scheduler, detection-runner
│   │   ├── state/         # File-based state manager (7 truth files + snapshots)
│   │   ├── llm/           # OpenAI + Anthropic dual SDK (streaming)
│   │   ├── notify/        # Telegram, Feishu, WeCom, Webhook
│   │   └── models/        # Zod schema validation
│   └── cli/               # Commander.js CLI (22 commands)
│       └── commands/      # init, book, write, draft, audit, revise, agent, review, detect, style...
└── (planned) studio/      # Web UI for review and editing
```

TypeScript monorepo managed with pnpm workspaces.

## Roadmap

- [x] Full pipeline (radar → architect → writer → auditor → reviser)
- [x] Canonical truth files + continuity audit
- [x] Built-in writing rule system
- [x] Full CLI (22 commands)
- [x] State snapshots + chapter rewrite
- [x] Daemon mode
- [x] Notifications (Telegram / Feishu / WeCom)
- [x] Atomic commands + JSON output (draft / audit / revise)
- [x] Natural language agent mode (tool-use orchestration)
- [x] Pluggable radar (RadarSource interface)
- [x] External agent integration (OpenClaw, etc.)
- [x] Genre customization + per-book rules (genre CLI + book_rules.md)
- [x] 33-dimension continuity audit (including AI-tell detection + spinoff dims + outline adherence)
- [x] De-AI-ification rules + style fingerprint injection
- [x] Spinoff writing (canon import + 4 audit dimensions + info boundary control)
- [x] Style cloning (statistical fingerprint + LLM style guide + Writer injection)
- [x] Post-write validator (11 hard rules + auto spot-fix)
- [x] Audit-revise loop hardening (AI marker guard + temperature lock)
- [x] Multi-LLM provider (OpenAI + Anthropic + compatible endpoints)
- [x] AIGC detection + anti-detect rewrite pipeline
- [x] Webhook notifications + smart scheduler (quality gates)
- [x] Cross-chapter coherence (chapter summaries + subplot/emotion/character matrices)
- [x] Continuation writing (import chapters + auto reverse-engineer truth files + resumable import)
- [x] Multi-provider agent routing (different agents use different API endpoints and keys, `inkos config set-model --base-url --provider`)
- [x] Analytics (`inkos analytics`: audit pass rate, top issues, chapter ranking)
- [ ] `packages/studio` Web UI for review and editing (Vite + React + Hono)
- [ ] Cost tracking + runtime dashboard (per-chapter token usage, API cost, audit rounds, `inkos stats`)
- [ ] EPUB export (`inkos export --format epub`, read on phone/Kindle)
- [ ] Partial chapter intervention (rewrite half a chapter + cascade truth file updates)
- [ ] Empty chapter / truncation fix (local model parsing tolerance + timeout reconnection)
- [ ] Custom agent plugin system
- [ ] Platform-specific export (Qidian, Tomato, etc.)

## Contributing

Contributions welcome. Open an issue or PR.

```bash
pnpm install
pnpm dev          # Watch mode for all packages
pnpm test         # Run tests
pnpm typecheck    # Type-check without emitting
```

## License

[MIT](LICENSE)
