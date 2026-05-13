---
title: 代理设置
summary: 配置 HTTP/SOCKS5 代理让 AI API 请求正常到达目标服务
tags: [代理, 网络, proxy]
routes:
  - /next/settings
---

# 代理设置

> 配置 HTTP/SOCKS5 代理让 AI API 请求正常到达目标服务

## 核心概念

代理用于 AI API 请求的网络出口。当本地网络无法直连 OpenAI、Anthropic 等海外 API 时，通过代理转发请求。

支持的代理协议：
- HTTP：`http://127.0.0.1:7890`
- SOCKS5：`socks5://127.0.0.1:1080`
- 带认证：`http://user:pass@proxy.com:8080`

代理仅影响 AI API 请求。如果通过 Sub2API 网关调用，代理配置的是网关的出口，而非替代网关。

## 推荐使用流程

1. 打开「设置 → 代理」tab
2. 输入代理地址（HTTP 或 SOCKS5 格式）
3. 点击「测试」验证连通性
4. 保存配置

## 最佳实践

- 国内 API（DeepSeek、智谱）不需要代理，留空即可
- 海外 API（OpenAI、Anthropic、Google）配置代理
- 使用 Sub2API 网关时，Base URL 指向网关地址，代理配置网关的出口
- 定期用测试功能验证代理可用性

## 常见坑

- 代理地址写错协议头（写成 `https://` 而非 `http://`）→ 连接失败
- 代理软件未启动但配置了地址 → 所有 AI 请求超时
- 混淆代理和 Base URL → Sub2API 网关地址应填在供应商 Base URL，不是代理字段

## Agent 查阅提示

- AI 请求超时时建议用户检查代理配置
- 部分供应商正常部分超时 → 可能需要按供应商区分代理策略
- 代理配置存储在 user-config 中，不入 Git 仓库

## 可跳转功能入口

- 设置 → 代理 tab：`/next/settings`
