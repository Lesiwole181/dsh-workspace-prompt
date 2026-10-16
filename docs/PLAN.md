# dsh-workspace-prompt 工程规划（施工前定稿）

> 本文件是**唯一接口契约来源**。任何模块实现与本文冲突时，以本文为准；修改本文需 Lead 同步给全部写作者。

## 1. 目标与验收标准

| 验收项 | 期望行为 |
|---|---|
| 入口 | **设置面板**里的独立一页（`settings.section`，`order: 25`）；页面列出全部工作区 |
| 编辑器形态 | 点「编辑提示词」后在**设置页内嵌**打开（第三轮改；**不再是浮层窗口**） |
| 窗口模式 | 「编辑」/「浏览」两种模式切换 |
| 编辑模式 | 可输入文本、可保存 |
| 浏览模式 | 不可输入，Markdown 渲染后浏览 |
| 存储位置 | `CreateDSHplugins/dsh-workspace-prompt/prompt/${workspace_name}.md` |
| 关闭按钮 | 窗口右上角 |
| 启用开关 | 窗口左上角；开=启用，关=不启用 |
| 注入时机 | 启用后，该工作区内**每一次对话开始**都注入工作区提示词 |
| 注入可见性 | 提示词**不作为对话气泡出现**；但它是运行时上下文的一部分，会随上下文快照落进会话日志，在 Web 端表现为一条**可展开的折叠行**（展开可见正文）。见 §2 第 9 条 |
| 注入反馈 | 弹窗提示注入结果与信息；5 秒自动关闭；右上角可手动关闭 |
| 不改本体 | `D:\deepseek-harness` 下任何文件都不被修改 |
| web + desktop | 同一份 `dsh.client.platform = "web"` 声明同时适配两者 |

## 2. 前置调研结论（已实测确认，决定架构）

1. **工作区行 “...” 菜单不可扩展。** `ui-workspace` 的 `ProjectRowItem` 把菜单写死为
   `[{id:'rename'},{id:'delete'}]`，且**未声明任何槽位**。插槽系统是"声明式"的，
   注册到未声明的槽会抛错，因此无法在不改本体的前提下向该菜单插入条目。
   **结论（已与用户确认）**：入口改用官方已声明的
   `sidebar.workspaces.session.row.action`（会话行行尾操作条，紧邻工作区行的 “...” 按钮）。

2. **官方唯一可用的侧边栏行级槽位**：`sidebar.workspaces.session.row.action`
   （`list` 类型，owner props `{ sessionId, displayTitle }`，无 hookContext、无 inject）。

3. **注入点**：`ctx.systemPrompt.context()`。它写入**系统提示词的运行时上下文**，
   不产生任何会话事件、不产生对话行 → 满足"提示词不显示在对话中"。
   `PromptContext.text` 支持 `(context) => string`，每次模型步骤重新求值 → 满足"每次对话开始都注入"。

4. **`AssembleContext` 在运行时带 `agent`。** 类型只声明 `scope`/`signal`，但
   `working-directory` 包实测使用 `context.agent.session`（见其 `src/index.ts:95`）。
   本插件用同样的防御性写法：`context.agent === undefined` 时返回空串。

5. **会话 → 工作区**：用 `context.agent.session.header.cwd` + `ctx.workspaceRegistry.resolveByPath(cwd)`。
   无需新增任何会话事件。

6. **Client → Host 通道**：`ctx.connection.fetch.register()` 注册在 `/api/*`（Connection 鉴权闸门内），
   浏览器半用同源 `fetch()` 调用即可（与 `ui-deliverables` 的用法一致）。
   `host.call()` 只属于动态 cordis runner，普通 bundle **不可用**。

7. **Client 半零构建可行**：包根 `client.js` 经 `window.__ModuleLoader__.load({id, factory})` 交付；
   包内子模块按 `client.<name>.js` 命名放在**包根**，用 `require.async('./client.<name>.js')` 加载
   （`CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`，不支持子目录）。
   因此**不需要打包器**，且能保持模块化。

8. **`dsh.client.platform` 必须为 `"web"`**：roster 只按 `=== 'web'` 收行；desktop 复用同一 Web UI。

9. **注入可见性的准确边界（第二轮修正）。** `systemPrompt.context()` 属于 *runtime context*，
   `agent-loop` 会把它作为 `user/message{source:{kind:'runtime-context'}, surfaceOp:'append'}`
   写入会话（`packages/core/agent-loop/src/agent.ts:411-440`），Web 端由
   `ContextInjectionRow` 渲染成一条**折叠行**（`packages/client/ui-chat/src/client/chat/ContextInjectionRow.tsx`）。
   → 准确表述是：**不新增对话气泡**，但**展开上下文折叠行可以看到正文**。
   早期文档写的"不写入会话日志"是错的，已更正。这是 DSH 运行时上下文的通用行为，
   `working-directory` 同样如此；插件无法在保持"进入请求"的前提下规避。

## 3. 目录结构

```
CreateDSHplugins/
├── dsh-workspace-prompt/            # 插件包（= package.json name）
│   ├── package.json                 # dsh.bundle.patch + dsh.client
│   ├── cordis.patch.yml             # Loader 补丁（1 行 Host 插件）
│   ├── index.js                     # Host 半入口（组装 host/*）
│   ├── client.js                    # Client 半入口（组装 client.*.js 子模块）
│   ├── client.settings.js           # 设置页：工作区列表 ⇄ 内嵌编辑器
│   ├── client.toast.js              # 注入结果提示条（唯一浮层）
│   ├── client.dialog.js             # 内嵌编辑器组件 WorkspacePromptEditor
│   ├── client.markdown.js           # 轻量 Markdown → React
│   ├── client.api.js                # /api 调用封装
│   ├── client.icons.js              # 内联 SVG 图标
│   ├── client.styles.js             # 样式（仅 --dsw-alias-* 令牌）
│   ├── client.store.js              # 编辑目标 + 通知队列 + 注入账本
│   ├── host/
│   │   ├── prompt-store.js          # 正文读写 + 文件名净化/去重
│   │   ├── enable-store.js          # state/enabled.json
│   │   ├── injection-registry.js    # 注入记录（供反馈）
│   │   └── api-routes.js            # /api/workspacePrompt/*
│   ├── locale/{zh,en}.json          # 显示名与说明（含 meta.title/description）
│   ├── icon.svg                     # 插件图标
│   ├── prompt/                      # 提示词正文（<workspace_name>.md）
│   ├── state/                       # enabled.json / files.json
│   └── docs/{PLAN.md,VERIFY.md}
├── env/                             # 环境安装目录（本工程零运行时依赖）
└── temp&test/                       # 临时与测试文件（收尾时清理）
```

## 4. 存储与命名规则

- 提示词目录：`config.promptDirectory` ?? `<插件包>/prompt`；环境变量 `DSH_WORKSPACE_PROMPT_DIR` 优先。
- 文件名：`${workspace_name}.md`，`workspace_name` = 工作区 `title`：
  - 净化：删除 `\ / : * ? " < > |` 与控制字符，去首尾空白与点，截断至 80 字符；
  - 去重：同标题不同工作区依次 `-2`、`-3`…；映射持久化在 `state/files.json`（key = workspaceId）；
  - 兜底：净化后为空 → 用工作区 id。
- 启用开关：`state/enabled.json`，`{ "<workspaceId>": true }`，只记录"开"的工作区。
- 全部写入用「临时文件 + rename」保证原子性；目录自动创建。

## 5. Host 半契约

### 5.1 注入

```js
ctx.systemPrompt.context({
  name: 'workspace-prompt:current',
  order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY') - 5,
  interpolate: false,
  text: (context) => {
    const agent = context.agent                      // 运行时字段，类型未声明
    if (agent === undefined) return ''
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return ''
    const ws = resolveWorkspaceSync(cwd)             // 缓存；异步 realpath 解析后回填
    if (ws === undefined) return ''
    if (!enableStore.get(ws.id)) return ''
    if (!promptStore.hasContent(ws.id, ws.title)) return ''
    const body = promptStore.read(ws.id, ws.title)   // 同步缓存 + 异步预热
    if (body.trim() === '') return ''
    registry.record({ sessionId: agent.session.id, workspaceId: ws.id, workspaceName: ws.title, characters: body.length })
    return `Workspace prompt (workspace: "${ws.title}"):\n${body}`
  },
})
```

- 解析必须是**同步**的（`text` 不支持 await）→ 用"缓存 + 预热"策略；
  缓存未命中时不注入并触发一次异步预热，下一步即命中。
- 每次求值重新读文件 mtime 缓存 → 改完提示词立即生效。

### 5.2 HTTP 路由（均在 Connection 鉴权闸门内）

所有失败返回 `{ error: { code, message } }` + 明确 HTTP 状态码。

| 路由 | 方法 | 入参 | 成功返回 |
|---|---|---|---|
| `/api/workspacePrompt/state` | GET | `sessionId` | `{ workspaceId, workspaceName, fileName, enabled, content, characters }` |
| `/api/workspacePrompt/save` | POST | `{ sessionId, content }` | `{ fileName, characters, savedAt }` |
| `/api/workspacePrompt/enable` | POST | `{ sessionId, enabled }` | `{ enabled }` |
| `/api/workspacePrompt/injection` | GET | `sessionId` | `{ seq, injected, reason, workspaceName, characters, injectedAt }` |

**定位方式**：统一用 `sessionId`（会话行天然持有）。Host 解析链：
`ctx.sessionQuery.readSurface(sessionId)` → `session.cwd`
→ `ctx.workspaceRegistry.resolveByPath(cwd)` → `{ id, title }`。

| 情况 | 状态码 | `error.code` |
|---|---|---|
| 缺 `sessionId` / `content` 类型错误 | 400 | `workspace-prompt/bad-request` |
| 会话不存在或无 cwd | 404 | `workspace-prompt/session-unresolved` |
| cwd 不属于任何工作区 | 404 | `workspace-prompt/workspace-not-found` |
| 目录不可写等 IO 失败 | 500 | `workspace-prompt/io-failed` |

失败响应体一律 `{ error: { code, message } }`，`message` 为可直接展示的中文原因。

## 6. Client 半契约

> **本节已按第二、三轮改造更新。** 第一版的"会话行行尾按钮 + 模态浮层"设计已废弃：
> 第二轮把入口迁到设置页，第三轮把编辑器改为**设置页内嵌**。

- **依赖**：`inject: ['slots', 'locale']`。
- **子模块加载**：包根 `client.js` 内 `const api = await require.async('./client.api.js')`。
  每个 `client.<name>.js` 自成模块，唯一顶层语句是
  `window.__ModuleLoader__.load({ id: '<包名>', chunk: 'client.<name>.js', factory(require){ return {...} } })`。
  ⚠ `id` 必须是**裸包名**，加载器自己拼 `<id>/<chunk>`；写成 `<包名>/<chunk>` 会重复拼接而加载失败。
- **设置页**（第三轮起为唯一入口）：注册到 `settings.section`
  （`id: 'dsh-workspace-prompt'`，`order: 25`，`label: () => t('settings.title')`）。
  owner props 只有 `{ close }`。页面内容为 `工作区列表 ⇄ 内嵌编辑器` 两种视图，用 `data-view` 标记。
  列表数据来自 `GET /workspaces`；空列表给可读提示；读失败给 `role="alert"` 原因 + 重试。
- **内嵌编辑器**（`client.dialog.js` 的 `WorkspacePromptEditor`，**已不是浮层**）：
  - 左上角：`role="switch"` + `aria-checked` 的启用开关；
  - 右上角：「← 返回工作区列表」按钮（`aria-label` 本地化）；
  - 顶部：「编辑 / 浏览」`role="tab"` 分段控件；
  - 主体：编辑= `textarea`；浏览= Markdown 渲染（无任何输入控件）；
  - 底部：保存按钮 + 状态行（读取中 / 保存中 / 已保存 / 失败原因 / 有未保存改动）；
  - **没有**遮罩、**没有** `role="dialog"`/`aria-modal`、**没有** Tab 圈闭、**没有** Escape 监听
    （这些是模态时代的产物，内嵌后必须移除——尤其 Esc，否则会误触宿主的"停止本回合"）；
  - 保留 `Ctrl/Cmd+S` 保存、无改动时保存禁用、切换目标时 abort 在途请求；
  - **未保存改动不静默**：第一次点「返回」只警告（状态行转 `warn`），第二次才离开。
- **Toast**：注册到 `shell.overlay`（`id: 'dsh-workspace-prompt.injection-toast'`，`order: 260`）。
  - 触发：轮询**无入参**的 `GET /latest`（1.5s 间隔），与"用户点过什么"**完全无关**；
    首次应答只建 baseline（游标留在 0，故本页首次真实注入仍会播报）；
    `seq > lastSeq` 且 `injected === true` 且 `injectedAt` 新鲜才播报；
    `injected !== true` **不占用 seq**（否则会吃掉后续成功注入的序号）；
  - 文案：「已注入工作区提示词 · {工作区名} · {N} 字」；
  - 5 秒自动关闭；右上角手动关闭；同一 seq 关闭后不再播报。
- **Markdown**：自研最小渲染器，支持标题、段落、粗体/斜体、行内代码、代码块、有序/无序列表、
  引用、链接、分隔线；**不使用任何外部依赖**，默认不渲染原始 HTML（防注入）。
- **样式**：只引用 `--dsw-alias-*` / `--dsw-specific-sidebar-fill` 主题令牌，类名统一前缀 `dwp-`。

## 7. 模块边界（写入者与写作用域）

| 模块 | 职责 | 不负责 |
|---|---|---|
| `host/prompt-store.js` | 文件名净化/去重、正文读写、mtime 缓存 | 开关、路由、注入 |
| `host/enable-store.js` | `enabled.json` 读写与订阅 | 正文 |
| `host/injection-registry.js` | 记录最近一次注入（按 sessionId） | 决策是否注入 |
| `host/api-routes.js` | 解析请求、调用上述三者、返回 JSON | 业务规则 |
| `index.js` | 组装 + 注册路由 + 注册 systemPrompt context | — |
| `client.*.js` | 见第 6 节 | 与 Host 直接耦合 |

## 8. 施工顺序与验证

| 步骤 | 动作 | 验证 |
|---|---|---|
| 1 | 落地本规划 | 文件存在 |
| 2 | Host 半 + 模块 | `node --check` 全通过 |
| 3 | Client 半 + 模块 | `node --check` 全通过 |
| 4 | 清单/资源/locale | 字段完整、图标合法 |
| 5 | `plugin_manager install_bundle` | `application: applied` |
| 6 | 路由实测 | 4 条路由真实调用并核对返回 |
| 7 | 注入实测 | 造会话跑 `systemPrompt.assemble`，确认注入文本与对话无新增行 |
| 8 | 槽位实况 | `Slots.listSubTree` 看到行尾按钮与 overlay 注册 |
| 9 | 收尾 | 清理 temp&test、写 VERIFY.md |

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 浏览器渲染无法由 Agent 截图验证 | 以 `Slots.listSubTree` 实况 + 路由实测为证据，报告中明确"像素级视觉未经验证" |
| `context.agent` 未在类型中声明 | 防御性判空 + 与 `working-directory` 用法保持一致 |
| `text` 回调不能 await | 同步缓存 + 异步预热，未命中时本步不注入 |
| 工作区标题含非法文件名字符 | 净化 + 去重映射 + id 兜底 |
| 会话 cwd 不在任何工作区内 | 返回 404 并给出原因，按钮提示"该会话不属于任何工作区" |
| 多步对话导致重复播报 | 记录 `injectedAt`，只播报晚于本轮开始的注入 |
| 升级导致槽位/令牌改名 | 只用官方声明槽位与主题令牌；改名只降级外观，不崩溃 |
