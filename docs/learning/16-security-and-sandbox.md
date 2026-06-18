---
title: 安全与沙箱
summary: 三级沙箱隔离、目录白名单、命令白名单、权限模式
tags: [安全, 沙箱, 白名单, 权限, 隔离]
routes:
  - /next/settings
---

# 安全与沙箱

> 三级沙箱隔离、目录白名单、命令白名单、权限模式。

## 核心概念

**沙箱模式**（三级隔离）：

| 级别 | 说明 |
|------|------|
| none | 无隔离，Agent 可访问系统任意资源 |
| basic | 基础隔离，限制文件访问范围和命令执行 |
| strict | 严格隔离，仅允许白名单内的目录和命令 |

**目录白名单**：Agent 可读写的目录列表。strict 模式下只有白名单内的路径可访问。

**命令白名单**：Agent 可执行的 shell 命令列表。strict 模式下只有白名单内的命令可运行。

**权限模式**：
- `ask-always`：每次写入操作都需要用户确认
- `auto-approve`：低风险操作自动批准，高风险仍需确认

## Secret Detector（密钥自动脱敏）

系统内置 20+ 模式匹配规则，自动检测并脱敏敏感信息：

| 检测类型 | 示例模式 |
|----------|----------|
| API Key | `sk-...`, `key-...`, `AKIA...` |
| Token | `ghp_...`, `gho_...`, `Bearer ...` |
| 私钥 | `-----BEGIN RSA PRIVATE KEY-----` |
| 连接字符串 | `postgresql://user:pass@...` |
| 密码字段 | `password=...`, `secret=...` |
| AWS 凭证 | `AKIAIOSFODNN7EXAMPLE` |
| JWT | `eyJ...` (base64 header.payload.signature) |

**脱敏行为**：
- 工具输出中检测到的密钥替换为 `[REDACTED:key_type]`
- Agent 上下文中永远看不到原始密钥值
- 日志中同样脱敏，防止持久化泄露
- 用户可在设置中查看被脱敏的条目计数

## Path Sandbox（路径沙箱）

文件操作（read/write/edit/glob/grep）在执行前校验路径：

- **工作目录约束**：所有相对路径解析后必须在项目工作目录内
- **符号链接追踪**：resolve 后检查真实路径是否越界
- **路径穿越防御**：拦截 `../../etc/passwd` 等穿越尝试
- **绝对路径检查**：绝对路径必须在白名单目录内（basic/strict 模式）

违规时返回 `PATH_OUTSIDE_SANDBOX` 错误，不执行操作。

## DANGEROUS_PATTERNS（危险命令拦截）

24 条正则规则，在命令执行前拦截已知危险模式：

| 类别 | 示例规则 |
|------|----------|
| 系统破坏 | `rm -rf /`, `mkfs`, `dd if=` |
| Fork bomb | `:(){ :\|:& };:`, `./$0\|./$0&` |
| 关机/重启 | `shutdown`, `reboot`, `init 0` |
| 网络外传 | `curl.*\|sh`, `wget.*\|bash`（pipe-to-shell） |
| 权限提升 | `chmod 777`, `sudo su` |
| 凭证访问 | `cat ~/.ssh/id_rsa`, `cat /etc/shadow` |
| 环境篡改 | `export PATH=`, `unset PATH` |
| 批量删除 | `find . -delete`, `git clean -fdx` |

**拦截行为**：
- 匹配到危险模式时阻断执行，返回警告
- 用户可手动确认放行（ask-always 模式下）
- auto-approve 模式下危险命令仍需确认，不自动放行

## 推荐使用流程

1. 设置 → AI 代理 → 选择沙箱模式
2. basic 模式：配置工作目录范围
3. strict 模式：明确列出允许的目录和命令
4. 权限模式建议从 ask-always 开始

## 最佳实践

- 日常写作用 basic 模式即可，限制在作品目录内
- 不信任的 MCP 工具用 strict 模式隔离
- auto-approve 只在完全信任当前流程时使用

## 常见坑

- **Agent 报权限不足** → 沙箱模式过严，检查白名单是否包含需要的路径
- **命令执行被拒绝** → strict 模式下命令不在白名单中，添加到允许列表
- **切换模式后不生效** → 需要重新创建会话或重启服务

## Agent 查阅提示

- 沙箱配置在 settings store 的 sandbox 字段
- 目录白名单通过 `directoryAllowlist` 配置
- 命令白名单通过 `commandAllowlist` 配置
- 权限检查在工具执行前由 PermissionGate 拦截
- strict 模式下未列入白名单的操作直接拒绝，不弹确认门
- Secret Detector：20+ 模式自动脱敏，Agent 永远看不到原始密钥
- Path Sandbox：所有文件操作路径必须在工作目录/白名单内
- DANGEROUS_PATTERNS：24 条规则拦截危险命令，auto-approve 下仍需确认

## 可跳转功能入口

- 安全设置: 沙箱模式、白名单、权限模式配置。 (/next/settings)
