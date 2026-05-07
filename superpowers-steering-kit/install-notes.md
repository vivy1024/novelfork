# Install Notes

1. Install or update upstream Superpowers in the target agent harness.
2. Copy this package's `.claude/skills/*` into the target project's `.claude/skills/`.
3. If using NarraFork, copy `.narrafork/skills/*` into `.narrafork/skills/` too.
4. Copy `templates/PROJECT_PROFILE.md` to the project root and fill it in, or fold its sections into `AGENTS.md` / `CLAUDE.md`.
5. If the project uses `.kiro/steering`, create or update `templates/STEERING_INDEX.md` as a steering routing map.
6. Keep upstream Superpowers updateable; keep project facts in profile/steering.
