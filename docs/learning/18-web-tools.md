---
title: 网络工具
summary: WebSearch 搜索引擎、WebFetch 四种模式网页抓取
tags: [网络, 搜索, 抓取, WebSearch, WebFetch]
routes:
  - /next/narrators/:id
---

# 网络工具

> WebSearch 搜索引擎、WebFetch 四种模式网页抓取。

## 核心概念

**WebSearch**：Agent 可搜索互联网获取最新信息。用于查找写作参考资料、验证事实、获取灵感。

**WebFetch**：从指定 URL 获取网页内容。四种模式：

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| readability | 提取文章正文 | 博客、新闻、文档 |
| screenshot | 截图 | 需要看页面布局 |
| dom | 提取 HTML 结构 | 表格、列表等结构化数据 |
| smart | AI 摘要 | 长页面只需关键信息 |

## 推荐使用流程

1. 需要参考资料时，告诉叙述者"帮我搜索 XX 相关资料"
2. Agent 自动调用 WebSearch 获取搜索结果
3. Agent 用 WebFetch 抓取相关页面的详细内容
4. 将有用信息整合到经纬或写作上下文中

## 最佳实践

- 搜索写作参考时明确关键词，如"修仙小说 金丹期 突破描写"
- WebFetch 优先用 readability 模式，最干净
- 长页面用 smart 模式让 AI 提取关键信息，省 token

## 常见坑

- **搜索无结果** → 关键词太宽泛或网络不通，缩小搜索范围
- **WebFetch 返回空** → 目标网站需要 JavaScript 渲染，尝试 screenshot 模式
- **抓取被拒绝** → 目标网站有反爬机制，配置代理或换源

## Agent 查阅提示

- WebSearch 返回搜索结果列表（标题 + URL + 摘要）
- WebFetch 的 readability/dom/smart 模式不需要浏览器，直接 HTTP 请求
- WebFetch 的 screenshot 模式需要 Chrome/Edge（同 Browser 工具）
- 两个工具都受代理设置影响（WebFetch 代理配置）
- smart 模式可传 `purpose` 参数指导 AI 提取方向
- 输出有长度限制（默认 20000 字符），可通过 `max_length` 调整

## 可跳转功能入口

- 叙述者对话: 网络工具在对话中由 Agent 调用。 (/next/narrators/:id)
