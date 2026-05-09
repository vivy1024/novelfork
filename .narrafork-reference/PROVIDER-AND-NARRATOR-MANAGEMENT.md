# NarraFork 供应商、权限与叙述者管理参考

> 来源：`.narrafork-reference/chunks/providers.js`、`useModels.js`、`useNarrator.js`、`NarratorPanel.js`、`status-registry.js` 深度分析
> 日期：2026-05-10

---

## 一、供应商管理

### 卡片式网格布局
- Mantine Grid 响应式：`{ base: 12, sm: 6, md: 4, lg: 3 }`
- 每张卡片：名称 + 类型 Badge + 启用 Switch + 模型预览(最多3个) + 模型计数 + 刷新按钮
- 分两区：平台供应商（kiro/codex/cline）和自定义供应商
- 顶部统计栏：总供应商数 / 已启用数 / 可见模型数/总模型数

### 添加供应商
- 入口：顶部 Menu 下拉（+ 图标）
- 4 种类型：NKP / OpenAI / Anthropic / NUG
- 选择后**立即进入配置面板**（不是先填表单再跳转）
- 通用字段：name, prefix, apiKey, baseUrl, defaultModel
- Anthropic 额外：defaultReasoningEffort, officialApi 标记

### 删除供应商
- 位置：配置面板内，名称行右侧红色垃圾桶图标
- **无确认对话框**，但是"软删除"——需要点底部"保存"才持久化
- 点"丢弃"可恢复

### 保存机制
- 底部浮动 Affix 按钮组（检测到变更时 slide-up 显示）
- "丢弃"（恢复快照）+ "保存"（一次性提交所有配置）

---

## 二、推理强度 / Fast Mode / 思考强度条件显示

### 推理强度显示条件
当前模型的 prefix 满足以下**任一**条件时显示：
1. prefix 属于 Codex 供应商集合
2. prefix 属于 Anthropic 供应商
3. 模型名包含 "deepseek" 且 prefix 属于 OpenAI 供应商

### 推理强度选项
| 条件 | 选项 |
|------|------|
| DeepSeek | none, high, xhigh |
| GPT-5.3/5.4 系列 | none, low, medium, high, xhigh |
| 其他 Codex/Anthropic | none, low, medium, high |

### Fast Mode 显示条件
**仅当** prefix 属于 Codex 供应商集合时显示。

### 思考强度
Anthropic 供应商的 `defaultReasoningEffort` 字段，在供应商配置面板中设置。

---

## 三、权限模式

### 6 种模式
| 值 | 中文 | 含义 |
|----|------|------|
| `default` | 逐项询问 | 每个操作需确认 |
| `acceptEdits` | 允许编辑 | 自动批准文件编辑 |
| `bypassPermissions` | 全部允许 | 跳过所有权限检查 |
| `readOnly` | 只读 | 禁止写操作 |
| `plan` | 规划模式 | 先计划再执行 |
| `dontAsk` | 全部拒绝 | 自动拒绝所有请求 |

### 切换调用链
```
用户点击菜单项 → mutation: updateNarratorPermissionMode(id, mode)
  → API 调用 → invalidate 缓存 → 本地状态更新
  → 下次 Agent turn 使用新 mode
```

### 附加功能
- 计划模式切换（进入/退出）
- 计划反思自动批准（仅 acceptEdits/bypassPermissions 时显示）
- 危险反思开关（仅 bypassPermissions 时显示）

---

## 四、叙述者创建

### 创建参数
```
{
  chapterId: null,           // 独立叙述者
  model?: string,            // 可选，默认跟随全局
  systemPrompt?: string,     // 可选
  permissionMode?: string,   // 可选
  reasoningEffort?: string,  // 可选
  fastMode?: boolean,        // 可选
  cwd?: string,              // 工作目录
}
```

### Modal 字段
- 工作目录（输入框 + 收藏目录列表）
- 模型（Select，含"跟随默认"）
- 以计划模式启动（开关）

### 绑定关系
- 独立叙述者：chapterId=null，自由设置 cwd
- 章节叙述者：绑定 chapter，cwd 默认为 chapter worktree
- 工作目录可后续修改

---

## 五、NovelFork 对照改造要点

| NarraFork | NovelFork 当前 | 改造 |
|-----------|---------------|------|
| 添加供应商选类型后直接进配置面板 | 先填表单再跳详情 | 已简化为名称+格式，但应改为选类型后直接进详情 |
| 删除是软删除+底部保存 | confirm() 后直接 DELETE | 可保留当前方式（更直接） |
| 推理强度按 prefix 条件显示 | 所有供应商都显示 | 需要从 status 中传递 apiMode/prefix 信息 |
| Fast Mode 仅 Codex | 所有供应商都显示 | 同上 |
| 权限切换调 API + invalidate | 切换后可能没生效 | 确认 PUT session 正确更新 |
| 创建叙述者有 Modal（cwd/model/planMode） | 无创建 UI | 需要新建 |
