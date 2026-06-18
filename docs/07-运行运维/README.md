# 07 - 运行运维

NovelFork 运行时配置与运维参考。

## 配置文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 用户配置 | `~/.novelfork/user-config.json` | 模型/供应商/偏好 |
| 项目配置 | `项目根/novelfork.json` | 项目级规则 |
| AI 指令 | `项目根/CLAUDE.md` | Agent 系统提示词补充 |
| 规则文件 | `.novelfork/rules/*.md` | 自定义规则 |
| 数据库 | `~/.novelfork/data.db` | SQLite 主数据库 |
| 日志目录 | `~/.novelfork/logs/` | 运行日志 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `1422` | HTTP/WS 服务端口 |
| `PROMPT_DUMP` | `false` | 开启提示词导出 |
| `PROMPT_DUMP_DIR` | `./debug-prompts/` | 导出目录 |
| `LOG_LEVEL` | `info` | 日志级别（debug/info/warn/error） |
| `DB_PATH` | `~/.novelfork/data.db` | 数据库路径 |
| `DISABLE_TELEMETRY` | `false` | 禁用遥测 |

## 结构化日志格式

所有日志输出为 JSON Lines：

```json
{
  "ts": "2025-01-15T10:30:00.123Z",
  "level": "info",
  "msg": "Tool executed",
  "sessionId": "sess_abc123",
  "toolName": "jingwei.read",
  "duration_ms": 42,
  "success": true
}
```

日志级别：
- `debug` — 详细调试信息（工具输入输出、prompt 组装）
- `info` — 正常操作记录（会话创建、工具调用）
- `warn` — 非致命异常（token 超预算、降级处理）
- `error` — 错误（LLM 调用失败、工具异常）

## 常见问题排查

### 启动失败：端口被占用

```bash
# 检查端口
netstat -ano | findstr 1422
# 或修改端口
set PORT=1423
novelfork.exe
```

### LLM 调用超时

1. 检查网络连接和代理设置
2. 确认 API Key 有效
3. 查看日志中的错误详情
4. 尝试切换模型或端点

### 数据库损坏

```bash
# 备份现有数据库
cp ~/.novelfork/data.db ~/.novelfork/data.db.bak
# 删除后重启会自动创建新库
rm ~/.novelfork/data.db
```

### 编译后 exe 闪退

1. 检查 Windows Defender 是否拦截
2. 以管理员身份运行
3. 检查控制台输出（从 cmd 启动 exe 查看报错）

### 工具调用卡住

- 检查 MCP 服务器连接状态
- 查看是否有未响应的权限请求
- 取消当前生成后重试

## 上下文管理操作

| 操作 | 触发方式 | 效果 |
|------|----------|------|
| Snip | 自动（60% budget） | 裁剪早期工具结果 |
| Compact | 手动或自动（75%） | AI 摘要替换原文 |
| 清空 | 用户点击「清空」 | 删除会话消息（计划改为标记式） |
| 回滚 | 点击历史消息「回滚到此」 | 截断后续消息 |
| Fork | 点击历史消息「从此分支」 | 创建新会话，复制到此为止的消息 |

## 性能调优

| 场景 | 建议 |
|------|------|
| 响应慢 | 减少启用的工具数，降低上下文长度 |
| 内存高 | 关闭不用的 MCP 服务器 |
| 磁盘占用大 | 定期清理候选稿（rejected 状态） |
| 编译慢 | 确保 Bun 版本 >= 1.2 |

## 备份策略

重要数据全在 `~/.novelfork/`：
- `data.db` — 所有会话、书籍、设定
- `user-config.json` — 配置（含加密的 API Key）

建议定期备份此目录。
