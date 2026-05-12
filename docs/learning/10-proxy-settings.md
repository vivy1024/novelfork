---
title: 代理管理与网络配置
summary: HTTP/SOCKS 代理配置、按供应商独立代理、Sub2API 网关集成
tags: [代理, 网络, proxy, Sub2API, 供应商]
routes:
  - /settings/proxy
---

# 代理管理与网络配置

> 在「设置 → 代理管理」中集中管理所有 AI 供应商和工具的网络代理配置。

---

## 为什么需要代理

NovelFork 的 AI 功能需要访问外部 API（OpenAI、Anthropic、DeepSeek 等）。在以下场景需要配置代理：

- 网络环境无法直连 AI API
- 通过 Sub2API 网关统一管理 API 调用
- 需要按供应商使用不同的出口 IP
- WebFetch 工具需要代理访问外部网页

---

## 代理类型

### AI 供应商代理

用于所有 AI API 请求的全局代理。配置后，所有供应商的请求都会走这个代理。

```
http://127.0.0.1:7890
```

### WebFetch 代理

用于 WebFetch 工具（网页抓取、HTTP 请求）的代理。独立于 AI 供应商代理。

### 按供应商独立代理

为特定供应商配置独立的代理地址。优先级高于全局代理。

适用场景：
- DeepSeek 直连（国内 API 不需要代理）
- Anthropic 走特定代理（需要美国 IP）
- 自建模型走内网（不需要代理）

---

## 配置方式

### 全局代理

1. 打开「设置 → 代理管理」
2. 在「AI 供应商」卡片中输入代理地址
3. 点击「保存」

### 按供应商配置

1. 在页面底部「添加供应商代理」区域
2. 输入供应商 ID（如 `deepseek`、`anthropic`）
3. 输入该供应商专用的代理地址
4. 点击「添加」

### 代理地址格式

```
http://127.0.0.1:7890          # HTTP 代理
socks5://127.0.0.1:1080        # SOCKS5 代理
http://user:pass@proxy.com:8080 # 带认证的代理
```

---

## Sub2API 集成

如果你使用 Sub2API 网关管理 AI API 调用：

1. Sub2API 网关地址作为供应商的 Base URL（不是代理）
2. 代理配置用于 Sub2API 网关本身的出口代理
3. 在供应商设置中将 Base URL 指向 Sub2API 地址

```
供应商 Base URL: http://your-sub2api-gateway/v1
代理地址: http://127.0.0.1:7890  (Sub2API 的出口代理)
```

---

## 状态指示

每张代理卡片右上角有状态 badge：

| 状态 | 含义 |
|------|------|
| ✓ 已配置（绿色） | 代理地址已填写 |
| ⚠ 未配置（灰色） | 代理地址为空，使用直连 |

---

## 常见问题

| 问题 | 解决 |
|------|------|
| AI 请求超时 | 检查代理是否可用，尝试直连 |
| 部分供应商正常部分不行 | 为异常供应商配置独立代理 |
| WebFetch 无法抓取网页 | 配置 WebFetch 代理 |
| 代理需要认证 | 使用 `http://user:pass@host:port` 格式 |

---

## 最佳实践

- 国内 API（DeepSeek、智谱）配置为空（直连）
- 海外 API（OpenAI、Anthropic）配置代理
- 定期检查代理可用性（在使用历史中查看错误率）
- 不要把代理地址提交到 Git（已在 user-config.json 中，不入仓库）
