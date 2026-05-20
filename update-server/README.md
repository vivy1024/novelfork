# NovelFork Update Server

自动更新服务器 — 代理 GitHub Releases API 和 exe 下载，解决中国大陆用户无法直连 GitHub 的问题。

## API

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /api/releases/latest?channel=stable&platform=windows-x64` | 获取最新版本 |
| `GET /api/releases?channel=stable&limit=5` | 版本列表 |
| `GET /api/download/:version/:filename` | 代理下载 exe |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `8080` |
| `GITHUB_TOKEN` | GitHub API Token（可选，提高 rate limit） | — |

## 部署

部署在 Zeabur 北京项目，域名 `novelfork-update.vivy1024.cc`。

Zeabur 部署时指定 Root Directory 为 `update-server/`。

```bash
# 本地开发
cd update-server
bun install
bun run dev

# 生产
bun run start
```

## 架构

```
[NovelFork exe] → GET /api/releases/latest → [本服务] → GitHub Releases API
                                                          ↓ 缓存 5 分钟
[NovelFork exe] → GET /api/download/1.0.6/novelfork-v1.0.6-windows-x64.exe
                                                          ↓ 流式代理
                                              GitHub Release Asset CDN
```
