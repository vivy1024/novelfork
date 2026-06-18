# 08 - 测试与质量

NovelFork 安全机制与质量保障体系。

## 安全机制概览（5 层防护）

```
┌────────────────────────────────────────────────┐
│ Layer 5: YOLO 安全反思                          │
│   高风险操作前 LLM 自我审查                      │
├────────────────────────────────────────────────┤
│ Layer 4: 密钥检测 (Secret Detector)             │
│   阻止 .env/credentials/token 文件泄露          │
├────────────────────────────────────────────────┤
│ Layer 3: 路径沙箱 (Path Sandbox)                │
│   限制文件操作在允许的目录内                      │
├────────────────────────────────────────────────┤
│ Layer 2: 引号感知状态机 (Quote-Aware Parser)     │
│   防止通过引号嵌套绕过检查                       │
├────────────────────────────────────────────────┤
│ Layer 1: 子命令拆分 (Subcommand Splitting)      │
│   将 && || ; | 分隔的复合命令拆为原子命令         │
└────────────────────────────────────────────────┘
```

## Bash 安全详解

### 子命令拆分

将用户/AI 提交的命令按分隔符拆分后逐一检查：

```
输入: "cat file.txt && rm -rf /"
拆分: ["cat file.txt", "rm -rf /"]
检查: 第二条命令触发 DANGEROUS_PATTERNS → 阻断
```

### 引号状态机

处理嵌套引号，防止注入：

```
输入: echo "hello; rm -rf /"
状态: 进入双引号 → 分号不作为分隔符 → 整体为一条 echo 命令
结果: 安全，允许执行
```

```
输入: echo hello"; rm -rf /"
状态: 引号未闭合 → 语法错误 → 阻断
```

### DANGEROUS_PATTERNS

正则匹配高危模式：

| 模式 | 拦截示例 |
|------|----------|
| `rm\s+(-rf\|--recursive)` | `rm -rf /` |
| `chmod\s+777` | `chmod 777 /etc` |
| `>(\/dev\/sd\|\/dev\/nvme)` | 写入裸设备 |
| `curl.*\|.*sh` | 管道执行远程脚本 |
| `mkfs` | 格式化文件系统 |

### commandBlocklist

完全禁止的命令（无论参数）：

```
dd, mkfs, fdisk, parted, mount, umount,
shutdown, reboot, init, systemctl,
iptables, ufw, passwd, useradd, userdel
```

## 工具循环检测（Loop Detection）

防止 Agent 陷入无限工具调用循环：

| 机制 | 阈值 | 行为 |
|------|------|------|
| 同一工具连续调用 | 5 次 | 警告 + 注入提示 |
| 同一工具连续调用 | 10 次 | 强制终止回合 |
| 总工具调用数 | 100 次/回合 | 强制终止 |
| 相同输入重复 | 3 次 | 阻断 + 报告 |

## 写作质量机制

### 对抗式审查（Adversarial Audit）

三视角独立审查，结果纯函数合成：

```
视角 A（连续性）──┐
                  ├──→ 纯函数合成 ──→ 最终报告
视角 B（叙事）──┤        (去重/合并/排序)
                  │
视角 C（文本）──┘
```

| 视角 | 维度 | 检查项示例 |
|------|------|-----------|
| A 连续性 | 37 维 | 角色位置、物品持有、时间线、称谓一致 |
| B 叙事 | 节奏/张力 | 冲突密度、情绪曲线、悬念设置 |
| C 文本 | AI 痕迹 | 重复短语、模板句式、词频异常(dim20-23) |

### 严重度门禁（Severity Gate）

| 等级 | 代号 | 自动行为 |
|------|------|----------|
| S1 | Critical | 阻断输出，必须修复后重试 |
| S2 | Major | 自动触发 ReviserAgent 定点修订 |
| S3 | Minor | 附加警告标签，不阻断 |
| S4 | Info | 静默记录，供统计分析 |

门禁位于 `novel-plugin/src/engine/agents/severity-gate.ts`

### 资源账本验算

`core/src/state/state-reducer.ts` 中：

- `applyRuntimeStateDelta()` — 应用章节状态变更
- `findKnowledgeViolations()` — 检查角色不应知道的信息
- `findTimelineConflicts()` — 检查时间线矛盾
- 资源出入匹配 — 物品/金钱/能力的获取与消耗平衡

### 动态词频检测

WriterAgent 内置词频分析（dim20-23）：
- 检测高频重复词
- 识别 AI 典型用语模式
- 生成规避提示注入下一轮生成

## 类型检查

```bash
bunx tsc --noEmit
```

全项目 strict 模式，零 `any` 容忍策略。

CI 中作为质量门禁：类型检查不通过 = 不能发版。
