# InkOS P0/P1 功能实现进度

> 更新时间: 2026-04-12

## 完成清单

### P0（子代理并行完成）

| # | 功能 | 文件 | 状态 |
|---|------|------|------|
| 1 | AI 检测仪表盘 | `packages/studio/src/pages/DetectView.tsx` | 已完成 |
| 2 | 通知渠道配置页 | `packages/studio/src/pages/NotifyConfig.tsx` | 已完成 |
| 3 | 章节元数据展示 | `packages/studio/src/components/ChapterMeta.tsx` | 已完成 |
| 4 | Author Intent / Current Focus 编辑器 | `packages/studio/src/pages/IntentEditor.tsx` | 已完成 |

### P1（主线程完成）

| # | 功能 | 文件 | 状态 |
|---|------|------|------|
| 5 | Agent 管理面板 | `packages/studio/src/pages/AgentPanel.tsx` | 已完成 |
| 6 | Scheduler 高级配置 UI | `packages/studio/src/pages/SchedulerConfig.tsx` | 已完成 |
| 7 | AIGC 检测配置 | `packages/studio/src/pages/DetectionConfigView.tsx` | 已完成 |
| 8 | 伏笔健康仪表盘 | `packages/studio/src/pages/HookDashboard.tsx` | 已完成 |
| 9 | LLM 高级参数暴露 | `packages/studio/src/pages/LLMAdvancedConfig.tsx` | 已完成 |

### 集成改动

| 文件 | 改动 |
|------|------|
| `packages/studio/src/App.tsx` | +8 路由、+8 导航方法、+8 TabContent case |
| `packages/studio/src/components/Sidebar.tsx` | +6 侧边栏导航项（Agent/通知/调度/LLM/伏笔/AIGC） |
| `packages/studio/src/api/routes/storage.ts` | truth 白名单 +author_intent.md/current_focus.md；GET/PUT /project 支持 daemon/detection/llm 高级参数 |
| `packages/studio/src/pages/BookDetail.tsx` | 集成 ChapterMeta 组件 + AI 检测入口按钮（你修复） |
| `packages/studio/src/shared/contracts.ts` | ChapterDetail 类型补全元数据字段（你修复） |
| `packages/studio/src/storage/adapter.ts` | ChapterMeta 类型补全元数据字段（你修复） |

## 构建验证

- `vite build` 通过，无编译错误
- 产物: `dist/index.html` + `dist/assets/`

## 本地测试口径

当前实现需要区分两条本地路径：

1. `Web 本地调试`
   直接启动 `packages/studio` 并在浏览器访问 `http://localhost:4567` 时，仍走 Web auth gate。
   只有这条路径才需要：
   - `SESSION_SECRET`
   - `SUBAPI_SHARED_SECRET`
   - 合法的 `/?token=xxx`

2. `Tauri 桌面本地开发`
   通过 `pnpm --filter @actalk/inkos-desktop dev` 启动时，Tauri 会注入 `__TAURI_INTERNALS__`，Studio 跳过 Web auth gate，改走本地 Tauri bridge。
   这条路径下可以直接进入工作区/离线界面，本地看页面不需要先拿 Sub2API launch token。

如只是验证这 9 个新页面的渲染、导航和基础交互，优先走 Tauri 桌面本地开发。
如要验证 relay / Sub2API 登录链路，再单独走 Web 路径。

仅在 Web 路径需要 token 时，Windows 建议直接在 PowerShell 中设置环境变量后启动：

```powershell
$env:SESSION_SECRET="dev-test-secret-123"
$env:SUBAPI_SHARED_SECRET="dev-launch-secret-456"
cd packages/studio
npx tsx src/api/index.ts
```

然后用生成的 token 访问 `http://localhost:4567/?token=xxx`

Token 生成脚本（仅 Web 路径需要）：
```js
const crypto = require('crypto');
const secret = 'dev-launch-secret-456';
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  user_id: 1, email: 'dev@test.com', role: 'admin',
  iss: 'sub2api', iat: now, exp: now + 3600,
  jti: crypto.randomUUID()
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
```

## 下一步

- [ ] 本地验证所有 9 个新页面的渲染和交互
- [ ] P2 功能（MCP Server 管理、Skills 系统、可视化 Agent 编辑器、State Projections）
