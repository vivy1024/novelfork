v0.1.17
2026-04-16

新功能
缓冲消息队列持久化到 SQLite，服务器重启后自动恢复
实验性 Codex WebSocket 传输，自动回退 HTTP
WebSearchBlock 提取为独立组件，支持右键菜单和滑动操作
权限系统 activePermissionId 机制，修复多权限并存时 Enter 键绑定错误
修复
修复 OpenAI web_search_call 兼容性，移除上游不支持的 id 字段
修复 Codex web search：保留完整 action 对象（search/open_page/find_in_page），修正历史重建
批量删除消息块性能优化：收集后单次 revert，避免逐块重复查询
revertPatchForToolUse 补齐 status="success" 过滤，与 revertPatchesForMessages 对齐
Agent loop 中断后自动恢复缓冲消息，无需手动重发
修复 openaiProviderSchema 缺失 codexWebSocket 字段导致设置无法持久化
persistBufferedTextFiles 使用 basename() 防止路径遍历
数据库序列重写和前端插入使用事务保证原子性
改进
拖拽 ghost 使用主题变量适配亮/暗色，SplitPanel 拖拽显示叙述者标题
RecentTabs DragOverlay 支持 pinned 图标和 workspace 类型
useMemo 包裹 WS hook 返回值，减少不必要的重渲染
命令白名单支持过滤已白名单的 pipe-to-X 模式
扩展 API 类型（recentTabs/commands）、章节 review 角色、staleTime 优化
v0.1.16
2025-07-11

性能优化
前端渲染优化：memo 化高频组件，WebSocket 面板状态合并为 useReducer，懒加载重型面板（GitPanel、ContainerPanel、NarratorTerminal 等），通过 requestAnimationFrame 批量更新 React Query 缓存
减少事件监听开销：NarraFlow 统一 wheel 事件委托，套索选择按需注册鼠标/触摸监听器，useLocalPref 使用单例 storage 监听器，修复 hmr-guard 的 HMR 内存泄漏
延迟加载：BrowserSessionBar 展开时才加载列表，PathRulesPopover 和命令列表按需请求，shiki 高亮改为动态导入
修复
检测 AI 提供商空响应并显示本地化错误信息
处理 Cline/OpenAI 提供商的上下文窗口超限错误
修复 invalid_state 错误未正确标记为错误状态的问题
split-tree 改用 Math.random() 兼容 HTTP 非安全上下文
其他
升级 Vite 至 v7
移除 git 提交中的 Co-Authored-By 要求
v0.1.15
2026-04-15

新功能
Director 工作区布局上线：主次面板自适应切换，支持预览模式和更友好的触摸激活
Codex WebSocket 恢复机制增强：支持过早断连检测、静默断开处理与自动回退
优先级叙述者消息支持插队并中断当前会话，前台子代理也可立即接收
改进
OpenAI Responses 与 Codex 历史重建现在会保留消息 ID，并在裁剪时同步工具块状态
发送失败时会恢复草稿文本和附件，避免待发送内容丢失
新增 Codex 重连决策、silent_disconnect 执行链路和 Responses 历史同步测试覆盖
修复
修复 Codex WebSocket 中断处理：用户 abort 时会同步取消建连/重连流程，避免叙述者长时间卡在 thinking 状态
v0.1.14
2026-04-14

新功能
数据库清理系统：支持已归档会话、过时会话、API 请求 dump 三种清理目标，带预览和智能阻塞检测
使用历史增强：provider 自动补全、日期筛选器、token 图标化展示、移动端卡片布局
Codex WebSocket 默认启用：缓存 provider 实例、工具结果图片支持
叙述者详情面板：展示完整会话信息、工作目录编辑器、关联关系可视化
API 请求 dump 收集器：用于调试，自动脱敏敏感头，仅管理员可访问
消息角色系统：新增 sys（模型可见上下文）和 disp（仅 UI 展示）角色
命令白名单改进：bunx @biomejs/biome check 等安全命令无需批准自动放行
改进
OpenAI Responses API 支持从磁盘回放用户图片，工具结果图片展开为独立消息
Agent loop 工具调用去重，防止同一 toolUseId 重复执行
使用历史在凭证无名称时显示 credentialId 作为回退
最近标签拖拽边界修复：固定和非固定标签使用独立 DnD 上下文
提供商路由修复：多实例提供商使用不可变 provider ID
NUG 提供商 UI 简化：内联缓存显示、token 标记颜色区分
修复
修复 fork 历史与上传清理场景下继承/共享消息图片丢失的问题
修复叙述者中断后仍继续进入重试或 compact 恢复流程的问题
修复命令白名单在安全检查后仍未覆盖 CONDITIONAL_COMMANDS 的问题
修复 reasoning 块在加密内容时仍显示字符数的问题
移除 formatToolResult 高频 debug 日志以减少日志垃圾
开发者
新增 Codex provider 单元测试和 OpenAI Responses API 历史测试
角色系统变更的数据库迁移脚本，保持向后兼容
新增 53 条数据库清理翻译和 70+ 条叙述者详情翻译（中英文）
v0.1.13
2026-04-13

新功能
顺便提问：从任意消息点 fork 叙述者并立即提问，支持待定状态和实时更新
供应商管理重构：新增概览和配置视图，支持拖拽排序、启用/禁用控制和优先级排序
推理强度三级回退：叙述者设置 → 供应商设置 → 全局默认，所有层级均有 UI 控制
浏览器 Headed 模式：支持 GUI 浏览器模式，双实例池管理，启动前检测 DISPLAY 环境变量
斜杠命令模型切换：通过斜杠命令临时或永久切换模型，支持持久化恢复
改进
动态指纹计算：实现 SHA256 指纹算法，匹配 Claude Code CLI 认证机制（升级到 v2.1.88）
输出截断策略：保留最后 N 行而非前 N 行，提升 AI 上下文理解
浏览器截图安全：从 URL 查询参数改为 Blob URL，正确管理内存泄漏
推理内容处理：OpenAI Responses API 推理内容回退为纯文本，避免历史重放失败
浏览器检测：支持 Flatpak Chrome 检测，提供友好的安装提示
段落压缩消息：从 system 角色改为 user 角色，使 AI 保留压缩段落上下文
中断恢复：智能中断检测时重放工具结果包而非发送文本
NUG 供应商适配：更新到新 API 合同，quota 字段重命名，两步登录流程
依赖安装：改用交互式 PTY 终端（Modal + xterm），PROMPT_RE 收严避免进度指示误匹配
Bug 修复
供应商 Reducer Dirty 检测：修复 .sort() 原地修改 snapshot 数组导致的错误 dirty 状态
User-Agent 头：为非官方 Anthropic 端点补充缺失的 User-Agent 头
推理块顺序：修正 Responses/Codex 推理块与 web search 的顺序持久化
顺便提问插入：修复插入位置和错误状态同步
Chrome 安装错误：改进 Chrome 未安装时的错误提示
技术细节
指纹算法：SHA256(SALT + msg[4] + msg[7] + msg[20] + version)[:3]
Billing header 格式：cc_version=2.1.88.{fingerprint}; cc_entrypoint=cli; cch=9a771;
新增组件：AskInPassingCard、ProviderCard、ProviderConfigView、ProviderOverviewView、ProviderStatusBadge
新增 hooks：usePersistedState（localStorage 布尔值持久化）
新增工具函数：relativeTime（ISO 时间戳转相对时间）
新增测试：openai-provider-history.test.ts、user-preferences.test.ts
v0.1.12
2026-04-09

改进
提升 PWA maximumFileSizeToCacheInBytes 限制至 4MB 以适应不断增长的打包体积
升级测试基础设施：用 Drizzle 迁移 SQL 回放替代手写 DDL，确保测试 schema 始终与生产一致
对齐测试断言与当前生产默认值（slugify CJK 支持、默认模型名称、工具重命名、schema 校验器）
v0.1.11
2026-04-09

新功能
基于索引的权限键盘导航：从二元允许/拒绝切换重构为多按钮 ArrowLeft/Right + Enter 导航，支持 ExitPlanMode 等多操作场景；空反馈文本框中按 Enter 直接触发带反馈的拒绝
最近标签页键盘快捷键：Ctrl+Up/Down 循环切换侧边栏标签页，带防抖导航和视觉高亮预览
终端工具增强：wait_for 参数支持阻塞读取直到匹配模式出现（30s 超时），write 操作返回增量输出而非完整缓冲区，重新附加/恢复时重置游标
可配置重试退避上限（retryBackoffCeilMs）：限制瞬态 API 错误的指数退避延迟，默认 20 秒
优先发送并中断：长按发送按钮将消息插入队列最前端并中断叙述者以立即消费
Webview 面板支持：工作区分割树中可嵌入 iframe 面板，支持编辑 URL/标题和浏览器打开按钮
智能中断检查超时：15 秒后端 + 20 秒前端双层超时保护，防止摘要模型调用卡住
递归技能目录扫描：技能服务现在扫描最多 5 层深的子目录
更新弹窗 Markdown 渲染：更新日志现在支持完整 Markdown 渲染（标题、列表、代码块、链接）
修复
修复面板级 WS 订阅在列表级订阅者已持有同一叙述者 ID 引用计数时无法接收流式快照的问题；添加 fullSubscribe 标志强制服务端发送快照
修复父叙述者使用 __default__ 哨兵值时子代理模型池匹配失败的问题；现在在池比较前解析为实际默认模型
修复终端读取缓冲区因过时游标守卫在每次无新输出读取时返回完整内容的问题
修复 Shell 工具名称检测使用实际 Shell 类型而非平台检查
v0.1.10
2025-07-22

新功能
结构化评审结论：评审叙述者现在通过 ConcludeReview 工具提交结构化裁定（批准/请求修改/仅评论）和类型化发现，替代自由文本
自动注入评审反馈：评审结束时，发现结果自动作为系统消息注入源章节叙述者，带颜色编码的 ReviewFeedbackCard
合并前评审门控：新增项目设置 requireReviewBeforeMerge，未通过评审的章节将被阻止合并
分段压缩：将选定消息范围压缩为内联摘要，支持确认对话框、展开/关闭控制和失败重试
浏览器会话管理：BrowserSessionBar 组件，支持截图预览和会话生命周期事件
并行工具执行：Read、Glob、Grep、WebSearch、WebFetch 和 Bash 在相互独立时并行运行
全新 Shell 环境：新增 agent.freshShellEnv 设置，每次 Bash 执行时加载登录 Shell 配置
优先消息队列：长按发送按钮将消息插入缓冲队列最前端
子代理结论文件：explore/plan 子代理将发现写入指定的结论文件
容器事件处理器：容器启动时自动注入访问 URL 到叙述者并启用 Browser 工具
滑动 UX 增强：检测水平可滚动祖先元素、门户菜单跟手追踪、屏幕外锚点覆盖层
子代理多选：SubagentCard 块内支持 Ctrl/Cmd+点击切换和 Shift+点击范围选择
评审 diff 上下文限制为 80k 字符以防止 token 溢出，附截断提示
修复
修复合并竞态窗口：preMergeTargetSha 现在在 worktree 锁内捕获；数据库失败时执行 git 回滚，不再返回不一致的成功+警告
修复评审创建原子性：等待初始消息发送完成，失败时触发完整回滚
修复 fork 警告现在以 toast 通知展示给用户；容器启动失败时保留 containerConfig 以便手动重试
修复提供商禁用开关无效的问题 — 所有 5 种提供商类型的 Zod schema 缺少 disabled 字段
修复 OpenAI 提供商使用 codex apiMode 时未排除 WebSearch 工具的问题
修复管理页面缺少用户反馈：添加删除确认对话框，扫描/清理/重新检查失败时显示错误通知
修复叙述者错误时缓冲区保留：通过 buffer_preserved WS 事件保留排队消息，不再丢弃
修复压缩 UX：成功通知显示上下文使用百分比、分段压缩确认、隐藏消息展开
修复中键关闭标签页自动滚动、PathInputWithBrowse 模态框层叠 zIndex 及多项代码审查清理
v0.1.9
2025-07-18

新功能
流式输出块现在按时间顺序渲染 — 推理、网络搜索和文本块按实际到达顺序显示，不再按类型分组
NarraForkAdmin 代理工具：管理员可通过 AI 叙述者读写服务器设置，敏感字段自动脱敏，写操作需用户授权
用户角色管理：点击角色徽章即可提升/降级用户，带确认对话框和末位管理员保护
推理块右键菜单（桌面端右键，移动端滑动），支持复制、分叉、压缩、删除操作；支持 Ctrl/Cmd+点击和 Shift+点击多选
容器构建/启动阶段检测，启动过程中显示颜色编码的阶段徽章
容器启动失败后错误信息持久显示为可关闭的警告，构建日志保留以便排查
新增 Docker Compose 配置，支持自托管部署，使用命名卷隔离数据
修复
修复增量更新时 ZSTD_CLI_MISSING 误报问题 — 改用显式标志追踪，不再从 patch 可用性间接推断
修复未安装 rcodesign 时构建脚本崩溃的问题，添加了正确的异常处理
zstd 缺失提示中增加重试按钮，安装 zstd 后无需重新打开更新弹窗
MCP 工具卡片改用主题感知的边框样式，替代硬编码的深色背景
v0.1.8
2026-04-05

新功能
TLS 自签名证书生成：一键生成 RSA 2048 / 10 年有效期证书，自动启用 HTTPS 并重启服务器
登录页本地化错误提示：凭据错误、会话过期、用户不存在等场景显示中英文提示
WebFetch 工具支持 AbortSignal 中断，叙述者可取消正在进行的网页抓取
改进
浏览器引擎从 Playwright 迁移到 Puppeteer，统一 headless Chrome 控制方案
Anthropic 提供商三层空消息过滤，防止流式中断导致的 API 错误
Anthropic 提供商自动为纯 thinking 消息补空 text 块，兼容小米等 API
浏览器会话页面继承默认 viewport（1280x900）和 user-agent
JWT 认证区分 TOKEN_EXPIRED 和 UNAUTHORIZED，返回更精确的错误码
修复
修复浏览器 wait() 操作未正确处理 attached 状态（等价于 visible）
修复浏览器 fill() 操作使用 triple-click 在 textarea 中无法全选，改为 Ctrl+A
v0.1.7
2026-03-09

修复
修复 AI 响应流式输出过程中 block key 漂移导致 ToolCallCard 闪烁的问题
修复 NarratorPanel 每个流式帧重复渲染，提升流式渲染性能
修复创建叙述者弹窗在收藏较多时无限扩展，现在限制最大高度并支持滚动
防止 Codex 和官方 Anthropic 提供商的模型幻觉调用 WebSearch 工具（这些提供商使用原生服务端搜索）
改进
流式 block（reasoning、text、tool_use）使用稳定 React key，避免组件不必要地卸载重建
tool_use block 引用跨流式帧缓存，减少冗余重渲染
Agent 和 WebFetch 工具描述会根据是否使用原生搜索自动适配
v0.1.6
2026-04-03

新功能
NUG（Narrafork Unified Gateway）提供商集成：统一网关多提供商模型接入，含专用设置 UI 和 API 路由
收藏夹和收藏目录拖拽排序，队列消息拖拽重排
无状态提供商的 loop 内瞬态重试：API 瞬时错误自动恢复，无需重置会话
管理面板改版：独立的用户、容器、运行时和存储管理页面
设置页默认系统提示词配置及 NUG 集成
WebFetch mode 参数改为可选，默认使用 readability 模式
Providers 页面采用 reducer 模式重构，优化状态管理
修复
滑动菜单使用捕获的布局位置而非实时 rect，防止滚动时错位
推理块折叠箭头在同级消息更新时闪烁
NUGProvidersSection 未接入 providers 页面
管理面板 React 19 嵌套更新深度问题
叙述者服务外键约束处理
性能
叙述者面板流式缓存优化
LazyCollapse 初始挂载逻辑简化
消息渲染管线采用分段架构重构
其他
叙述者面板新增 interrupt checking 状态指示器
滑动菜单使用 portal 渲染，确保正确的 z-index 层级
v0.1.5
2026-04-02

新功能
Markdown 中支持 KaTeX 数学公式渲染（remark-math + rehype-katex）
自定义可重试错误规则：设置页管理、错误气泡快捷添加、agent loop 自动匹配
/skill 斜杠命令，直接注入技能内容到消息
WebFetch smart 模式新增 purpose 参数，支持目标导向的页面摘要
Skill 工具调用专用卡片，展示技能名称、内容和关联文件
Provider 启用/禁用开关（Anthropic、OpenAI、NKP），禁用后保留配置但不参与模型解析
Git clone 认证：检测认证失败后弹出凭据输入表单，支持重试
设置页 Runtime Resources 面板，扫描和清理终端、容器、浏览器进程
ForkNarrator AI 工具，支持从会话中 fork 独立叙述者
Browser 可选工具，通过 Playwright 交互式操控浏览器（启动/点击/填写/截图/执行脚本）
Storage 管理：扫描和清理储存空间（数据库、上传、共享、worktree、容器），SSE 流式扫描
文件修改范围选择器：from/to 双下拉替代时间轴点选，默认以最后一条用户消息为基线
WS 轻量同步检查（messageVersion + sync_check/sync_ok），短暂切标签页时避免全量重连
自定义模型测试按钮透传到所有 provider section
NKP 排队位置显示在思考状态指示器中
修复
僵尸叙述者中断：loop 已结束但状态仍为 thinking/waiting 时强制重置
Compact 409 冲突处理，前端显示黄色提示
Fork 快照继承：传递 forkAtMessageUuid 确保 worktree 文件状态与消息历史一致
默认模型选择器排除 default 防止自引用
Compact 重复调用时广播 compact_done 修复前端按钮无响应
容器生命周期加固：互斥锁保护并发操作、启动时状态对账、exec 流式硬超时
卷快照 apply/delete 竞态修复（snapshotDeleteLock）
更新服务器：patch chain 构建允许跨 channel 中间版本
NKP 排队位置仅在终态清除，避免与队列状态事件竞争
WS 新连接订阅时通过 streaming snapshot 发送缓存的 NKP 排队位置
性能
消息渲染：ReasoningSummary 和 ToolRunReasoningItem memo 化，页面渲染缓存从 WeakMap 迁移到字符串键 Map
BlurInOnAppear 状态更新简化，减少不必要的重渲染
其他
Puppeteer 迁移到 Playwright，浏览器模块拆分为 pool/session/actions 架构
构建时注入平台标识常量，更新服务准确检测平台
PLATFORMS 配置使用显式 platformId 字段替代字符串替换
v0.1.4
2026-03-31

新功能
NKP 队列状态显示：kiro-protocol 解析 → agent loop → WS 广播 → 前端排队位置指示器全链路
更新 UI 重构：UpdateAvailableBanner 拆分为 UpdateBadge + UpdateModal，设置页检查更新直接打开弹窗
更新服务器新增 promote 端点（beta → stable 频道切换）
性能优化
worktree watcher 迁移至 @parcel/watcher：每个 worktree 仅 1 个原生递归订阅替代 N × fs.watch()，新增事件合并器和节流发射器分层架构
NarraFlow liveStatuses 改用 useRef + tick counter 避免 Map 重建
useNarratorsListWS listener 按 narratorIds 精确过滤，拆分 user:* 全局事件
narrator-ws-manager lastMessageIds 增加 LRU 上限（100 条）防止无限增长
useContainers 轮询从 10s 降至 60s（主要依赖 WS 推送）
usePermissions 移除 3s 轮询（权限状态完全由 WS 事件驱动）
HighlightedCode 缓存上限降至 1MB，离开叙述者页面时清空
RulerFlow segment 缓存清理间隔从 60s 降至 30s，unmount 时清理全部缓存
修复
修复 React 19 下大量 BlurInAnimated 同时挂载时 "max update depth exceeded" 错误（流式推理 → 最终消息）：BlurInOnAppear 从 useLayoutEffect 改为 useEffect，ReasoningSummary 用派生状态 effectiveExpanded 替代 render-time setState
修复编译二进制启动崩溃：@parcel/watcher 原生 .node 模块现已嵌入全部 8 个平台（darwin/linux/windows × arm64/x64），运行时提取到缓存目录并通过 process.dlopen 加载
Terminal WS 健壮性：ping timeout 检测半开连接、visibility change 恢复、token 缺失优雅重试、防止重复连接
Narrator WS 恢复：重连耗尽后 tab 可见时自动重试
ToolCallCard Ctrl/Shift 点击跳过 toggle，事件冒泡到外层选择处理器
子代理模型池匹配失败时抛出明确 ValidationError 而非静默回退
TLS 配置比较修复：undefined 和 {enabled:false} 视为等价
更新服务 serverUrl 为空时回退到默认地址
修复 NarratorPanel 乐观更新 narrator status 缺少 catch 回滚
v0.1.3
2026-03-29

新功能
消息多选批量操作：通过浮动工具栏支持批量复制、删除和分叉，Ctrl/Cmd+Click 切换选中，Shift+Click 范围选中
文件修改时间线：FileSummaryTab 新增按消息查看历史文件状态，diff 端点支持 upToMessageId 过滤
WebFetch 代理配置：支持直连、系统代理、自定义代理三种模式，前后端完整集成
修复
worktree watcher 重写为手动 tree walk + 非递归 fs.watch，跳过 .git/node_modules 等目录，解决 Linux 下 inotify 过多导致 CPU 饱和问题
deleteMessageBlocks 返回 failed 计数，前端改用 invalidateQueries 替代全量回滚，确保部分失败时状态一致
useSwipeMenu tick 函数用 rAF 节流，减少 scroll/MutationObserver 高频触发时的无谓重渲染
proxy URL 增加协议前缀校验
upToMessageId 无效时返回 404
修复 Biome optional chain 警告
重构
简化 ExitPlanMode plan 解析逻辑：移除 planFile 参数，将逻辑从工具层收敛到会话层（handlePermission），execute() 中添加防御性空 plan 检查
v0.1.2
2026-03-29

新功能
容器数据卷快照：支持创建、应用、删除快照，含并发保护和路径校验
桌面端消息块多选：Ctrl/Cmd+Click 切换选中，Shift+Click 范围选中，Escape 退出多选
新增 Dockerfile 和 .dockerignore，支持容器化部署
修复
提取 TruncatedPath 公共组件，消除文件修改面板中重复的路径截断 UI
文件路径显示改为项目相对路径
修复 volume snapshot 路由中 userId 获取方式
SetupWizard 模型验证：校验 provider 可用性，防止 settings 竞态
PathInput：移除 onFocus 自动弹出下拉（onChange/useEffect 已覆盖）
settings 路由：补齐 webFetchPolicy 的 Zod 验证 schema
快照 create/apply 加 AsyncMutex 并发锁保护
apply 快照前 mkdir -p 确保目标路径存在
containerPath 校验：必须绝对路径且不含 ..
isPending loading 状态精确匹配到具体 snapshotId
重构
将 4 种 Bun --hot 热重载模式统一为 server/lib/hot-safe.ts 共享模块，提供 hotSafe、hotTimer、hotTimerClear、hotOnce 四个语义化 API
通过 hotOnce 修复 db/index.ts 中 process.on("exit") 处理器累积问题
v0.1.0
2026-03-28

新功能
侧栏可折叠，拖拽缩小到阈值自动折叠，折叠态仅显示图标和 tooltip
Tab 置顶功能，右键菜单 pin/unpin，置顶区域与普通区域拖拽隔离
模型连通性测试对话框，所有 provider 区域新增测试按钮
终端工具增量读取，基于游标避免重复内容污染 LLM 上下文
文件修改面板，支持 diff 查看、单文件恢复、权限审批预览
文件修改面板桌面侧栏模式
纯 zstd patch-from 增量更新，支持跨版本 patch chain（更新包缩小 99%+）
双语更新日志，跨版本更新时显示每个中间版本的 release notes
自重启更新系统，移除 launcher 守护进程，改为新进程杀旧进程方案
更新服务器支持 delta-only 上传，无需上传完整二进制
更新指示器从浮动 Banner 改为标题栏 Badge
设置页新增「检查更新」按钮
新增 release.ts 一键发布脚本（打标签 + 编译 + 上传）
新增 generate-changelog 技能（.claude/skills/）
修复
修复 collectLicenses 仓库 URL 解析，支持 GitHub shorthand 和 git:// 协议
新增 license.md 和 LICENSE-APACHE 文件名匹配
恢复被误删的 GET /context-thresholds 端点
稳定化 setFileModDrawerOpened 引用，修复 useMemo 失效问题
前端 prefix 校验补齐 clineProviders，与后端一致
file-state-rebuild 补充 MultiEdit 工具支持
修复硬编码英文字符串的国际化遗漏
合并 MarkdownContent.module.css 中重复的列表样式规则
修复 settings 路由 purgeRemovedProviderCaches 时序问题
性能优化
减少 useLayoutEffect 中无效 setState 调用，降低 nested-update 计数
ReasoningSummary 改用 render-time guard 和惰性初始化
streaming delta 回调中条件化 setRetryInfo
WebSocket 管理器新增 visibilitychange 监听，标签页长时间隐藏后自动重连
权限决策增加 HTTP fallback，防止 WS 断连时丢失