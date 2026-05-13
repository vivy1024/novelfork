# NovelFork × 羽书 接入指南

## 接入方式

在 AstrBot 的 `data/mcp_server.json` 中添加 NovelFork MCP 服务器：

```json
{
  "mcpServers": {
    "astrbot-skill": {
      "command": "python",
      "args": ["/AstrBot/data/mcp-astrbot/server.py"]
    },
    "novelfork": {
      "command": "python",
      "args": ["D:/DESKTOP/novelfork/scripts/novelfork-mcp-server.py"]
    }
  }
}
```

## 前置条件

1. NovelFork exe 正在运行（`localhost:4567`）
2. 安装 Python 依赖：`pip install httpx`
3. 如果配置了 API Token，修改 `novelfork-mcp-server.py` 中的 `API_TOKEN`

## 可用工具

| 工具 | 用途 | 示例场景 |
|------|------|---------|
| `novelfork_search_docs` | 搜索学习中心 | 群友问"NovelFork 怎么用" |
| `novelfork_get_doc` | 获取文档全文 | 需要详细功能说明时 |
| `novelfork_list_books` | 列出作品 | 群友问"有哪些小说" |
| `novelfork_get_cockpit` | 驾驶舱快照 | 群友问"写到哪了" |
| `novelfork_send_message` | 发消息给叙述者 | 群友说"帮我续写" |
| `novelfork_list_sessions` | 列出会话 | 查看活跃叙述者 |

## 使用示例

群友：「小说写到第几章了？」

羽书调用：
```
novelfork_list_books → 获取 book_id
novelfork_get_cockpit(book_id) → 获取进度
回复：「《测试修仙小说》已写 15/200 章，今日 3200 字，还有 2 个伏笔待回收」
```

群友：「NovelFork 的经纬是什么？」

羽书调用：
```
novelfork_search_docs(query="经纬") → 找到 05-story-jingwei
novelfork_get_doc(doc_id="05-story-jingwei") → 获取全文
回复：（基于文档内容回答）
```

## 注意事项

- NovelFork 必须在本地运行，羽书通过 localhost 调用
- `novelfork_send_message` 是同步 HTTP 调用，长时间写作任务可能超时
- 如需实时流式回复，需要用 WebSocket（当前 MCP 版本暂不支持，后续可扩展）
