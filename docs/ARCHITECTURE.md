# 架构说明（ARCHITECTURE）

本文说明 `dsh-workspace-prompt` 的分层、模块职责、依赖方向与扩展点用法。需求上下文见 `PLAN.md`，逐函数契约见 `CONTRACTS.md`。

## 1. 分层

```
入口层
  index.js            Host 入口：只做组装、依赖注入、effect 注册
  client.js           Client 入口：chunk 加载、locale 注册、settings.section 注册

Host 业务层（host/）
  prompt-service.js   业务门面：唯一实现所有操作（list/catalog/apply/read/save/enable + 注入只读查询）
  api-routes.js       薄路由：解析 HTTP → 调 service → 序列化；不写业务规则
  injection.js        systemPrompt.context 定义 + 同步求值；异常兜底
  added-workspaces-store.js / enabled-flags-store.js / prompt-file-store.js
                      持久化：added 集合、启用开关、提示词正文
  workspace-resolver.js / json-file.js / data-directories.js
                      基础能力：路径匹配、JSON 原子读写、目录解析

Client 视图层（client.*.js）
  client.app.js       页面状态机 list / manage / edit，数据加载与 notice
  client.workspace-list.js    列表视图
  client.manage-workspaces.js 批量管理视图
  client.prompt-editor.js     提示词编辑器
  client.markdown.js / client.icons.js / client.styles.js / client.api.js / client.i18n.js
                      可复用的视图能力
```

依赖方向严格单向：

```
index.js → host/*             client.js → client.* chunk
api-routes → prompt-service   client.app → 三个视图 chunk（通过 props 传入）
prompt-service → 3 stores + resolver + json-file + data-directories
injection → prompt-service（只读 resolvePromptForCwd）
client.api → fetch（宿主浏览器）
```

任何模块都不反向依赖入口，模块之间不共享可变全局（`prompt-file-store` 内部缓存属于该 store 实例；`json-file` 缓存属于该文件实例）。

## 2. 扩展点与理由

| 扩展点 | 用途 | 为什么选它 |
|---|---|---|
| `settings.section`（Client `ctx.slots.inject/register`） | 设置面板新增一页 | 官方声明的设置页插槽；shell 负责导航/弹窗，插件只提供页面内容 |
| `ctx.systemPrompt.context()` | 每次对话开始注入工作区提示词 | 框架为动态运行时上下文提供的正式注册点；每步重新求值；Chat 视图隐藏普通 context 行 |
| `ctx.connection.fetch.register()` | 浏览器半读写数据 | 复用 Connection 的鉴权与 `/api` 同源通道，不新开端口、不绕过鉴权 |
| `ctx.workspaceRegistry.list()` / `get()` | 枚举工作区 | 公开的 Host 服务；`list()` 是同步投影，适合注入热路径 |
| `ctx.locale` / `ctx.slots` | 文本与挂载 | 官方 Client 服务，跟随主题/语言 |

未使用：`system-prompt/assemble` 瀑布（过度干预）、`agent/pre-step`（强耦合）、修改宿主 DOM / 样式、读取其它插件实现。

## 3. 注入数据流

```
模型步骤开始
  → SystemPrompt.assemble({ agent, scope })
    → 本插件 context.text(assembleContext)        // 同步
      → agent.session.header.cwd
      → workspaceRegistry.list() + findWorkspaceByCwd()
      → addedStore.has(id) ? enabledStore.isEnabled(id) ? promptFileStore.readSync(fileName) : '' : ''
      → buildInjectionText(workspace.name, body)
  → assembly.contexts 带上 workspace-prompt:current
  → 框架在内容变化时把它物化为运行时上下文快照
  → Chat 视图不渲染普通 context 行（当前 DSH 的 isVisibleChatNode 行为）
```

约束：
- `text()` **必须同步**：不做网络、不做 await、不做可能长时间阻塞的 IO；文件读取带 mtime+size 缓存。
- 任何异常都被吞掉并告警（去重），返回 `''`，保证不会中断模型循环。
- 写入（保存提示词/开关）只发生在用户动作的 HTTP 路由上，不在注入路径写盘。

## 4. 状态与一致性

- `state/workspaces.json`：added 集合 + `fileName` 映射（工作区改名不搬文件）。
- `state/enabled.json`：开关集合，只记录 `true`。
- `prompt/<fileName>.md`：正文。
- 读：`stat` 的 `mtime+size` 对比缓存 → 感知其它进程（例如 web 与 desktop 同时运行）的修改。
- 写：同目录临时文件 + `rename` 原子替换；正文按文件名串行化。
- 批量变更（apply）在 `prompt-service` 内部串行化，避免并发覆盖。
- 容错：状态文件损坏 → 空集合；非法条目丢弃；`fileName` 非法/缺失 → 重新分配；不存在的 added 条目在列表时跳过（不误删磁盘文件）。

## 5. 安全

- Host：`workspaceId` 只用于在 `workspaceRegistry.list()` 中查找；文件名由 Host 生成并净化，不接受客户端传入的文件名 → 无路径穿越。
- 正文长度上限 200000 字符；批量 id 上限 1000。
- Client：Markdown 不解析原始 HTML；链接白名单协议；不使用 `dangerouslySetInnerHTML`。
- 所有 HTTP 路由在 Connection 鉴权之后，未鉴权请求由框架拒绝。

## 6. 兼容性设计（未来 DSH 版本）

1. 零第三方依赖、Host 仅 `node:` 内置模块、Client 仅平台种子 `react`；不 import 任何 `@deepseek-ai/*`（避免包 API/路径变动）。
2. `ctx.inject` 渐进接入：核心依赖（systemPrompt/workspaceRegistry）缺失时插件不激活但也不会抛错；`connection` 缺失时只保留注入能力。
3. 对运行时扩展字段（如 `assembleContext.agent`）全部判空；对服务方法做 `typeof` 检查后再调用。
4. 状态文件与 HTTP 响应都带 `version: 1`；读取端容错，为后续迁移留钩子。
5. 注入 order 从 `getContextOrder('WORKING_DIRECTORY')` 推导，取不到才用回退常量。
6. UI 只用主题令牌，不依赖宿主 DOM 结构；令牌改名最多影响外观，不会崩溃。
7. 所有业务规则集中在 Host 服务层，UI 只调用 HTTP；未来若 DSH 提供新的 Client↔Host 通道，只需替换 `client.api.js` 与 `api-routes.js`。

## 7. 已知边界

- DSH 会把运行时上下文快照写入会话日志（会话日志是唯一事实来源）。Chat 视图不显示普通 context 行，但 Trajectory/日志检查视图里可以看到提示词正文。这是 `systemPrompt.context` 机制的固有行为，文档已如实说明。
- 无浏览器自动化控制时，视觉验证以插槽注册 + jsdom 渲染测试为准，不能替代真机截图。
- 插件数据保存在包根目录（按需求路径）；若同一插件目录被 web 与 desktop 两个 profile 同时 link，两者共享提示词数据（符合"同一份工作区提示词"的预期）。
