# NarraFork 提供商体系参考（i18n + API 爬取 2026-05-08）

## 三种 API 请求格式

NarraFork 的 OpenAI 兼容供应商有三种 API 模式（`openaiApiMode`）：

| 模式 | 适用场景 | 特有功能 |
|------|---------|---------|
| **Completions** | GPT-4 及更老模型、国产模型（DeepSeek/Groq/Ollama） | 标准 Chat Completions API |
| **Responses** | GPT-4o 及更新模型 | OpenAI Responses API 格式 |
| **Codex** | 从 Codex 反代出来的 | 思考强度、Fast Mode、WebSocket、账号额度管理 |

## 五类提供商

### 1. Kiro（平台集成）
- 凭据管理（按账户类型分组：Free/Paid/Enterprise）
- 负载均衡（Priority/Balanced）
- 全局代理
- MCP 搜索
- 模型可用性按账户类型展示

### 2. Codex（ChatGPT 账号反代）
- **多账号管理**：用 ChatGPT 账号登录，无需 API Key
- **额度系统**：
  - 按 tier 分类：Free / Plus / Pro / Pro Lite / Team / Other
  - 额度总览：已知账号用量、缺失账号、5小时窗口/周限
  - 额度预测：下次重置时间、账号等效额度
  - 调度器：自动刷新额度
- **等级顺序**：拖拽调整 tier-balanced 模式的优先级
- **Codex 专属推理强度**：优先于全局默认值
- **Fast Mode**：`service_tier: priority`，启用优先处理层级
- **WebSocket**：使用 Responses WebSocket 而非 HTTP（实验性，自动回退）
- **ChatGPT Account ID**：作为请求头发送，用于组织订阅
- **认证方式**：浏览器 OAuth / Device Code

### 3. OpenAI 兼容（API Key）
- 供应商名称 + 前缀（用于模型 ID，如 `deepseek:model-name`）
- API 模式选择：Completions / Responses / Codex
- 获取模型列表（自动发现）
- ChatGPT Account ID（可选，Codex 模式）
- Responses WebSocket（可选，Codex 模式）

### 4. Anthropic（原生 Claude）
- 供应商名称 + 前缀
- 直接使用原生 Claude 模型
- 刷新模型列表

### 5. Cline（平台集成）
- 浏览器登录（无需 API Key）
- 余额查看
- 推荐模型
- 供应商名称 + 前缀
- 模型池搜索

### 6. NKP（Native Kiro Proxy）
- 配置 NKP 端点
- 额度查看

### 7. NUG（Narrafork Unified Gateway）
- OAuth 登录
- 多渠道健康状态
- 用量统计（按时间范围）

## Codex 特有功能详解

### 额度管理
```
GET /api/codex/quota-overview → 额度总览
GET /api/codex/status → 凭据状态（分页：available/unavailable）
POST /api/codex/credentials/:id/usage → 单账号用量
POST /api/codex/usage-queue/clear → 清空用量队列
```

### 认证
```
POST /api/codex/auth/browser → 浏览器 OAuth
POST /api/codex/auth/browser/cancel → 取消浏览器认证
POST /api/codex/auth/device/start → Device Code 开始
POST /api/codex/auth/device/poll → Device Code 轮询
POST /api/codex/auth/device/cancel → Device Code 取消
```

### 凭据管理
```
POST /api/codex/credentials/:id/disable → 禁用
POST /api/codex/credentials/:id/enable → 启用
POST /api/codex/credentials/:id/reset → 重置
DELETE /api/codex/credentials/:id → 删除
DELETE /api/codex/credentials/batch → 批量删除
PATCH /api/codex/credentials/:id → 更新
POST /api/codex/credentials/:id/refresh → 刷新
POST /api/codex/import → 批量导入（JSON/refresh_token/rt_xxxxx）
```

### 配置
```
GET /api/codex/default-reasoning-effort → 获取默认推理强度
POST /api/codex/default-reasoning-effort → 设置默认推理强度
POST /api/codex/use-websocket → 设置 WebSocket 开关
POST /api/codex/load-balancing-mode → 负载均衡模式
POST /api/codex/tier-order → 等级顺序
POST /api/codex/global-proxy → 全局代理
```

### 负载均衡模式
- **Priority（优先级）**：按顺序使用第一个可用账号
- **Balanced（均衡）**：在账号间轮询
- **Tier Balanced（等级均衡）**：按 tier 顺序，同 tier 内均衡

### 等级（Tier）
- Free → Plus → Pro Lite → Pro → Team → Other
- 拖拽调整顺序
- 优先尝试更高等级账号

## 与 NovelFork 的差距

NovelFork 当前的 ProviderSettingsPage：
- 只有基础 CRUD + 测试 + 刷新
- 没有 API 模式选择（Completions/Responses/Codex）
- 没有 Codex 多账号管理
- 没有额度系统
- 没有 Fast Mode / WebSocket
- 没有负载均衡
- 没有 tier 管理

NovelFork 通过 Sub2API 网关间接使用这些能力，但前端没有对应管理界面。
