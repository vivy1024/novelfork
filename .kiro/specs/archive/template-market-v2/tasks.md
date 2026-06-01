# Implementation Plan

## Overview

将模板市场从 6 个固定 bundle 升级为 26 流派预制 + 用户自建 + 远程市场三层架构。

## Tasks

### Phase 1: 数据层

- [x] 1. **TemplateBundle 统一类型** — 在 `packages/core/src/presets/types.ts` 中定义 `TemplateBundle` 接口（id, name, genre, description, source, genrePrompt, toneId, beatTemplateId, jingweiTemplate, jingweiSections, sampleOpening, tags）
- [x] 2. **user_template SQLite 表** — 在 `packages/core/src/storage/schema.ts` 添加 `user_template` 表定义（id, book_id, name, genre, description, bundle_json, created_at, updated_at, deleted_at）；添加 migration
- [x] 3. **user-template repository** — 新建 `packages/core/src/storage/repositories/user-template-repo.ts`，实现 CRUD（list, get, create, update, softDelete）

### Phase 2: 26 流派内容生成

- [x] 4. **流派内容生成（批量）** — 新建 20 个流派文件 `packages/core/src/presets/genres/{genre}.md`，每个包含 200-500 字的流派写作指导 prompt。流派列表：玄幻/武侠/游戏/末日/穿越/重生/系统流/无限流/诡秘/赘婿/种田/官场/军事/体育/同人/轻小说/克苏鲁/赛博朋克/修真/灵异
- [x] 5. **Bundle 文件生成（批量）** — 新建 20 个 bundle 文件 `packages/core/src/presets/bundles/{genre}.ts`，每个导出一个 TemplateBundle 对象，包含 genrePrompt + 推荐 tone + 推荐 beat + 推荐经纬分区
- [x] 6. **注册新 bundle** — 修改 `packages/core/src/presets/bundles/index.ts` 和 `packages/core/src/presets/index.ts`，注册全部 26 个 bundle

### Phase 3: API 层

- [x] 7. **用户模板 CRUD 路由** — 修改 `packages/studio/src/api/routes/presets.ts`，添加：POST /api/presets/user-templates（创建）、PUT /api/presets/user-templates/:id（更新）、DELETE /api/presets/user-templates/:id（删除）、GET /api/presets/user-templates（列表）
- [x] 8. **远程市场代理路由** — 添加 GET /api/market/templates（代理请求 GitHub raw JSON）、POST /api/market/templates/:id/download（下载到本地 user_template 表）。超时 5s，失败返回空列表

### Phase 4: 前端

- [x] 9. **TemplateMarketPanel 重构** — 重构为三栏 Tab 展示：内置(26) / 用户自建 / 远程市场。每个 bundle 卡片显示名称、流派、描述、来源标记
- [x] 10. **用户模板创建/编辑 UI** — 添加创建模板对话框（表单：名称/流派/描述/genrePrompt textarea/tone 选择/beat 选择/经纬分区选择）；编辑复用同一表单
- [x] 11. **模板应用增强** — 应用前显示预览（将要改变什么）；支持部分应用（勾选要应用的项）
- [x] 12. **远程市场浏览 UI** — 远程 Tab 展示从 API 加载的模板列表，每个有"下载"按钮；网络不可用时显示"远程市场不可用"

### Phase 5: 验证

- [x] 13. **typecheck + build** — 全量 typecheck 通过 + vite build 成功
- [x] 14. **功能验证** — 浏览器验证：26 个内置 bundle 可见、可应用；用户可创建/编辑/删除自建模板；远程市场可浏览（如果 GitHub 可达）
