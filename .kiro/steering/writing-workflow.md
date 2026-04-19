# 写作流程规范

## 书籍初始化

```bash
novelfork init <book-id>
```

生成 `books/<id>/` 目录结构：
```
books/<id>/
├── book.json          # BookConfig（title、genre、platform、language、wordsPerChapter）
├── story/
│   ├── author_intent.md      # 用户手写：创作意图、核心卖点
│   ├── current_focus.md      # 用户手写：当前阶段焦点
│   ├── story_bible.md        # Architect 生成
│   ├── volume_outline.md     # Architect 生成
│   ├── book_rules.md         # Architect 生成
│   ├── current_state.md      # 自动维护
│   ├── particle_ledger.md    # 自动维护（数值题材）
│   ├── pending_hooks.md      # 自动维护
│   ├── chapter_summaries.md  # 自动追加
│   └── runtime/              # 每章中间产物
└── chapters/
    ├── 001.md
    ├── 002.md
    └── ...
```

---

## 关键用户文件

### author_intent.md

告诉 AI "这本书要写什么"：
- 核心卖点（金手指、主角特质）
- 目标读者
- 参考作品
- 禁止出现的元素

### current_focus.md

告诉 AI "现阶段重点"：
- 当前卷的核心冲突
- 近 5 章要推进的事件
- 需要铺垫的伏笔

这两个文件越具体，AI 输出质量越高。空文件 = AI 自由发挥。

---

## 写作循环

### 单章写作

```bash
novelfork write next <book-id>
```

内部流程：plan → compose → write → audit → [revise] → state update

### 批量写作

```bash
novelfork write next <book-id> --count 5
```

### 带创作指导

```bash
novelfork write next <book-id> --context "这章要写主角突破金丹期，重点描写天劫场景"
novelfork write next <book-id> --context-file ./guidance.txt
```

### 字数控制

```bash
novelfork write next <book-id> --words 4000
```

默认字数由 `book.json` 的 `wordsPerChapter` 决定。

---

## 其他操作

### 审计已有章节

```bash
novelfork audit <book-id> [chapter-number]
```

### 修订

```bash
novelfork revise <book-id> <chapter-number> --mode spot-fix
```

模式：`polish` | `rewrite` | `rework` | `anti-detect` | `spot-fix`（默认）

### 导入已有文本

```bash
novelfork import <book-id> --file ./existing-novel.txt
```

支持 `--mode continuation`（续写）或 `--mode series`（同世界观新故事）

### 风格分析

```bash
novelfork style analyze <book-id> --reference ./sample.txt
```

生成 `style_profile.json`，后续写作会参考。

### AI 检测

```bash
novelfork detect <book-id> [chapter-number]
```

需配置外部检测 API（GPTZero / Originality / Custom）。

---

## Daemon 模式

自动定时写作：

```bash
novelfork daemon start
```

配置在 `novelfork.json`：
```json
{
  "daemon": {
    "schedule": {
      "radarCron": "0 */6 * * *",
      "writeCron": "*/15 * * * *"
    },
    "maxConcurrentBooks": 3
  }
}
```

---

## Genre Profile 选择

15 个内置题材（`packages/core/genres/`）：

| 题材 | 文件 | 特殊机制 |
|------|------|---------|
| 玄幻 | `xuanhuan.md` | 战力体系、数值系统 |
| 仙侠 | `xianxia.md` | 境界体系、天劫 |
| 修真 | `cultivation.md` | 丹道、阵法 |
| 都市 | `urban.md` | 现实逻辑约束 |
| 科幻 | `sci-fi.md` | 科技树一致性 |
| LitRPG | `litrpg.md` | 数值系统、面板 |
| 系统流 | `system-apocalypse.md` | 系统面板 |
| 异世界 | `isekai.md` | 双世界设定 |
| 塔攀 | `tower-climber.md` | 层级递进 |
| 地下城 | `dungeon-core.md` | 地下城生态 |
| 进化流 | `progression.md` | 等级递进 |
| 恐怖 | `horror.md` | 氛围控制 |
| 言情奇幻 | `romantasy.md` | 感情线 |
| 日常 | `cozy.md` | 低冲突 |
| 其他 | `other.md` | 通用 |

在 `book.json` 的 `genre` 字段指定。
