---
name: inkos
description: Autonomous novel writing CLI agent - use for creative fiction writing, novel generation, style imitation, chapter continuation, and AIGC detection. Supports Chinese web novel genres (xuanhuan, xianxia, urban, horror, other) with multi-agent pipeline and advanced auditing.
version: 1.0.0
metadata: { "openclaw": { "emoji": "📖", "requires": { "bins": ["inkos", "node"], "env": [] }, "primaryEnv": "", "homepage": "https://github.com/Narcooo/inkos", "install": [{ "id": "npm", "kind": "node", "package": "@actalk/inkos", "label": "Install InkOS (npm)" }] } }
---

# InkOS - Autonomous Novel Writing Agent

InkOS is a CLI tool for autonomous fiction writing powered by LLM agents. It orchestrates a 5-agent pipeline (Radar → Architect → Writer → Auditor → Reviser) to generate, audit, and revise novel content with style consistency and quality control.

## When to Use InkOS

- **Novel writing**: Create and continue writing novels/books in Chinese web novel genres
- **Batch chapter generation**: Generate multiple chapters with consistent quality
- **Style imitation**: Analyze and adopt writing styles from reference texts
- **Spinoff writing**: Write prequels/sequels/spinoffs while maintaining parent canon
- **Quality auditing**: Detect AI-generated content and perform 32-dimension quality checks
- **Genre exploration**: Explore trends and create custom genre rules

## Initial Setup

### First Time Setup
```bash
# Initialize a project directory (creates config structure)
inkos init my-writing-project

# Configure your LLM provider (OpenAI, Anthropic, or compatible)
inkos config set-global --provider openai --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o
```

### View System Status
```bash
# Check installation and configuration
inkos doctor

# View current config
inkos status
```

## Common Workflows

### Workflow 1: Create a New Novel

1. **Initialize and create book**:
   ```bash
   inkos book create --title "My Novel Title" --genre xuanhuan --chapter-words 3000
   ```
   - Genres: `xuanhuan` (cultivation), `xianxia` (immortal), `urban` (city), `horror`, `other`
   - Returns a `book-id` for all subsequent operations

2. **Generate initial chapters** (e.g., 5 chapters):
   ```bash
   inkos write next book-id --count 5 --words 3000 --context "young protagonist discovering powers"
   ```
   - The `write next` command runs the full pipeline: draft → audit → revise
   - `--context` provides guidance to the Architect and Writer agents
   - Returns JSON with chapter details and quality metrics

3. **Review and approve chapters**:
   ```bash
   inkos review list book-id
   inkos review approve-all book-id
   ```

4. **Export the book**:
   ```bash
   inkos export book-id
   ```

### Workflow 2: Continue Writing Existing Novel

1. **List your books**:
   ```bash
   inkos book list
   ```

2. **Continue from last chapter**:
   ```bash
   inkos write next book-id --count 3 --words 2500 --context "protagonist faces critical choice"
   ```
   - InkOS maintains 7 truth files (world state, character matrix, emotional arcs, etc.) for consistency
   - If only one book exists, omit `book-id` for auto-detection

3. **Review and approve**:
   ```bash
   inkos review approve-all
   ```

### Workflow 3: Style Imitation

1. **Analyze reference text**:
   ```bash
   inkos style analyze reference_text.txt
   ```
   - Examines vocabulary, sentence structure, tone, pacing

2. **Import style to your book**:
   ```bash
   inkos style import reference_text.txt book-id --name "Author Name"
   ```
   - All future chapters adopt this style profile
   - Style rules become part of the Reviser's audit criteria

### Workflow 4: Spinoff/Prequel Writing

1. **Import parent canon**:
   ```bash
   inkos import canon spinoff-book-id --from parent-book-id
   ```
   - Creates links to parent book's world state, characters, and events
   - Reviser enforces canon consistency

2. **Continue spinoff**:
   ```bash
   inkos write next spinoff-book-id --count 3 --context "alternate timeline after Chapter 20"
   ```
   - Generator respects parent canon constraints
   - All revisions maintain canon compliance

### Workflow 5: Fine-Grained Control (Draft → Audit → Revise)

If you need separate control over each pipeline stage:

1. **Generate draft only**:
   ```bash
   inkos draft book-id --words 3000 --context "protagonist escapes" --json
   ```

2. **Audit the chapter** (32-dimension quality check):
   ```bash
   inkos audit book-id chapter-1 --json
   ```
   - Returns metrics for pacing, dialogue, description, world-building, etc.

3. **Revise with specific mode**:
   ```bash
   inkos revise book-id chapter-1 --mode polish --json
   ```
   - Modes: `polish` (minor), `spot-fix` (targeted), `rewrite` (major), `rework` (structure), `anti-detect` (reduce AI traces)

### Workflow 6: Monitor Platform Trends

```bash
inkos radar scan
```
- Analyzes trending genres, tropes, and reader preferences
- Informs Architect recommendations for new books

### Workflow 7: Detect AI-Generated Content

```bash
# Detect AIGC in a specific chapter
inkos detect book-id

# Deep scan all chapters
inkos detect book-id --all
```
- Uses 11 deterministic rules (zero LLM cost) + optional LLM validation
- Returns detection confidence and problematic passages

## Advanced: Natural Language Agent Mode

For flexible, conversational requests:

```bash
inkos agent "写一部都市题材的小说，主角是一个年轻律师，第一章三千字"
```
- Agent interprets natural language and invokes appropriate commands
- Useful for complex multi-step requests

## Key Concepts

### Book ID Auto-Detection
If your project contains only one book, most commands accept `book-id` as optional. You can omit it for brevity:
```bash
# Explicit
inkos write next book-123 --count 1

# Auto-detected (if only one book exists)
inkos write next --count 1
```

### --json Flag
All content-generating commands support `--json` for structured output. Essential for programmatic use:
```bash
inkos draft book-id --words 3000 --context "guidance" --json
```

### Truth Files (Long-Term Memory)
InkOS maintains 7 files per book for coherence:
- **World State**: Maps, locations, technology levels, magic systems
- **Character Matrix**: Names, relationships, arcs, motivations
- **Resource Ledger**: In-world items, money, power levels
- **Chapter Summaries**: Events, progression, foreshadowing
- **Subplot Board**: Active and dormant subplots, hooks
- **Emotional Arcs**: Character emotional progression
- **Pending Hooks**: Unresolved cliffhangers and promises to reader

All agents reference these to maintain long-term consistency.

### Context Guidance
The `--context` parameter provides directional hints to the Writer and Architect:
```bash
inkos write next book-id --count 2 --context "protagonist discovers betrayal, must decide whether to trust mentor"
```
- Context is optional but highly recommended for narrative coherence
- Supports both English and Chinese

## Genre Management

### View Built-In Genres
```bash
inkos genre list
inkos genre show xuanhuan
```

### Create Custom Genre
```bash
inkos genre create --name "my-genre" --rules "rule1,rule2,rule3"
```

### Copy and Modify Existing Genre
```bash
inkos genre copy xuanhuan --name "dark-xuanhuan" --rules "darker tone, more violence"
```

## Command Reference Summary

| Command | Purpose | Notes |
|---------|---------|-------|
| `inkos init [name]` | Initialize project | One-time setup |
| `inkos book create` | Create new book | Returns book-id |
| `inkos book list` | List all books | Shows IDs, statuses |
| `inkos write next` | Full pipeline (draft→audit→revise) | Primary workflow command |
| `inkos draft` | Generate draft only | No auditing/revision |
| `inkos audit` | 32-dimension quality check | Standalone evaluation |
| `inkos revise` | Revise chapter | Modes: polish/spot-fix/rewrite/rework/anti-detect |
| `inkos agent` | Natural language interface | Flexible requests |
| `inkos style analyze` | Analyze reference text | Extracts style profile |
| `inkos style import` | Apply style to book | Makes style permanent |
| `inkos import canon` | Link spinoff to parent | For prequels/sequels |
| `inkos detect` | AIGC detection | Flags AI-generated passages |
| `inkos export` | Export finished book | Outputs formatted manuscript |
| `inkos radar scan` | Platform trend analysis | Informs new book ideas |
| `inkos config set-global` | Configure LLM provider | Openai/Anthropic/compatible |
| `inkos doctor` | Diagnose issues | Check installation |
| `inkos up/down` | Daemon mode | Background processing |
| `inkos review list/approve-all` | Manage chapter approvals | Quality gate |

## Error Handling

### Common Issues

**"book-id not found"**
- Verify the ID with `inkos book list`
- Ensure you're in the correct project directory

**"Provider not configured"**
- Run `inkos config set-global` with valid credentials
- Check API key and base URL with `inkos doctor`

**"Context invalid"**
- Ensure `--context` is a string (wrap in quotes if multi-word)
- Context can be in English or Chinese

**"Audit failed"**
- Check chapter for encoding issues
- Ensure chapter-words matches actual word count
- Try `inkos revise` with `--mode rewrite`

### Running Daemon Mode

For long-running operations:
```bash
# Start background daemon
inkos up

# Stop daemon
inkos down

# Daemon auto-processes queued chapters
```

## Tips for Best Results

1. **Provide rich context**: The more guidance in `--context`, the more coherent the narrative
2. **Start with style**: If imitating an author, run `inkos style import` before generation
3. **Review regularly**: Use `inkos review` to catch issues early
4. **Monitor audits**: Check `inkos audit` metrics to understand quality bottlenecks
5. **Use spinoffs strategically**: Import canon before writing prequels/sequels
6. **Batch generation**: Generate multiple chapters together (better continuity)
7. **Export frequently**: Keep backups with `inkos export`

## Support & Resources

- **Homepage**: https://github.com/Narcooo/inkos
- **Configuration**: Stored in project root after `inkos init`
- **Truth files**: Located in `.inkos/` directory per book
- **Logs**: Check output of `inkos doctor` for troubleshooting
