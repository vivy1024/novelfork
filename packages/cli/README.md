# @vivy1024/novelfork-cli

NovelFork 命令行工具 — 通过终端使用完整写作管线。

```bash
novelfork <command>
```

---

## 子命令

### 创作

| 命令 | 说明 |
|------|------|
| `init` | 初始化项目 |
| `book` | 书籍管理 |
| `write` | 写作（续写下一章） |
| `draft` | 草稿管理 |
| `plan` | 章节规划 |
| `compose` | 基于大纲生成正文 |
| `consolidate` | 全书整理 |

### 审校

| 命令 | 说明 |
|------|------|
| `audit` | 章节审计 |
| `review` | 审查 |
| `revise` | 修订 |
| `detect` | AI 痕迹检测 |
| `doctor` | 健康检查 |
| `analytics` | 数据分析 |

### Agent

| 命令 | 说明 |
|------|------|
| `agent` | 启动 Agent 写作管线 |
| `chat` | 通过 Studio `/api/sessions/headless-chat` 进行 headless 会话；支持 text/json/stream-json、`--session`、`--book`、`--model provider:model`、`--no-session-persistence`、`--max-turns`、`--max-budget-usd` |
| `exec` | 通过 Studio API 非交互执行 headless agent；默认保留 `/api/exec` 兼容，`--input-format stream-json`、`--output-format stream-json`、`--no-session-persistence`、`--max-turns`、`--max-budget-usd` 走 `/api/sessions/headless-chat` |

### 配置与状态

| 命令 | 说明 |
|------|------|
| `config` | 配置管理 |
| `status` | 状态查看 |
| `genre` | 题材管理 |
| `style` | 文风管理 |
| `import` | 导入章节 |
| `fanfic` | 同人设定导入 |
| `export` | 导出 |
| `eval` | 评估 |

### 运行

| 命令 | 说明 |
|------|------|
| `studio` | 启动 Studio Web 工作台 |
| `up` / `down` | 启动/停止 daemon |
| `radar` | 市场扫描 |
| `update` | 更新 |

---

## 使用

```bash
# 初始化项目
novelfork init

# 配置 AI 模型
novelfork config set-global

# 创建书籍
novelfork book create --title "仙逆" --genre xianxia

# 写一章
novelfork write --book "仙逆"

# 审计
novelfork audit --book "仙逆" --chapter 5

# 启动 Web 工作台
novelfork studio

# Headless 会话（Studio 需运行）
novelfork chat "审校第十二章" --book my-book --json

# Headless stream-json / ephemeral
novelfork chat "审校第十二章" --input-format stream-json --output-format stream-json --no-session-persistence

# 兼容旧 headless exec
novelfork exec "审校第十二章" --book my-book --json
```

---

## 构建

```bash
bun run build    # tsc → dist/
```
