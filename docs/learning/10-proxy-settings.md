---
title: 代理设置
summary: 网络代理配置，解决 API 访问受限问题
tags: [代理, 网络, 代理服务器, proxy]
routes:
  - /next/settings
---

# 代理设置

> 网络代理配置，解决 API 访问受限问题。

## 核心概念

**供应商代理**：为 AI API 请求配置 HTTP/SOCKS5 代理。当直连 API 端点受限时使用。

**WebFetch 代理**：为网页抓取工具配置代理。当目标网站有地域限制时使用。

**平台代理**：全局代理设置，影响所有出站请求。

代理配置支持：
- HTTP 代理：`http://host:port`
- SOCKS5 代理：`socks5://host:port`
- 认证代理：`http://user:pass@host:port`

## 推荐使用流程

1. 设置 → 代理 → 填写代理地址
2. 选择代理作用范围（供应商 / WebFetch / 全局）
3. 点击"测试连接"验证代理可用性
4. 保存后立即生效，无需重启

## 最佳实践

- 只为需要代理的供应商配置，不必全局开启
- SOCKS5 代理性能优于 HTTP 代理
- 代理不稳定时配置多个备用地址

## 常见坑

- **配置代理后仍然超时** → 代理服务器本身不可用，先用测试连接验证
- **部分供应商走代理部分不走** → 检查是否配置了供应商级别的代理覆盖
- **WebFetch 抓取失败** → 目标网站可能屏蔽了代理 IP

## Agent 查阅提示

- 代理配置存储在 settings store 的 proxy 字段
- 供应商级代理优先于全局代理
- LLMClient 在发起请求时读取代理配置，通过 `https-proxy-agent` 实现
- WebFetch 工具独立读取 WebFetch 代理配置

## 可跳转功能入口

- 代理设置: 网络代理配置面板。 (/next/settings)
