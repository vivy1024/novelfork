# GitHub SEO Optimization Guide for InkOS

## 1. Repository About Section (Settings → General)

**Description (必须改，最重要的 SEO 字段):**
```
Autonomous AI novel writing CLI agent — 10-agent pipeline writes, audits, and revises novels with 33-dimension continuity tracking. LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi. OpenClaw skill.
```

**Website:**
```
https://www.npmjs.com/package/@actalk/inkos
```

## 2. Topics (点 About 右边的齿轮图标添加)

按重要性排序，全部添加：

```
ai-novel-writing
ai-writing-agent
novel-generator
autonomous-writing
litrpg
progression-fantasy
multi-agent
creative-writing
ai-fiction
openclaw
openclaw-skill
cli
typescript
llm
ai-agent
novel-writing-tool
isekai
romantasy
epub
style-cloning
```

**为什么这些 Topics 重要：**
- GitHub Topic 页面在 Google 排名极高
- 搜索 "ai novel writing" 或 "litrpg ai" 时，有对应 topic 的 repo 会出现在搜索结果中
- "openclaw" 和 "openclaw-skill" topic 让你出现在 OpenClaw 生态搜索中
- 每个 topic 页面都是一个独立的 SEO 入口

## 3. GitHub Releases (重要！)

创建一个 v0.6.1 release，标题和内容要包含关键词：

**Release Title:**
```
v0.6.1 — Structured State, Hook Governance, SQLite Memory
```

**Release Body:**
```markdown
## What's New

InkOS v0.6 is a ground-up rewrite of the state management and governance layers, solving three systemic long-form AI novel writing problems:

### Structured State (JSON Delta + Zod Validation)
- Truth files moved from markdown to `story/state/*.json`
- Settler outputs JSON deltas (immutable apply + structural validation)
- Corrupted data rejected, not propagated
- Existing books auto-migrate on first run

### SQLite Temporal Memory (Node 22+)
- Relevance-based retrieval of historical facts, hooks, and chapter summaries
- Prevents context bloat after 20+ chapters (was causing 400 errors and $200/chapter API costs)

### Hook Governance
- Planner generates `hookAgenda` to schedule advancement and payoff
- `analyzeHookHealth` audits hook debt
- `evaluateHookAdmission` blocks duplicate hooks
- `mention` semantics prevents fake advancement

### Length Governance
- `LengthSpec` + Normalizer single-pass correction
- Safety net against destructive normalization
- Word count deviation reduced from 50%+ to within target band

### Pipeline Expansion: 10 Agents
Added Planner, Composer, Observer, Reflector, Normalizer to the existing Radar → Architect → Writer → Auditor → Reviser pipeline.

### Other
- Cross-chapter repetition detection
- Dialogue-driven guidance
- English variance brief
- Multi-character scene resistance
- Chapter summary dedup
- Bilingual CLI output and logging
- `INKOS_LLM_MAX_TOKENS` as global cap

## Install

\`\`\`bash
npm i -g @actalk/inkos
\`\`\`

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for details.
```

## 4. README SEO — 已优化的部分

README.en.md 的第一段是 Google 最常抓取的 snippet 来源。当前的描述已经不错：
"Open-source CLI agent that autonomously writes, audits, and revises novels"

建议在 README 最上方（badges 之后）加一行 SEO 友好的描述，包含长尾关键词：

```markdown
> The open-source AI novel writing tool that tracks continuity across 100+ chapters. 10 AI agents, 33-dimension audit, 7 truth files, style cloning, de-AI-ification. Supports LitRPG, Progression Fantasy, Isekai, and 12 more genres. Published as an [OpenClaw](https://clawhub.ai) skill.
```

## 5. 操作步骤清单

- [ ] 更新 GitHub About description（上面的文字）
- [ ] 添加所有 Topics（上面的列表）
- [ ] 创建 v0.6.1 GitHub Release（上面的内容）
- [ ] 在 README 加 SEO 描述段落
- [ ] npm publish 更新 keywords（package.json 已改好）
