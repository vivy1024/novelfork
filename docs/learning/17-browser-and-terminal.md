---
title: 浏览器与终端
summary: Browser 截图交互、Terminal 持久化进程管理
tags: [浏览器, 终端, 截图, headless, 进程]
routes:
  - /next/narrators/:id
---

# 浏览器与终端

> Browser 截图交互、Terminal 持久化进程管理。

## Browser 工具

Agent 可通过 Browser 工具操作 headless 浏览器：

- **截图**：捕获网页当前状态的截图
- **导航**：打开指定 URL
- **交互**：点击、输入、滚动等基本操作

使用系统已安装的 Chrome 或 Edge（headless 模式），无需额外安装浏览器。

## Terminal 工具

Agent 可创建和管理持久化终端进程：

- **创建进程**：启动长时间运行的命令（如 dev server）
- **读取输出**：获取进程的 stdout/stderr
- **发送输入**：向进程 stdin 写入
- **终止进程**：停止运行中的进程

与 Bash 工具的区别：Bash 是一次性执行命令并返回结果；Terminal 是持久化进程，可持续交互。

## 推荐使用流程

1. Browser：Agent 需要验证前端渲染结果时自动调用
2. Terminal：Agent 需要启动 dev server 或监控进程时使用
3. 用户无需手动操作，Agent 按需调用

## 最佳实践

- Browser 截图用于前端 QA 验证
- Terminal 适合需要持续运行的后台服务
- 不要同时开太多 Terminal 进程，注意资源占用

## 常见坑

- **Browser 截图失败** → 系统未安装 Chrome/Edge，或路径未正确配置
- **Terminal 进程意外退出** → 检查命令是否正确，查看 stderr 输出
- **Browser 页面空白** → 目标页面需要 JavaScript 渲染，等待加载完成后再截图

## Agent 查阅提示

- Browser 工具使用 Puppeteer 协议连接系统 Chrome/Edge
- Terminal 进程通过 PTY 管理，支持 ANSI 转义序列
- Browser 截图返回 base64 图片，可直接在对话中展示
- Terminal 输出有缓冲区大小限制，超出后自动截断旧内容
- 两个工具都受沙箱模式约束

## 可跳转功能入口

- 叙述者对话: Browser 和 Terminal 工具在对话中调用。 (/next/narrators/:id)
