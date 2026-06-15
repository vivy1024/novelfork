# 建书向导 UI 优化 — Design

**对应 Requirements**: R1-R3

---

## 设计

改动集中在 `packages/novel-plugin/src/pages/writing-workbench/NewBookGuide.tsx` 一个文件。

### 核心改动：动态问题列表

```ts
import { getGenreComplexity, type GenreComplexity } from "../../../engine/jingwei/genre-templates";

// 每个问题标记适用的最低复杂度
interface GuideQuestion {
  // ...existing fields...
  /** 最低需要的题材复杂度才展示此问题 */
  minComplexity?: GenreComplexity; // undefined = 所有档位都展示
}

// 标记 powerSystem 和 worldModel 的 minComplexity
// powerSystem: minComplexity = "heavy"
// worldModel: minComplexity = "medium"
// 其余问题: 不设 minComplexity（所有档位展示）
```

### 动态过滤逻辑

```ts
// 用户选完题材后（step 0 完成），确定 complexity
const [selectedGenre, setSelectedGenre] = useState<string>("");
const complexity = getGenreComplexity(selectedGenre);

// 动态过滤当前应展示的问题
const activeQuestions = useMemo(() => {
  return GUIDE_QUESTIONS.filter(q => {
    if (!q.minComplexity) return true;
    if (q.minComplexity === "medium") return complexity !== "light";
    if (q.minComplexity === "heavy") return complexity === "heavy";
    return true;
  });
}, [complexity]);

// 进度条用 activeQuestions.length 而非固定 total
const total = activeQuestions.length;
const question = activeQuestions[step];
```

### 题材选择触发

当用户在第 1 题（genre）选择/输入后，`setSelectedGenre(value)` 更新复杂度。后续问题列表实时变化。如果用户回退第 1 题改题材，后续问题列表重新计算（step 超出范围时 clamp）。

### 不改的部分

- 提交 API（`/api/books/:id/guided-setup`）不变
- 答案数据结构（`Record<string, { mode, value }>`）不变——被跳过的问题直接不在 answers 里
- "全部跳过"按钮不变（直接提交空 answers，后端 getGenreTemplate("") 回退 medium）

---

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `NewBookGuide.tsx` | GUIDE_QUESTIONS 加 minComplexity 标记；动态过滤逻辑；进度条用 activeQuestions.length |
| 无其他文件 | — |
