# 对话界面对标 NarraFork — 待修复清单

**状态**: 🟡 Active
**创建日期**: 2026-05-10
**来源**: 浏览器截图对比 NarraFork (localhost:7778) vs NovelFork (localhost:4567)

---

## 一、对话底部区域（三行结构）

NarraFork 底部是**三行**，NovelFork 当前只有一行状态栏+Composer。

### 第 1 行：Git 状态栏
```
🏠 novelfork · master    [外部链接] [fork] [设置] [齿轮]
```
- 项目名 + 分支名
- 右侧：外部链接/fork/设置等 ActionIcon

### 第 2 行：状态行
```
🌐 浏览器 1 | ⏳ 思考中 2:09 🔄 | kiro:Opus 4.6 ▾ | ◇ 全部允许 ▾ | 📁+
```
- 浏览器标签（如果有活跃浏览器会话）
- 状态圆点 + 状态文字 + **实时计时器**（`思考中 X:XX`）+ 刷新按钮
- 模型选择：**完整名称**（`kiro:Opus 4.6`），不是首字母
- 权限选择：**完整文字**（`全部允许`），不是图标
- 推理强度/Fast Mode：仅 `apiMode === "codex"` 时显示
- 添加目录按钮

### 第 3 行：Composer
```
📎 | [发送消息... (Enter 发送, Shift+Enter 换行)] | 中断（红色文字）
```
- 📎 附件按钮
- Textarea（placeholder 含快捷键提示）
- 按钮状态：
  - working + 无输入 → **中断**（红色文字按钮，非图标）
  - idle + 无输入 + 可继续 → **继续**
  - 有输入 → **发送**

### NovelFork 当前问题
- 只有一行状态栏（圆点+空闲+Context Ring+首字母按钮）
- 模型显示首字母（`D`）而非完整名称
- 权限显示图标（🛡️）而非完整文字
- 无 Git 状态栏
- 无实时计时器
- 中断按钮是图标不是文字

---

## 二、对话顶部栏

### NarraFork
```
← 返回 | 🔗外部链接 | "novelfork" 标题 | ✏️编辑 | ✨生成标题 |    🔍 ✂️ 📌 🖼️ 📁 ⓘ 📦
```

| 图标 | 功能 |
|------|------|
| ← | 返回上一页 |
| 🔗 | 在新标签打开 |
| 标题 | 可点击编辑 |
| ✏️ | 编辑标题 |
| ✨ | AI 生成标题 |
| 🔍 | 搜索消息 |
| ✂️ | 代码折叠切换 |
| 📌 | 固定/取消固定 |
| 🖼️ | 图片附件 |
| 📁 | 文件变更面板 |
| ⓘ | 会话信息/详情 |
| 📦 | 归档会话 |

### NovelFork 当前问题
- 有标题+编辑+生成，但缺少搜索/代码折叠/固定/图片/文件/信息/归档
- 缺少返回按钮和外部链接

---

## 三、工具调用卡片

### NarraFork 样式
```
🌐 Browser   Evaluate JS in page context   ✓ 234ms   >
```
- 图标按工具类型着色（绿色=成功，蓝色=运行中，红色=失败）
- 工具名**英文原名**（Browser/Bash/Read/Write/Edit/Grep）
- 描述摘要（命令/路径/参数）
- ✓ + 耗时（右侧）
- \> 展开箭头

### NovelFork 当前状态
- ✅ 已修复：保持英文工具名
- ✅ 已有：图标着色+描述摘要+耗时+展开
- 待确认：展开后的内容格式是否对标

---

## 四、truthFile 命名重构

### 问题
InkOS 遗留的 `truthFile` / `truth-file` 概念在 30+ 文件中引用。在 NovelFork 中这些文件应该归属**经纬资料**系统，不应有独立的"真相文件"概念。

### 涉及文件
- `packages/studio/src/api/routes/storage.ts` — API 端点 `/truth-files`
- `packages/studio/src/api/lib/story-file-service.ts` — 服务层
- `packages/studio/src/app-next/backend-contract/resource-client.ts` — 前端 client
- `packages/studio/src/app-next/backend-contract/resource-tree-adapter.ts` — 资源树
- `packages/studio/src/shared/contracts.ts` — 类型定义
- `packages/core/src/runtime/process-adapter.ts` — 核心层
- 等 30+ 文件

### 方案
1. API 路径：`/truth-files` → `/jingwei-files` 或保持但前端不暴露
2. 前端显示：资源树中统一归入"经纬资料"分组（已做）
3. 变量名：逐步重命名（大工程，可分批）

---

## 五、叙事线功能问题

用户提到"叙事线功能也有很多问题"，待详述。可能包括：
- 叙事线创建/编辑流程
- 叙事线与书籍的关系
- 叙事线列表展示

---

## 六、供应商 apiMode 选择器

### 问题
供应商设置表单中 `apiMode` 硬编码为 `"responses"`（默认值），没有 UI 让用户选择。

### 需要
在供应商编辑表单中添加三选一：
- **Responses（响应）** — 默认
- **Completions（补全）**
- **Codex**

### 用户偏好
- 英文名在前，中文括号注释在后
- 默认 Responses

---

## 七、其他已修复项（本次会话）

| 问题 | 修复 | commit |
|------|------|--------|
| Bash 工具 execvpe(/bin/bash) failed | resolveShellPath() 查找 Git Bash | 5c9d451a |
| ToolCallCard 中文化 | 回退，保持英文原名 | b9d895b3 |
| 供应商默认 apiMode | completions → responses | b9d895b3 |
| 推理强度/Fast Mode 条件 | 仅 apiMode==="codex" | 56dcef4f |
| Composer 按钮状态 | 发送/中断/继续/排队 | a1b84ea8 |
| 新书引导向导不显示 | 移除 hasJingwei 条件 | 33bfcaba |
| 资源树重复 | truth files 移入经纬分组 | 33bfcaba |
| 文件夹选择器 | showDirectoryPicker() | 33bfcaba |
| 资源树宽度 | w-56→w-64 | 33bfcaba |
| PWA 缓存问题 | 禁用 VitePWA + 清除 SW 目录 | df055d42 |

---

## 执行优先级

1. **对话底部栏重做**（三行结构）— 影响最大
2. **模型/权限显示改为完整文字** — 用户体验
3. **实时计时器** — 用户体验
4. **顶部栏补全功能** — 功能完整性
5. **truthFile 重命名** — 架构债务
6. **供应商 apiMode 选择器** — 功能完整性
7. **叙事线问题** — 待用户详述
