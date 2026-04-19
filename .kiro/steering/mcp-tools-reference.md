# MCP 工具参考

## 项目内置 MCP Client

`packages/core/src/mcp/` 实现了 MCP client，供 Agent 管线调用外部工具。

### 架构

```
MCPManager → MCPClientImpl → Transport (Stdio | SSE)
```

- `MCPManager` — 管理多个 MCP server 连接
- `MCPClientImpl` — 单个 server 的 client 实例
- `StdioTransport` — 本地进程通信
- `SSETransport` — HTTP SSE 远程通信

### 在管线中的角色

Agent 可通过 `this.chatWithTools()` 调用注册的 MCP 工具。典型场景：
- 查询外部知识库
- 调用自定义验证服务
- 与其他系统集成

### 配置

MCP server 在项目配置中声明：
```json
{
  "mcp": {
    "servers": [
      {
        "name": "knowledge-base",
        "transport": "stdio",
        "command": "node",
        "args": ["./mcp-server.js"]
      }
    ]
  }
}
```

---

## 开发时 MCP 工具（与项目代码无关）

开发者在 IDE 中使用的 MCP 工具：

| 工具 | 用途 |
|------|------|
| aivectormemory | 跨会话记忆存储/检索 |
| chromedevtools | 浏览器调试 |
| github mcp | GitHub API 操作 |

这些是 IDE 层面的，不影响项目代码。

---

## 注意事项

- 项目 MCP client 代码在 `packages/core/src/mcp/`，修改时注意 protocol 兼容性
- `MCPMethods` 和 `MCPErrorCodes` 定义了协议常量
- Transport 层是可插拔的，新增 transport 实现 `MCPTransport` 接口即可
- 不要把开发时的 MCP 配置（如 aivectormemory）混入项目配置
