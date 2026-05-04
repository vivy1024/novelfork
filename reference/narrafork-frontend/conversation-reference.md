# NarraFork 对话界面结构参考

从 /narrators/:id 页面提取。

## 整体结构

对话界面是一个 flex-column 的 Stack，占据 main 区域全宽（1030px = 1280 - 250 sidebar）。

```
Stack (flex-column, 1030x840, overflow:hidden)
├── [0] 顶部栏 (flex:0 0 auto, h:43)
│   ← 返回  会话标题  [编辑] [生成标题] [图标按钮组]
│
├── [1] 对话流 (flex:1 1 0%, h:643, overflow:hidden, position:relative)
│   消息列表 + 工具调用卡片 + 确认门
│   （内部有自己的滚动）
│
├── [2] Git 状态栏 (flex:0 0 auto, h:31)
│   🏠 novelfork · master · +101
│
├── [3] 容器状态 (flex:0 1 auto, h:0, overflow:hidden)
│   无运行中的容器 | 启动 | 配置
│   数据快照 | 创建快照
│   （默认折叠，h=0）
│
├── [4] Git 变更面板 (flex:0 1 auto, h:0, overflow:hidden)
│   变更 | 提交 | 暂存
│   文件列表
│   （默认折叠，h=0）
│
├── [5] 浏览器标签 (flex:0 0 auto, h:26)
│   🌐 浏览器 1 >
│
├── [6] 状态栏 (flex:0 0 auto, h:51)
│   思考中 4:32 | Context: 80.4% | $586.66 | 模型选择器 | 权限模式 | 图标按钮组
│
└── [7] 输入区 (flex:0 0 auto, h:46)
    📎 [输入框] [中断/发送]
```

## 关键布局特征

1. **flex-column 垂直堆叠** — 不是 grid，不是绝对定位
2. **对话流 flex:1** — 占据所有剩余空间
3. **其他区域 flex:0** — 固定高度，不伸缩
4. **折叠区域 h:0 + overflow:hidden** — 容器状态和 Git 变更默认折叠
5. **总宽度 1030px** — main 区域全宽（1280 - 250 sidebar）

## 顶部栏（h:43）

```
flex-row, justify-between
├── ← 返回按钮
├── 会话标题（可编辑）
├── ✏️ 编辑标题
├── ⚡ 生成标题
└── 图标按钮组: code-off | robot | photo | file-code | info-circle | archive
```

## 状态栏（h:51）

```
flex-row, gap
├── 思考状态 + 耗时
├── Context: 80.4%（上下文使用率）
├── $586.66（累计费用）
├── 模型选择器（下拉框）
├── 权限模式（按钮/下拉）
└── 图标按钮组: source-code | git-fork | package | settings | folder-plus | terminal | shield-off
```

## 输入区（h:46）

```
flex-row
├── 📎 附件按钮
├── 输入框（flex:1）
└── 中断按钮（红色，AI 工作中）/ 发送按钮
```

## Git 状态栏（h:31）

```
flex-row
├── 🏠 图标
├── 项目名
├── · 分支名
├── +增加行数 -删除行数
```

## 对话流内部

对话流区域（flex:1, overflow:hidden）内部有自己的滚动容器：
- 消息按时间顺序排列
- 用户消息右对齐
- AI 消息左对齐
- 工具调用卡片内联（Bash、Browser、Read、Write 等）
- 每个工具调用显示：工具名 + 耗时 + 展开/折叠
- 确认门内联显示（批准/拒绝按钮）

## 与 NovelFork 的映射

| NarraFork 区域 | NovelFork 对应 | 说明 |
|---|---|---|
| 顶部栏 | ConversationHeader | 会话标题 + 操作按钮 |
| 对话流 | ChatWindow 消息列表 | 复用现有 ChatWindow |
| Git 状态栏 | GitStatusBar | 新建 |
| 容器状态 | 不需要 | NovelFork 无容器 |
| Git 变更面板 | GitChangesView | 已有骨架 |
| 浏览器标签 | 不需要 | NovelFork 无内嵌浏览器 |
| 状态栏 | InputArea 上方 | 上下文 + 费用 + 模型 + 权限 |
| 输入区 | InputArea | 附件 + 输入框 + 发送/中断 |
