# InkOS Studio Redesign — From CLI Viewer to Independent Workbench

## Purpose

Transform InkOS Studio from a read-mostly web viewer into a fully independent creative workbench that replaces the CLI entirely. Authors open their browser and never need a terminal again.

## Users

- Chinese web fiction authors writing for 番茄小说 / 起点中文网
- English web fiction authors writing for Royal Road / Kindle Unlimited / Scribble Hub
- These are two distinct user populations with different workflows, genres, platforms, and aesthetic expectations

## Success Criteria

1. Every CLI operation is achievable through Studio (via UI or Chat)
2. A new user can go from zero to first chapter without touching a terminal
3. Chinese and English authors each feel the product was built for them specifically

---

## Architecture

### Layout

```
┌──────────┬──────────────────────────────────┐
│ Sidebar  │          Main Area               │
│          │                                  │
│ 书籍列表  │   Pages: Dashboard, BookDetail,  │
│ 题材管理  │   ChapterReader, BookCreate,     │
│ 配置     │   Config, GenreManager, Daemon,   │
│ Daemon   │   TruthFiles, Analytics, Logs     │
│ 日志     │                                  │
│          ├──────────────────────────────────┤
│          │ 💬 Tell InkOS what to do...  [↑] │
└──────────┴──────────────────────────────────┘
```

- **Sidebar** (180-200px): Fixed left navigation. Book list at top, system tools at bottom. Shows active language mode (ZH/EN).
- **Main Area**: Page content fills remaining width. All 10+ pages render here.
- **Chat Bar** (bottom, default collapsed to 1 line): Always visible input. Expands upward on input to show conversation. Connects to `inkos agent` (13 built-in tools). Closes back to 1 line when idle.

### Chat Bar Behavior

- Default: single-line input with placeholder text ("告诉 InkOS 你想做什么..." / "Tell InkOS what to do...")
- On focus/input: expands to ~200px showing recent messages
- Displays real-time progress during write operations (Phase 1/2, streaming stats)
- Results update the main area (e.g., chat says "write next" → chapter appears in book detail)
- Closeable via ✕, reopens via keyboard shortcut or sidebar icon

### Chat ↔ UI Integration

Chat is not isolated — it drives the same API as button clicks:
- User types "写下一章" → POST /api/books/:id/write-next (same as clicking "Write Next")
- User types "审计第5章" → POST /api/books/:id/audit/5
- User types "帮我创建一本都市修仙" → multi-step: create book → init → navigate to book detail
- Progress and results reflect in both chat and main UI simultaneously via SSE

---

## Chinese / English Isolation

### Implementation: Language Mode

First-time setup: language selector screen before anything else. Choice persists in project config (`language` field). Switchable in settings but not casually toggled.

### What Changes Per Mode

| Aspect | Chinese Mode | English Mode |
|--------|-------------|--------------|
| UI language | All labels, buttons, breadcrumbs in Chinese | All in English |
| Genre list | 玄幻, 仙侠, 都市, 恐怖, 通用 | LitRPG, Progression, System Apocalypse, etc. |
| Default word count | 3000 字/章 | 2000 words/chapter |
| Platform options | 番茄, 起点, 飞卢 | Royal Road, KU, Scribble Hub, Other |
| AI-tell detection | Chinese fatigue words | English AI-tell word list |
| Audit dimension labels | Chinese names | English names |
| Chat placeholder | "告诉 InkOS 你想做什么..." | "Tell InkOS what to do..." |
| Typography | System sans (optimized for CJK) + Instrument Serif for headings | DM Sans + Instrument Serif |
| Example content | Chinese novel excerpts | English web fiction excerpts |
| Empty state copy | Chinese onboarding text | English onboarding text |

### What Does NOT Change

- Layout structure (same sidebar + main + chat bar)
- Color palette (Midnight Manuscript warm amber)
- API endpoints
- Core engine logic (all in @actalk/inkos-core)

---

## Pages — Full Scope

### 1. Language Selector (first-time only)

- Full-screen choice: "中文创作" / "English Writing"
- Sets project `language` field
- Never shown again (changeable in Config)

### 2. Dashboard (home)

- Recent activity feed (chapters written, audits completed)
- Book cards with status, chapter count, word count
- Daemon status indicator (running/stopped with toggle)
- Quick actions: "New Book" button
- Active writing progress (from SSE) if daemon is running

### 3. Book Detail

- Chapter list table with status badges
- Actions per chapter: read, approve, reject, audit, revise
- Book-level actions: Write Next, Draft Only, Approve All, Export
- Truth Files quick access link
- Analytics link
- Book metadata display (genre, platform, word count, language, fanfic mode)

### 4. Chapter Reader

- Full prose reading with literary typography
- Approve / Reject actions
- Navigation: previous / next chapter
- Word count display

### 5. Book Create

- Multi-step or single form:
  - Title, Genre (filtered by language mode), Platform (filtered by language mode)
  - Words per chapter, Target chapters
  - Brief file upload (optional)
  - Fanfic mode toggle (with source file upload if fanfic)
  - Spinoff parent selection (if spinoff)
- Creates book + generates foundation (async, progress in chat bar)

### 6. Config

- All settings editable inline (no CLI needed):
  - LLM: provider, baseUrl, model, temperature, maxTokens, stream, API format
  - Language: switch mode
  - Daemon: cron schedules, max concurrent, chapters per cycle, daily cap
  - Notifications: add/remove channels (telegram, feishu, wechat, webhook)
  - Multi-model routing: set model per agent (writer, auditor, reviser, architect, radar)
- Save button writes to inkos.json

### 7. Genre Manager

- List all genres (builtin + project custom)
- View genre details (rules, fatigue words, chapter types, audit dimensions)
- Copy builtin to project for customization
- Create new custom genre
- Edit project genres

### 8. Daemon Control

- Start / Stop toggle
- Status: running, stopped, paused (with reason)
- Schedule display (write cron, radar cron)
- Paused books list with resume action
- Real-time event log (from SSE)

### 9. Truth Files Browser

- Split pane: file list | content viewer
- All truth files: story_bible, volume_outline, current_state, ledger, hooks, summaries, subplots, emotional_arcs, character_matrix, style_guide, parent_canon, fanfic_canon, book_rules
- Read-only for now (editing is a future enhancement)

### 10. Analytics

- Stat cards: total chapters, total words, avg words/chapter, audit pass rate
- Status distribution chart
- Token usage (if available): total, per-chapter trend
- Top issue categories
- Chapters with most issues

### 11. Log Viewer

- Last 100 entries from inkos.log
- Color-coded by level (error=red, warn=amber, info=primary, debug=muted)
- Auto-refresh or manual refresh button
- Timestamp + level + tag + message columns

---

## API Additions Needed

Current API covers ~60% of requirements. Missing:

| Endpoint | Purpose |
|----------|---------|
| POST /api/books/:id/audit/:chapter | Trigger audit |
| POST /api/books/:id/revise/:chapter | Trigger revision |
| POST /api/books/:id/export | Export book (returns file) |
| GET/POST /api/genres | List / create genres |
| GET/PUT /api/genres/:id | View / edit genre |
| POST /api/genres/:id/copy | Copy builtin to project |
| POST /api/books/:id/import-chapters | Import chapters from uploaded file |
| POST /api/books/:id/import-canon | Import canon from parent book |
| POST /api/books/:id/style-analyze | Upload + analyze style |
| POST /api/books/:id/style-import | Import style fingerprint |
| POST /api/books/:id/detect/:chapter | AIGC detection |
| POST /api/agent | Chat endpoint — sends to inkos agent, streams response |
| PUT /api/books/:id/truth/:file | Edit truth file |
| POST /api/init | Initialize new project |
| PUT /api/project/notify | Add/remove notification channels |
| PUT /api/project/model-overrides | Set multi-model routing |

---

## Implementation Phases

### Phase 1: Layout + Chat Bar + Language Selector
- New sidebar layout replacing top nav
- Bottom chat bar component (collapse/expand)
- Chat ↔ agent API integration
- Language selector first-time flow
- Language mode throughout existing pages

### Phase 2: Config Full Edit + Genre Manager
- Config page: all settings editable
- Multi-model routing UI
- Notification channel management
- Genre manager page (list/view/copy/create)
- Corresponding API endpoints

### Phase 3: Missing Operations
- Audit / Revise triggers in Book Detail
- Export (download) action
- Import chapters (file upload)
- Import canon (parent book selection)
- Style analyze + import (file upload)
- AIGC detection trigger + results display

### Phase 4: Polish
- Responsive (tablet-friendly at minimum)
- Keyboard shortcuts
- First-time onboarding flow improvements
- coss ui component adoption for dialogs, selects, dropdowns
- Performance (lazy loading pages, code splitting)

---

## Not In Scope (this design)

- Real-time collaborative editing (multi-user)
- Mobile-first responsive design (tablet OK, phone not targeted)
- Truth file inline editing (read-only browser for now)
- Drag-and-drop chapter reordering
- Rich text chapter editor (authors write via AI, not by hand)
- Version control / diff view for truth files
- Plugin/extension system in Studio
