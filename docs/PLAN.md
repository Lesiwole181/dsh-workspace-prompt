# dsh-workspace-prompt 工程规划

> 插件名：`dsh-workspace-prompt`（工作区提示词）
> 工程目录：`CreateDSHplugins/dsh-workspace-prompt`
> 环境安装目录（如需）：`CreateDSHplugins/env`
> 临时/测试文件目录：`CreateDSHplugins/temp&test`
> 目标运行时：DeepSeek Harness 0.2.1-rc.2（当前 Web GUI 与 Desktop 共用同一套 dsh 运行时）
> 约束：**不修改任何 deepseek-harness 本体文件**

---

## 1. 目标与验收标准

为每个"被添加进插件界面的工作区"维护一份 Markdown 提示词；启用后，在该工作区的所有会话中，每次对话开始时把提示词注入 Agent，且提示词本身不出现在对话气泡中。

| # | 需求 | 验收方式 |
|---|---|---|
| R1 | 设置侧边栏出现「工作区提示词」入口，点击切换到该界面 | Client 在 `settings.section` 插槽注册一页，live 插槽检查可见 id + label |
| R2 | 界面列出"被添加进此界面的工作区"（不是全部 DSH 工作区） | `/api/workspacePrompt/list` 只返回已添加集合 |
| R3 | 列表框右上方（与设置面板右上角「打开配置文件」对齐）的「管理工作区」按钮，可勾选批量添加/删除工作区及其提示词；空列表时框内不显示该按钮 | 管理视图 + `/apply` 批量接口；移除时删除 `.md` 文件与启用标记 |
| R4 | 点击列表中的工作区进入「管理该工作区的提示词」界面 | 编辑视图（同一设置页内切换） |
| R5 | 编辑模式可输入并保存；保存按钮在提示词框右下角；浏览模式只读 + Markdown 渲染 | 编辑器两模式 + 按钮位置 + 安全 Markdown 渲染 |
| R6 | 返回按钮在管理界面左上角 | 编辑视图头部左侧「← 返回」 |
| R7 | 启用开关在提示词框右上角 | 编辑器卡片工具条右侧 `role="switch"` |
| R8 | 开启后每次对话开始注入 Agent，不出现在对话中 | `systemPrompt.context` 运行时上下文（Chat 视图不渲染普通 context 行） |
| R9 | 提示词路径 `dsh-workspace-prompt/prompt/${workspace_name}.md`，目录不存在自动创建 | 包根 `prompt/`，激活时 `mkdir -p` |
| R10 | 适配 Web 与 Desktop | 同一 Client 模块体系 + 同一 Host API；桌面端为同版本运行时 |
| R11 | 面向未来 DSH 版本尽量兼容 | 只用公开扩展点、零第三方依赖、容错读取、版本化状态/接口 |
| R12 | 模块化、低耦合、命名易懂 | Host 9 模块 / Client 10 模块，单向依赖 |
| R13 | 中英文 | 全部可见文案走 locale 命名空间，zh/en 词典键完全一致 |

---

## 2. 关键需求解读与设计决策

### 2.1 "被添加的工作区"是插件自己的集合
DSH 的 `workspaceRegistry` 管理全部工作区；插件另存 **added 集合**（`state/workspaces.json`）。列表页只显示 added 集合；「管理工作区」展示全部工作区并勾选，应用时做批量 diff：
- 新增勾选 → 加入 added，分配提示词文件名；
- 取消勾选 → 从 added 移除，**删除其提示词文件**、启用标记；
- 批量操作一次请求完成（`POST /apply`），返回 added/removed/ignored。

### 2.2 提示词文件路径与命名
- 目录：`<插件包根>/prompt/`（即按需求字面的 `dsh-workspace-prompt/prompt/`）。插件以本地目录 link 方式安装，数据持久保存在工程目录中。
- 文件名：`<净化后的工作区名>.md`。工作区名取 `title`，为空时回退目录末段、再回退 id。
- 净化：去掉 `\ / : * ? " < > |` 与控制字符，去首尾空白和点，最长 80 字符，Windows 保留设备名加 `_` 前缀；同名工作区依次 `-2`、`-3`。
- 映射持久化在 `state/workspaces.json` 的 `fileName` 字段：**工作区改名不搬文件**，避免提示词丢失；新添加时按当时的工作区名生成文件名。
- 可通过配置 `promptDirectory` 或环境变量 `DSH_WORKSPACE_PROMPT_DIR`（绝对路径）改到别处，便于多 profile 隔离/迁移。

### 2.3 注入机制：`systemPrompt.context`（运行时上下文）
对比方案：

| 方案 | 结论 |
|---|---|
| `systemPrompt.section` | 改的是系统提示词本体，系统提示词变化会形成 surface 记录；且不是"每次对话开始"的语义单元。不采用 |
| `agent.inject()` | 会在 inbox 中堆积注入消息，需要精确选时（turn 开始/结束），时序复杂。不采用 |
| `agent/pre-step` 改写 messages | 强干预、易与其他插件冲突，且消息会进入会话记录。不采用 |
| **`systemPrompt.context`** | 框架专门为"动态运行时上下文"设计：每次模型步骤重新求值，内容变化时物化为上下文快照；Chat 视图隐藏普通 context 行（`isVisibleChatNode` 明确排除）。**采用** |

具体：
- 注册固定名 `workspace-prompt:current` 的 context，`required: true`（全局关闭可选运行时上下文时仍注入）、`interpolate: false`（正文原样保留，避免 `{{...}}` 被当作变量解析而报错）。
- order 取 `getContextOrder('WORKING_DIRECTORY') + 10`（紧跟工作目录之后），取不到时回退常量。
- 求值是**同步**的：会话 `header.cwd` → `workspaceRegistry.list()` 同步匹配（规范化路径：反斜杠→斜杠、去尾斜杠、Windows 转小写；先精确匹配，再取包含该 cwd 的最深工作区）→ added 集合 → 启用标记 → 同步读提示词文件（mtime+size 缓存）→ 空则跳过。
- 注入文本带一行英文说明头（模型可归属），正文原样拼接。
- 全程 try/catch + 告警去重：注入路径绝不能让异常打断模型循环。
- 诚实说明：DSH 会把运行时上下文快照写进会话日志（会话日志是唯一事实来源），Chat 视图不显示这行；在 Trajectory 检查视图里可看到。这是运行时上下文的通用行为，不是本插件额外添加的对话行。

### 2.4 会话 → 工作区的归属
使用 DSH 自身的工作区分组语义：会话 `header.cwd`（创建会话时的工作区根目录）规范化后与 `workspace.path` 匹配。用户 `cd` 到子目录不影响归属；未归属任何工作区的会话不注入。

### 2.5 数据一致性
- 状态文件（workspaces.json / enabled.json）读: stat mtime+size 缓存，写: 临时文件 + rename 原子替换；多窗口/多进程（web + desktop 同时运行）下读端按 mtime 感知外部修改。
- 提示词正文写：临时文件 + rename，按文件名串行化；读: mtime+size 缓存。
- 批量变更在 Host 服务内串行化（promise 队列），避免并发 apply 互相覆盖。

---

## 3. 总体架构

```
┌────────────────────────── Browser / Desktop WebView ──────────────────────────┐
│ client.js  (entry: chunk loading / locale / styles / settings.section)         │
│   ├─ client.i18n.js         zh/en 词典                                         │
│   ├─ client.api.js          /api/workspacePrompt/* 客户端                      │
│   ├─ client.markdown.js     安全 Markdown → React                              │
│   ├─ client.icons.js        内联 SVG                                           │
│   ├─ client.styles.js       .dwp-* 样式（仅主题令牌）                           │
│   ├─ client.app.js          页面状态机：list / manage / edit                    │
│   ├─ client.workspace-list.js   列表视图（含右上角「管理工作区」）              │
│   ├─ client.manage-workspaces.js 批量管理视图（勾选 + 二次确认）                │
│   └─ client.prompt-editor.js     编辑器（编辑/浏览、保存、启用开关、返回）      │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ Connection 已鉴权 /api（同源 fetch）
┌───────────────────────────────┴────────────────────────────────────────────────┐
│ Host 半（index.js 组装，host/ 模块化）                                          │
│   data-directories.js   目录解析/创建（prompt/、state/、env/config 覆盖）        │
│   json-file.js          JSON 文件原子读写 + mtime 缓存                          │
│   workspace-resolver.js 工作区展示名、路径规范化、cwd→工作区匹配                │
│   prompt-file-store.js  提示词文件：净化/分配文件名/同步读/原子写/删除          │
│   added-workspaces-store.js  added 集合 + fileName 映射                         │
│   enabled-flags-store.js     启用开关                                           │
│   prompt-service.js     业务门面（唯一的操作实现，事务串行化）                  │
│   injection.js          systemPrompt.context 注册与同步求值                     │
│   api-routes.js         /api/workspacePrompt/* 路由（薄层）                     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

依赖方向：`index.js` → 各模块；`api-routes` → `prompt-service`；`prompt-service` → 3 个 store + resolver；`injection` → `prompt-service` 的只读查询。**模块之间不反向依赖，不共享可变全局。**

使用的公开扩展点（均非 hack、不修改 Host 文件）：
1. `settings.section` Client 插槽（`@deepseek-ai/dsh-client-ui-settings` 声明）——设置页入口；
2. `ctx.systemPrompt.context()` Host 服务——运行时上下文注入；
3. `ctx.connection.fetch.register()` Host 服务——浏览器半数据面（走 Connection 鉴权，不新开端口、不绕过鉴权）；
4. `ctx.workspaceRegistry.list()` Host 服务——工作区枚举（同步投影）；
5. `ctx.slots` / `ctx.locale` Client 服务。

---

## 4. 目录结构

```
dsh-workspace-prompt/
├── package.json               包清单：dsh.bundle.patch + dsh.client（web/desktop 同一 Client 半）
├── cordis.patch.yml           插入一行 Host 插件
├── index.js                   Host 入口（仅组装与注册，不含业务规则）
├── client.js                  Client 入口（chunk 加载、locale、settings.section 注册）
├── client.i18n.js             zh/en 词典
├── client.api.js              Host API 客户端 + 错误码→词条映射
├── client.markdown.js         安全 Markdown 渲染
├── client.icons.js            内联 SVG 图标
├── client.styles.js           `.dwp-` 样式
├── client.app.js              页面状态机
├── client.workspace-list.js   工作区列表
├── client.manage-workspaces.js 管理工作区（批量）
├── client.prompt-editor.js    提示词编辑器
├── host/                      Host 半（9 个模块，见上）
├── locale/en.json, zh.json    插件在插件管理页的显示名/描述
├── icon.svg                   插件图标（原创）
├── prompt/                    运行时生成：<工作区名>.md
├── state/                     运行时生成：workspaces.json、enabled.json
├── docs/                      PLAN / CONTRACTS / ARCHITECTURE / API / VERIFY
├── README.md                  中文使用说明
└── README.en.md               英文使用说明
```

测试与临时产物不进入插件包：统一放在 `CreateDSHplugins/temp&test/`（受沙箱限制时，运行时临时文件放系统临时目录）。环境依赖（如需）装 `CreateDSHplugins/env/`。

---

## 5. 数据模型

### 5.1 `state/workspaces.json`
```json
{
  "version": 1,
  "workspaces": [
    { "id": "ws_xxx", "fileName": "我的项目.md", "addedAt": 1760000000000 }
  ]
}
```
容错读取：缺失/损坏 → 空集合；非法条目丢弃；兼容旧版裸数组；按 id 去重（先到先得）。

### 5.2 `state/enabled.json`
```json
{ "version": 1, "enabled": { "ws_xxx": true } }
```

### 5.3 `prompt/<fileName>`
UTF-8 Markdown 原文。目录在插件激活时 `mkdir -p`（满足"不存在则自动新建"）。

---

## 6. Host HTTP API（全部走 Connection 鉴权，同源 `/api`）

统一：成功 `200` + `{ "version": 1, ... }`；失败 `{ "error": { "code", "details"? } }`；均 `cache-control: no-store`。错误文案由 Client 按 code 本地化。

| 路由 | 方法 | 入参 | 返回 |
|---|---|---|---|
| `/api/workspacePrompt/list` | GET | — | `{ promptDirectory, workspaces: ListedWorkspace[] }` |
| `/api/workspacePrompt/catalog` | GET | — | `{ workspaces: CatalogWorkspace[] }`（全部 DSH 工作区 + added 标记） |
| `/api/workspacePrompt/apply` | POST | `{ add?: string[], remove?: string[] }` | `{ added, removed, ignored, workspaces: ListedWorkspace[] }` |
| `/api/workspacePrompt/content` | GET | `?workspaceId=` | `{ workspace: ListedWorkspace, content: string }` |
| `/api/workspacePrompt/save` | POST | `{ workspaceId, content }` | `{ workspace: ListedWorkspace, savedAt: number }` |
| `/api/workspacePrompt/enable` | POST | `{ workspaceId, enabled }` | `{ workspace: ListedWorkspace }` |

- `ListedWorkspace = { id, title, path, name, fileName, enabled, hasContent, characters }`
- `CatalogWorkspace = { id, title, path, name, added }`
- 错误码：`bad-request`(400)、`workspace-not-found`(404)、`not-added`(409)、`content-too-long`(413, details.limit)、`io-failed`(500)。
- 限制：`content` 最长 200000 字符；批量 id 上限 1000；`add` 与 `remove` 交集 → 400。

---

## 7. 前端交互规格

### 7.1 列表视图（工作区提示词）
- 说明文案下方、列表框正上方一行：左侧数量摘要，右侧「管理工作区」按钮（`R3`）。按钮右缘与设置面板头部「打开配置文件」按钮对齐（相对本页内容列右缘内缩 26px = 头部右侧 padding 14 + 关闭按钮 28 + 头部 gap 8 − 内容列 padding 24），整体位于列表框右上方，而不是页面顶部。
- 行：启用状态点 + 工作区名 + 路径（省略号）+ 元信息（已启用/未启用 · N 字符 / 未填写）+ 右侧箭头。整行可点击进入编辑器（`R4`）。
- 加载中/失败（含重试）/空集合（框内只显示空态文案，**不再放「管理工作区」按钮**，入口只保留在列表框右上方）。

### 7.2 管理工作区视图（批量）
- 顶部：左「返回」（仅返回列表、不应用）、中标题「管理工作区」、右「应用」（无变化时禁用；应用中有 loading）。「应用」按钮右缘按共享的 `--dwp-action-inset`（默认 26px）从内容列右缘内缩，与列表视图按钮和设置面板头部「打开配置文件」对齐。
- 说明文案：勾选加入列表，取消勾选将删除该工作区及其提示词。
- 列表：全部 DSH 工作区，复选框（原生 checkbox），已添加的默认勾选；变更计数。
- 取消勾选 → 底部提示将删除 N 份提示词；点「应用」出现二次确认（再点「确认应用」才提交）。
- 提交调 `/apply`；成功后返回列表并提示"已添加 X / 已移除 Y"。

### 7.3 提示词编辑器（管理该工作区的提示词）
- 头部：左侧「← 返回」（`R6`）；工作区名 + 路径。
- 提示词卡片：
  - 工具条：左侧模式切换「编辑 | 浏览」（segmented tabs）；右侧启用开关（`R7`，`role="switch"` + `aria-checked` + 文案）。
  - 内容：编辑 = `<textarea>`（Markdown 原文，可 resize）；浏览 = 只读 Markdown 渲染；空内容显示空态文案。
  - 底部：编辑模式左侧状态（已保存/未保存/字数/错误），**右下角「保存」按钮**（`R5`）；浏览模式显示字数，不显示保存。
- 默认模式：已有内容 → 浏览；空内容 → 编辑。
- 未保存保护：返回或切到浏览时若有未保存修改，第一次点击只提示"再次点击将放弃修改"，第二次才执行（3 秒后复位）。
- 保存/开关失败：卡片内联错误文案，不丢草稿。
- 开关即时生效（独立于保存）；未保存内容不参与注入（以已保存文件为准）。

### 7.4 视觉与可访问性
- 只用 `--dsw-alias-*` / `--dsw-specific-*` 主题令牌，不写死颜色；亮/暗主题自动跟随。
- 类名统一 `.dwp-` 前缀；不读取其它插件 DOM / 样式。
- 不 import Harness Client 包（尤其 `dsh-client-ui-primitives`），控件自行实现并保持语义（button/switch/checkbox/tablist 的 aria）。
- 样式以 React `<style>` 元素渲染在组件内，卸载自动移除；不向 `document.body` 追加节点。
- 可见文案全部来自 locale 命名空间，zh/en 键完全一致。

---

## 8. 中英文
- Client：`ctx.locale.register('dsh-workspace-prompt', { zh, en })`，`ctx.locale.bind` 取 `t(key, params?)`；随 locale 切换，组件通过 `useSyncExternalStore` 重新渲染。
- 插件管理页显示名/描述：`locale/zh.json`、`locale/en.json` 的 `meta.title/description`。
- Host 不产生用户可见文案（只回错误码），避免服务端 locale 依赖。

---

## 9. 兼容性与未来适配策略

1. **只用公开扩展点**：settings.section、systemPrompt.context、connection.fetch、workspaceRegistry.list、locale/slots 服务；不触碰 Host 内部文件，不依赖私有字段（运行时字段如 `assembleContext.agent` 按可选处理并判空）。
2. **零第三方依赖**：Host 只用 `node:` 内置模块；Client 只用平台种子模块 `react`；不 import 任何 `@deepseek-ai/*` 包，因此 DSH 包 API 升级不会造成加载失败。
3. **防御式服务接入**：`ctx.inject(['systemPrompt','workspaceRegistry'])` 才激活；`connection` 缺失时只注册注入（TUI/headless 也可用），有则注册路由；注入回调全程 try/catch。
4. **版本化数据与接口**：状态文件 `version: 1` + 容错读取；HTTP 响应 `version: 1` + 稳定错误码；未来迁移有升级钩子。
5. **可配置**：`promptDirectory` / `stateDirectory`（cordis.patch.yml 配置或 `DSH_WORKSPACE_PROMPT_DIR`），便于部署与多 profile。
6. **不依赖 DOM 结构**：不读取宿主 DOM/CSS，不替换应用根；视觉只用令牌，令牌改名最多影响外观不会崩溃。
7. **可观测**：激活/错误写入 `ctx.logger`；错误码 + 日志足以定位问题。
8. **测试锁定契约**：Host 模块单测 + HTTP 路由单测 + Client 渲染冒烟测试（jsdom），升级时先跑测试。

---

## 10. 测试与验证计划

### 10.1 静态检查
- 所有 JS `node --check`；`package.json` JSON 合法；`exports`/`files` 与实际文件一致；icon 为合法 SVG。

### 10.2 Host 单元测试（`CreateDSHplugins/temp&test/host/`）
- `sanitizeWorkspaceName` 边界（空、非法字符、保留名、长度）；
- 文件名分配去重（-2/-3、大小写不敏感、目录已有文件）；
- JSON 文件容错读取/原子写/缓存失效；
- cwd→工作区匹配（精确、包含、大小写、非归属）；
- added 集合 apply diff（增/删/忽略/交集 400/超限）；
- 服务端操作（list/catalog/save/enable/content 错误码、200000 上限、移除删文件）；
- 注入文本构建与 provider 判定（未添加/未启用/空/正常、异常兜底）。

### 10.3 HTTP 路由测试
用假 Request/Response 直接调用路由 `fetch`，断言状态码、JSON、错误码、`cache-control`。

### 10.4 Client 测试（jsdom）
- 以假 `window.__ModuleLoader__` 收集注册；用真实 React + jsdom 渲染；
- 断言：Settings 页注册 id/label；列表渲染空态/数据行；点「管理工作区」出现全部工作区；勾选应用调用 API；进入编辑器、模式切换、保存按钮位置、开关调用、Markdown 渲染（含 XSS 不执行/不注入 HTML）。
- 依赖复用 checkouts 中已有 react/react-dom/jsdom；若不可用则在 `CreateDSHplugins/env` 安装。

### 10.5 实机验证
1. `plugin_manager install_bundle` 安装到当前 web profile，确认 `application: applied` 且无 warning；
2. `cordis_inspect_query` Client `Slots.listSubTree(root='settings.section')` 确认 occupant `dsh-workspace-prompt` active；
3. Host 侧确认插件行生效、错误日志无异常；
4. 说明视觉/交互验证的边界（无浏览器控制时不上截图、不造假）；
5. Desktop 兼容：同一 dsh 运行时 + 同一 Client 模块体系；给出在 Desktop profile 安装同一包的步骤并核对静态配置（可行时安装到 desktop profile 验证装配）。

### 10.6 验收清单
R1–R13 逐条勾选，记录在 `docs/VERIFY.md`。

---

## 11. 实施里程碑与分工

| 里程碑 | 内容 | 负责 |
|---|---|---|
| M0 | 规划 + 契约（本文件、CONTRACTS.md） | Lead |
| M1 | Host 9 模块 + 单测 | host-builder |
| M2 | Client 9 模块（含样式/Markdown/i18n 对接） | client-builder |
| M3 | 入口/清单/补丁/图标/插件元数据/文档 | Lead |
| M4 | 独立测试（host/client/路由）+ 需求核对 | verifier |
| M5 | 安装、live 验证、修复、验证报告 | Lead + verifier |

写作用域互不重叠：`host/**`、`client.*.js`、根目录清单/入口/文档/`temp&test/**` 分开。

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 未来 DSH 移除/改名 `settings.section` | 注册失败仅导致入口消失，不崩溃；文档记录依赖的扩展点与替代路径 |
| `systemPrompt.context` 语义变化 | 注入回调纯函数化、可单测；失败静默（返回空串） |
| 运行时上下文在 Trajectory 可见 | 在 README 如实说明；Chat 视图不显示（当前 DSH 行为） |
| 多进程并发写状态 | 原子写 + mtime 读缓存 + 服务串行化；web/desktop 同时运行数据一致 |
| 工作区被删除 | added 集合中失效条目在列表/应用时跳过（可见性优先），不误删磁盘文件；用户可在管理视图清理 |
| 文件名冲突/非法字符 | 净化 + 去重 + 保留名处理 + 映射持久化 |
| 沙箱/权限限制 | 运行时数据由 Host 进程写；测试临时文件写系统临时目录；不依赖 shell 写工作区 |
| 无浏览器控制 | 以插槽检查 + jsdom 冒烟 + 单测为准，明确报告视觉验证边界 |

---

## 13. 交付物
1. 可安装插件包（本目录）；
2. `docs/PLAN.md`（本文件）、`docs/ARCHITECTURE.md`、`docs/API.md`、`docs/VERIFY.md`、`docs/CONTRACTS.md`；
3. `README.md` / `README.en.md`；
4. `temp&test/` 下的测试与验证产物（不进入插件包）。
