# Implementation Plan

## Overview

实现 Provider Runtime Control Plane v1：把现有 AI 供应商页升级为完整运行时资源控制平面，并在本轮交付中消除当前用户主界面的“后续接入/暂未接入/即将推出/UnsupportedCapability”可见入口与 raw enum/内部字段名裸露。任务来源于 `requirements.md` 和 `design.md`。

## Tasks

- [x] 1. 建立中文呈现与交互审计基线
  - 新增 app-next display label registry，覆盖 provider apiMode、compatibility、model status、platform auth/status、workflow status、runtime source、internal view labels。
  - 新增交互审计测试/工具，扫描用户主界面关键页面不得出现“后续接入”“暂未接入”“即将推出”“UnsupportedCapability”作为主功能入口。
  - 覆盖 Requirements 8、9、12。

- [x] 2. 扩展 provider runtime store 数据模型
  - 在 `ProviderRuntimeStore` 中扩展 provider advanced fields、model capabilities/recommendedUses、virtualModels、writingModelProfile。
  - 保持现有 provider/platformAccounts 兼容读取与 normalize 迁移。
  - 覆盖 Requirements 1、2、3、4、5、11。

- [x] 3. 实现 virtual model 与 writing task profile 服务
  - 新增 virtual model CRUD、校验、默认草稿生成、manual/priority/fallback/quota-aware 解析。
  - 新增 writing model profile 读取/保存/校验，并迁移 `modelDefaults.defaultSessionModel`、`summaryModel`、`subagentModelPool`。
  - 覆盖 Requirements 4、5、6、11。

- [x] 4. 扩展 provider/platform API
  - 新增 provider summary、grouped model inventory、health check、advanced patch。
  - 新增 virtual-models routes 与 writing-model-profile routes。
  - 为平台账号实现刷新配额、设为当前、停用/启用、删除，全部写入真实 store 状态。
  - 覆盖 Requirements 2、3、7、10、12。

- [x] 5. 接入运行时路由与自愈策略
  - 实现 writing task -> virtual model -> provider/model 的解析服务。
  - 接入 provider/model/account disabled、error、expired、quota-aware 降权与 fallback 原因记录。
  - 将可见重试、上下文、debug 策略限制为已有真实保存/行为路径。
  - 覆盖 Requirements 4、5、6、10。

- [x] 6. 重建 AI 供应商控制平面 UI
  - 将 `ProviderSettingsPage` 改为总览、供应商接入、模型库存、虚拟模型、写作任务绑定、运行策略六个区域。
  - 移除无真实实现的主按钮和“后续接入”占位；所有可见主操作都有真实 onClick 和成功/失败反馈。
  - 对 provider/model/account/status/source 全部使用中文 label registry。
  - 覆盖 Requirements 1、2、3、4、5、7、8、9、10。

- [x] 7. 清理现有前端主界面不可交互入口与英文裸字段
  - 修复 provider 卡片 raw `apiMode`/`compatibility`。
  - 修复 settings/workflow/workspace 中 raw status、raw strategy、internal view/editor 名称。
  - 移除或实现 URL 导入、预设管理、hooks、空态 action 等主界面死按钮；不能保留“即将推出/暂未接入”。
  - 覆盖 Requirements 8、9、12。

- [x] 8. 补齐测试并验证
  - 补充 provider runtime store、virtual model routing、writing model profile、platform account actions 单元测试。
  - 扩展 ProviderSettingsPage、SettingsSectionContent、RuntimeControlPanel、WorkflowPage、WorkspacePage 相关前端测试。
  - 运行 provider/settings/workspace/workflow 相关测试和 typecheck；记录任何未覆盖项。
  - 覆盖 Requirement 12。