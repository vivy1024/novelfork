# How to Write a Novel With AI: A Step-by-Step Guide Using InkOS

*A practical walkthrough for writing long-form fiction with an open-source AI tool — from setup to finished EPUB.*

---

If you've tried writing a novel with ChatGPT, you've probably hit the same wall everyone else does: it works great for the first few chapters, then everything falls apart. Characters forget things. The plot contradicts itself. The prose starts sounding like every other AI-generated text.

The core problem is that a single chat session can't hold the state of an entire novel. Once you're past chapter 10, there's too much context for any LLM to track reliably.

InkOS is an open-source CLI tool that solves this. It uses multiple AI agents working together, each responsible for a different part of the writing process — planning, drafting, checking continuity, revising. Your novel's state is stored in structured files that persist across every chapter, so nothing gets lost.

Here's how to go from zero to finished novel.

## What You'll Need

- **Node.js 20+** (check with `node -v`)
- **An API key** from OpenAI, Anthropic, or any OpenAI-compatible provider
- **A terminal** — InkOS is a command-line tool

That's it. No subscriptions, no cloud accounts. Everything runs on your machine.

## Step 1: Install InkOS

```bash
npm i -g @actalk/inkos
```

Verify the install:

```bash
inkos --version
```

## Step 2: Configure Your LLM

Set up your API provider once, and all future projects use it automatically:

```bash
inkos config set-global \
  --lang en \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-your-key-here \
  --model gpt-4o
```

Works with OpenAI, Anthropic, or any OpenAI-compatible proxy (like OpenRouter, Together, local Ollama).

**Pro tip:** You can route different LLMs to different agents later — for example, use Claude for the Writer (better prose) and GPT-4o for the Auditor (better at catching errors). But for now, one model is fine.

## Step 3: Create Your Book

Pick a genre and create the project:

```bash
inkos book create --title "The Last Delver" --genre litrpg
```

Available genres: `litrpg`, `progression-fantasy`, `isekai`, `cultivation`, `system-apocalypse`, `dungeon-core`, `romantasy`, `sci-fi`, `tower-climber`, `cozy-fantasy`.

Each genre ships with its own pacing rules, fatigue word lists, and audit dimensions. LitRPG gets stat progression checks. Romantasy gets emotional arc tracking. You don't need to configure any of this.

**Starting from your own ideas?** Pass a creative brief:

```bash
inkos book create --title "The Last Delver" --genre litrpg --brief my-ideas.md
```

Your brief can include character sheets, world-building notes, plot outlines — anything. InkOS will build from your material instead of inventing from scratch.

## Step 4: Write Your First Chapter

```bash
inkos write next
```

This runs the full pipeline: the Planner decides what should happen, the Writer produces the prose, the Auditor checks it, and the Reviser fixes any issues. The whole process takes 2–5 minutes depending on your model and chapter length.

You'll see each stage as it runs in your terminal.

## Step 5: Review and Approve

After writing, chapters go into a review queue. You decide what ships:

```bash
inkos review list my-book       # See pending chapters
inkos review read my-book 1     # Read chapter 1
inkos review approve my-book 1  # Approve it
```

Or batch approve everything:

```bash
inkos review approve-all my-book
```

## Step 6: Keep Writing

Just keep running `inkos write next`. InkOS automatically:

- Tracks plot hooks and schedules their payoff
- Maintains character state across every chapter
- Detects and removes AI-sounding prose ("intricate", "testament", "pivotal"...)
- Keeps word count consistent with your genre's pacing

You can write 50, 100, 200+ chapters. The state management is designed for long-form work — it uses selective retrieval instead of injecting everything into context, so it doesn't slow down or break as your book grows.

## Step 7: Export

When you're done (or want to read what you have so far):

```bash
inkos export my-book --format epub
```

Read it on your phone, Kindle, or any EPUB reader.

## Going Further

**Style cloning** — Match any author's voice:
```bash
inkos style analyze reference-chapter.txt
inkos style import my-book
```

**Continuation writing** — Pick up an existing novel:
```bash
inkos book create --title "Continued" --genre litrpg
# Add existing chapters to the chapters/ folder
inkos migrate  # Auto-generates state files from existing text
inkos write next  # Continues from where you left off
```

**Daemon mode** — Write unattended with notifications:
```bash
inkos daemon start --chapters 10 --notify telegram
```

**Multi-model routing** — Use different LLMs for different tasks:
```bash
inkos config set-model writer claude-sonnet-4-20250514 --provider anthropic
inkos config set-model auditor gpt-4o --provider openai
```

## Why Not Just Use ChatGPT?

ChatGPT is great for short-form writing. For novels, you need persistent state. InkOS tracks your entire book's world state, character matrix, resources, plot hooks, emotional arcs, and chapter summaries in structured files. Every chapter is validated against this state before it's finalized.

The result: chapter 50 is as consistent as chapter 1.

**GitHub:** https://github.com/Narcooo/inkos
**Install:** `npm i -g @actalk/inkos`

---

*Tags: AI Writing, Novel Writing, Creative Writing, Open Source, LitRPG*
