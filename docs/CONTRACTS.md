# 模块接口契约（实现必须遵守）

> 本文件是 host-builder / client-builder / verifier 之间的唯一接口约定。
> 所有文件均为 **原生 ESM**（`package.json` 已声明 `"type": "module"`）。
> Host 只用 `node:` 内置模块；Client 只用 `require('react')`（平台种子模块），**禁止 import 任何 `@deepseek-ai/*`**。

---

## A. Host 半（`host/*.js` + `index.js`）

### A.0 通用约定
- 文件内导出使用具名 export；内部辅助函数不导出（测试需要时再具名导出并加注释）。
- 所有会抛错的函数抛 `Error`；业务错误由 `prompt-service.js` 抛 `WorkspacePromptError`（见 A.7）。
- IO 失败要带上下文信息（如 `读取提示词文件失败：<path>`）；告警统一走注入的 `onWarn(message)` 回调（由 index.js 接到 `ctx.logger.warn`，并做去重）。
- 注释使用 JSDoc 风格，简洁说明职责与边界；命名用完整英文单词。

### A.1 `host/data-directories.js`
```js
export const PACKAGE_ROOT            // string，插件包根绝对路径（host/ 的上一级）
export const DEFAULT_PROMPT_DIRECTORY // <PACKAGE_ROOT>/prompt
export const DEFAULT_STATE_DIRECTORY  // <PACKAGE_ROOT>/state
export const PROMPT_DIRECTORY_ENV = 'DSH_WORKSPACE_PROMPT_DIR'

/** 解析实际使用的数据目录。纯函数，不写盘。
 * config: { promptDirectory?: string, stateDirectory?: string }
 * env: 进程环境（默认 process.env）
 * 返回 { promptDirectory, stateDirectory, warnings: string[] }
 * 规则：环境变量（仅绝对路径，相对路径忽略并 warning）> config（绝对路径原样；相对路径相对 PACKAGE_ROOT）> 默认值。
 */
export function resolveDataDirectories(config, env)

/** 递归创建目录；失败抛错。 */
export function ensureDirectories({ promptDirectory, stateDirectory }) // void
```

### A.2 `host/json-file.js`
```js
/** 创建一个小型 JSON 文件访问器（内部缓存 mtime+size）。
 * path: 绝对路径；normalize(raw: unknown): T 必须容错（损坏输入返回默认值，绝不抛错）；
 * onWarn(message): void
 * 返回：
 *   { path,
 *     read(): T,                          // 按 mtime+size 缓存；ENOENT/损坏 -> normalize(undefined)
 *     write(value: T): void,              // mkdir -p + 临时文件 + rename 原子替换；失败抛错
 *     update(mutator: (current: T) => T | void): T, // read -> mutator -> (返回值非 undefined 才写) -> 返回最终值
 *     invalidate(): void }
 */
export function createJsonFile({ path, normalize, onWarn })
```

### A.3 `host/workspace-resolver.js`
```js
/** 展示名：title 非空 -> title；否则 path 末段；否则 id。 */
export function workspaceDisplayName(workspace) // string

/** 路径规范化：字符串化、trim、反斜杠->斜杠、去尾斜杠、win32 下 toLowerCase。空入参 -> ''。 */
export function normalizePath(value) // string

/** 会话 cwd -> 工作区：先找 normalizePath(path) 精确相等；否则找 cwd 位于其下的最深工作区（前缀 + '/'）。 */
export function findWorkspaceByCwd(workspaces, cwd) // workspace | undefined

/** 工作区对象 -> { id, title, path, name }（全部 String() 防御，name=展示名）。 */
export function toWorkspaceSummary(workspace) // { id, title, path, name }
```

### A.4 `host/prompt-file-store.js`
```js
export const MAX_PROMPT_CHARACTERS = 200000

/** 文件名净化：删 \ / : * ? " < > | 与控制字符；去首尾空白和点；截断 80；Windows 保留设备名加 '_' 前缀。可能返回 ''。 */
export function sanitizeWorkspaceName(title) // string

/** 校验文件名可安全用于 prompt 目录：非空、无路径分隔符、无非法字符、以 .md 结尾。 */
export function isSafePromptFileName(fileName) // boolean

/** directory: prompt 目录绝对路径；onWarn
 * 返回：
 *   { directory,
 *     ensureDirectory(): void,
 *     readSync(fileName: string): string,     // mtime+size 缓存；缺失/非法/读失败 -> ''
 *     hasContent(fileName: string): boolean,  // trim 非空
 *     async write(fileName: string, content: string): Promise<void>, // 原子写，按 fileName 串行
 *     async remove(fileName: string): Promise<void>,                 // 缺失不报错
 *     listFileNames(): string[],              // 目录下 *.md
 *     allocateFileName(workspace, takenFileNames: string[]): string  // `\${净化名 || 'workspace'}.md`，冲突 -2/-3…，
 *                                                                     // 大小写不敏感比较（win32），不写盘
 *   }
 */
export function createPromptFileStore({ directory, onWarn })
```

### A.5 `host/added-workspaces-store.js`
```js
/** 状态文件 state/workspaces.json 的规范化；容错、去重（先到先得）、兼容旧版裸数组。
 * 返回 { version: 1, workspaces: Array<{ id: string, fileName: string|null, addedAt: number }> }
 */
export function normalizeAddedState(raw)

/** stateDirectory: state 目录绝对路径；onWarn
 * 返回：
 *   { list(): Array<{id, fileName, addedAt}>,       // 副本
 *     has(id): boolean,
 *     get(id): entry | undefined,
 *     set(entries: Array<{id, fileName, addedAt}>): void, // 全量替换并持久化
 *     assignFileName(id: string, fileName: string): void  // 不存在则抛 Error
 *   }
 */
export function createAddedWorkspacesStore({ stateDirectory, onWarn })
```

### A.6 `host/enabled-flags-store.js`
```js
/** state/enabled.json 规范化：{ version: 1, enabled: { [id]: true } }；非法输入容错。 */
export function normalizeEnabledState(raw)

/** 返回：
 *   { isEnabled(id): boolean,
 *     enabledIds(): string[],
 *     set(id: string, enabled: boolean): void,   // false 删除键；持久化
 *     remove(ids: string[]): void }
 */
export function createEnabledFlagsStore({ stateDirectory, onWarn })
```

### A.7 `host/prompt-service.js`
```js
export class WorkspacePromptError extends Error { constructor(code, details = {}) } // this.code / this.details
export const ERROR_CODES = {
  badRequest: 'bad-request', workspaceNotFound: 'workspace-not-found',
  notAdded: 'not-added', contentTooLong: 'content-too-long', ioFailed: 'io-failed',
}

/** 依赖：workspaceRegistry(ctx.workspaceRegistry)、addedStore、enabledStore、promptFileStore、onWarn
 * 返回（所有方法描述的操作是唯一业务实现；HTTP 路由只做参数解析）：
 *   {
 *     listAddedWorkspaces(): { promptDirectory: string, workspaces: ListedWorkspace[] },
 *     listCatalog(): { workspaces: CatalogWorkspace[] },
 *     async applyChanges({ add, remove }): Promise<{ added: string[], removed: string[], ignored: string[], list: ListedWorkspace[] }>,
 *     readWorkspace(workspaceId): { workspace: ListedWorkspace, content: string },
 *     async saveContent(workspaceId, content): Promise<{ workspace: ListedWorkspace, savedAt: number }>,
 *     setEnabled(workspaceId, enabled): { workspace: ListedWorkspace },
 *     resolvePromptForCwd(cwd): { workspace, fileName, body } | undefined, // 供注入用，绝不抛错
 *   }
 *
 * ListedWorkspace = { id, title, path, name, fileName, enabled, hasContent, characters }
 * CatalogWorkspace = { id, title, path, name, added }
 *
 * 语义：
 * - listAddedWorkspaces：按 workspaceRegistry.list() 的持久顺序过滤 addedStore.has(id)；
 *   跳过已不存在的工作区；fileName 缺失时现场分配并持久化（用户可见路径，允许写）；
 *   characters/hasContent 由 promptFileStore.readSync 计算。
 * - listCatalog：全部工作区 + added 标记。
 * - applyChanges：校验 input 为对象；add/remove 必须为字符串数组（否则 bad-request）；
 *   去重；总 id 数 > 1000 -> bad-request；add∩remove 非空 -> bad-request；
 *   add 中不存在于 registry 或已 added 的 -> ignored；remove 中不存在于 added 的 -> ignored；
 *   remove 的条目删除 enabled 标记 + 删除提示词文件（fileName 非法则跳过删除）；
 *   变更整体串行化（内部 promise 队列）；返回变更后的 list。
 * - readWorkspace：无该工作区 -> workspaceNotFound；存在但未 added -> notAdded。
 * - saveContent：content 必须 string；> MAX_PROMPT_CHARACTERS -> contentTooLong（details.limit）；
 *   写文件失败 -> ioFailed（details.reason 为技术原因）。
 * - setEnabled：enabled 必须 boolean，否则 bad-request。
 * - resolvePromptForCwd：同步；registry 匹配 -> added -> enabled -> 读正文；任一步不满足返回 undefined；
 *   外层 try/catch，异常只 onWarn 并返回 undefined。
 */
export function createPromptService({ workspaceRegistry, addedStore, enabledStore, promptFileStore, onWarn })
```

### A.8 `host/injection.js`
```js
export const CONTEXT_NAME = 'workspace-prompt:current'

/** 注入上下文 order：systemPrompt.getContextOrder('WORKING_DIRECTORY') + 10；异常/非数值回退 110。 */
export function injectionContextOrder(systemPrompt, onWarn) // number

/** 模型可读的注入文本：说明头 + 空行 + 正文（正文 trimEnd）。
 * 说明头固定英文：`Workspace prompt for workspace "<name>". The user configured this prompt for the whole workspace; apply it in addition to the system instructions.`
 */
export function buildInjectionText(workspaceName, body) // string

/** 生成可直接交给 ctx.systemPrompt.context() 的定义对象：
 *   { name: CONTEXT_NAME, order, required: true, interpolate: false,
 *     text(assembleContext) { ... } }
 * text：assembleContext.agent?.session?.header?.cwd -> service.resolvePromptForCwd(cwd) ->
 *   命中则 buildInjectionText；否则 ''；异常 try/catch + onWarn 去重，返回 ''。
 */
export function createWorkspacePromptContext({ systemPrompt, service, onWarn })
```

### A.9 `host/api-routes.js`
```js
export const ROUTE_BASE = '/api/workspacePrompt'
export const ROUTES = {
  list: `${ROUTE_BASE}/list`,      // GET
  catalog: `${ROUTE_BASE}/catalog`,// GET
  apply: `${ROUTE_BASE}/apply`,    // POST
  content: `${ROUTE_BASE}/content`,// GET ?workspaceId=
  save: `${ROUTE_BASE}/save`,      // POST { workspaceId, content }
  enable: `${ROUTE_BASE}/enable`,  // POST { workspaceId, enabled }
}

/** 返回 ConnectionFetchRoute[]：
 *   { path, methods: ['GET'|'POST'], requestBody: 'buffered', fetch(request): Promise<Response> }
 * 成功：Response.json({ version: 1, ...value }, { headers: {'cache-control':'no-store'} })
 * 失败：Response.json({ error: { code, details? } }, { status, headers: {'cache-control':'no-store'} })
 * status 映射：bad-request 400、workspace-not-found 404、not-added 409、content-too-long 413、io-failed 500；
 * 非 WorkspacePromptError 异常 -> onWarn + 500 io-failed。
 * GET 参数从 new URL(request.url).searchParams 取；POST 请求体 JSON 解析失败 -> 400 bad-request。
 */
export function createWorkspacePromptRoutes({ service, onWarn })
```

### A.10 `index.js`（Lead 编写，供参考）
```js
export function apply(ctx, config = {}) {
  ctx.inject(['systemPrompt', 'workspaceRegistry'], (ready) => activate(ready, config))
}
```
`activate`：
1. `resolveDataDirectories(config)` + warning 日志；`ensureDirectories`（失败 warn 但继续）。
2. 构造 `promptFileStore` / `addedStore` / `enabledStore` / `service`。
3. `ctx.effect(() => ctx.systemPrompt.context(createWorkspacePromptContext({...})), 'dsh-workspace-prompt: workspace prompt context')`。
4. `const connection = ready.get?.('connection') ?? ready.connection`；存在 `connection.fetch.register` 时逐条 `ctx.effect(() => connection.fetch.register(route), 'dsh-workspace-prompt: route <path>')`；否则 warn 并跳过（TUI/headless 仍能注入）。
5. `ctx.logger?.info?.('dsh-workspace-prompt: ready ...')`。

---

## B. Client 半（`client*.js`，均为 chunk 形态）

### B.0 Chunk 文件格式（每个 `client.<name>.js` 必须如此）
```js
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.<name>.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // ... 组件/函数 ...
    return { /* 本文件导出，见下 */ }
  },
})
```
- `id` 固定 `'dsh-workspace-prompt'`；`chunk` 字段与本文件名一致。
- 只允许 `require('react')`；**不能**同步 `require('./client.xxx.js')`（chunk 之间只能由入口先加载后通过 props 传参）。
- 不 import 任何 `@deepseek-ai/*` 包。
- 组件一律写成函数组件，用 `h()`，不使用 JSX。
- 样式字符串放 `client.styles.js`；所有 class 以 `dwp-` 开头。

### B.1 `client.js`（Lead 编写）
- 加载全部 chunk（`require.async('./client.<name>.js')`，全部串行/并行均可），然后：
  - `ctx.effect(() => ctx.locale.register(NS, { zh: i18n.zh, en: i18n.en }))`
  - `t = ctx.locale.bind(NS)`
  - `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id: NS, order: 25, label: () => t('settings.title') }, (props) => h(app.WorkspacePromptApp, { ...props, t, api, useLocaleVersion, modules })))`
- 传入 App 的 props：`{ ...slotProps, t, api, useLocaleVersion, modules }`
  - `modules = { i18n, api, markdown, icons, styles, workspaceList, manageWorkspaces, promptEditor }`
  - `useLocaleVersion(): string` 用 `React.useSyncExternalStore(ctx.locale.subscribe, () => ctx.locale.getSnapshot().active, ...)`。

### B.2 `client.i18n.js`
导出 `{ zh, en }`，两本词典 **键完全一致**（键清单见 D 节）。

### B.3 `client.api.js`
```js
export class ApiError extends Error { constructor(code, details = {}, status = 0) } // code/details/status
export function errorMessageKey(error) // string，API 错误码 -> i18n 键；未知 -> 'error.unknown'

export function createWorkspacePromptApi({ baseUrl = '/api/workspacePrompt', fetchImpl = fetch } = {}) // 返回：
{
  list(): Promise<{ promptDirectory: string, workspaces: ListedWorkspace[] }>,
  catalog(): Promise<{ workspaces: CatalogWorkspace[] }>,
  apply({ add = [], remove = [] } = {}): Promise<{ added, removed, ignored, workspaces }>,
  readContent(workspaceId): Promise<{ workspace, content }>,
  saveContent(workspaceId, content): Promise<{ workspace, savedAt }>,
  setEnabled(workspaceId, enabled): Promise<{ workspace }>,
}
```
- 请求：同源 `fetchImpl(url, { method, credentials: 'same-origin', cache: 'no-store', headers, body })`；GET 用 query，POST 用 JSON body。
- 网络异常 -> `ApiError('network', { reason })`；非 2xx 或响应含 `error` -> `ApiError(error.code ?? 'http', error.details ?? {}, status)`；JSON 解析失败 -> `ApiError('http', { status })`。
- 错误码常量：`network`、`bad-request`、`workspace-not-found`、`not-added`、`content-too-long`、`io-failed`、`http`、`unknown`。

### B.4 `client.markdown.js`
导出 `{ renderMarkdown(text) -> ReactNode[] }`：
- 支持：ATX 标题、段落、无序/有序列表、引用、围栏代码块、分隔线、行内 `code`/**bold**/*italic*/~~删除线~~/[链接](url)。
- 安全：永不解析原始 HTML（文本节点转义由 React 保证）；链接仅允许 `http(s)://`、`mailto:` 与相对路径，`javascript:` 等保持纯文本；外链 `target="_blank" rel="noreferrer noopener"`。
- 参考实现：`D:\DSHplugins\dsh-workspace-prompt\client.markdown.js`（可直接改造，但必须改成上面的 chunk 形态）。

### B.5 `client.icons.js`
导出：`{ IconBack, IconChevronRight, IconClose, IconPlus, IconPrompt, IconCheck, IconWarning }`
- 每个是 `({ size = 14 }) => ReactElement`；`currentColor` 描边；`aria-hidden`；16×16 viewBox。

### B.6 `client.styles.js`
导出 `{ STYLE_TEXT: string }`：全部 `.dwp-*` 规则。要求：
- 只用 `--dsw-alias-*` / `--dsw-specific-*` 主题令牌（可参考 `D:\DSHplugins\dsh-workspace-prompt\client.styles.js`，但需覆盖新布局）。
- 覆盖：根容器、列表工具条、工作区行（hover/focus/active）、开关、tab、编辑器卡片/textarea/浏览区、Markdown 元素、管理视图（checkbox 列表、footer、二次确认）、空态/错误态/notice、按钮（primary/secondary/danger/ghost）、滚动区域。
- 面板内容区可用宽度约 564px、可用高度约 722px（设置面板 800px 宽、内容列 padding 左右 24px；内容区自身滚动）。管理列表给 `max-height` + 内部滚动。

### B.7 `client.workspace-list.js`
```js
export function WorkspaceListView({ t, icons, workspaces, loading, error, onOpen, onManage, onRetry })
// 渲染：
// - 说明文案（t('settings.description')）之后、列表框正上方一行 div.dwp-list-head：
//   左 span.dwp-list-head-meta = t('settings.count', { count })；
//   右 div.dwp-list-head-actions 内主按钮「管理工作区」（onManage）。
//   该行 CSS padding-right: var(--dwp-action-inset, 26px)，使按钮右缘与设置面板头部
//   「打开配置文件」按钮对齐（头部 padding-right 14 + 关闭按钮 28 + 头部 gap 8 −
//   内容列 padding 24 = 26，变量定义在 .dwp-root），视觉上位于列表框右上方。
// - loading：t('settings.loading')；error：t('settings.loadFailed', { reason }) + 重试按钮
// - 空集合：框内只有 t('settings.emptyTitle') / t('settings.emptyBody')，**不得再渲染「管理工作区」按钮**
//   （唯一入口在列表框右上方那一行）
// - 行：button.dwp-workspace-row，点击 onOpen(workspace)：
//     status dot（enabled=on）+ 名称 + 路径（省略号）+ meta（已启用/未启用 · N 字符 / 未填写）+ IconChevronRight
//   aria-label = t('settings.open', { name })
```

### B.8 `client.manage-workspaces.js`
```js
export function ManageWorkspacesView({ t, icons, catalog, loading, error, onCancel, onApply, onRetry })
// 内部状态：selected Set（初始 = catalog 中 added=true），applying、confirming、局部错误。
// 渲染：
// - 顶部：ghost「返回」（onCancel，仅返回列表、不应用）、标题 t('manage.title')、
//   primary「应用」(N)（无变化禁用；applying 禁用/显示 t('manage.applying')）；
//   该行同样使用 padding-right: var(--dwp-action-inset, 26px)，使「应用」按钮
//   左移并与列表视图按钮/面板头部动作对齐。
// - 说明文案 t('manage.description')；error 态 + 重试；loading；空 catalog 文案
// - 列表：label > input[type=checkbox] + 名称 + 路径 + added 徽标（t('manage.added')）
//   点击整行切换；勾选状态即时反映；底部摘要 t('manage.selected', { count })
// - 存在取消勾选的条目时：提示 t('manage.removeWarning', { count })；
//   点应用 -> confirming=true 显示 t('manage.confirmRemoveBody') + 「确认应用」/「再想想」；
//   再点「确认应用」才 onApply({ add, remove })，其中 add = 新勾选 - 初始 added，remove = 初始 added - 新勾选。
// - onApply 返回 Promise；失败时组件内显示 t('manage.applyFailed', { reason })（将错误映射到文案见 B.3）。
```

### B.9 `client.prompt-editor.js`
```js
export function PromptEditorView({ t, icons, markdown, api, workspace, onBack, onChanged })
// 内部状态：content、savedContent、mode('edit'|'browse')、enabled、loading、loadError、saving、enabling、
//          saveError、enableError、confirmLeave、已保存时间/状态。
// 挂载时：api.readContent(workspace.id) -> content/savedContent/enabled；默认 mode = content.trim() ? 'browse' : 'edit'。
// 顶部：左 IconBack 按钮（aria-label t('editor.backAria')）+ 名称 + 路径。
// 提示词卡片：
//   - 工具条：左 tablist（编辑/浏览，aria-selected），右 switch（role="switch" aria-checked，文案 enabled/disabled）。
//   - 编辑模式：textarea（aria-label t('editor.editLabel', {name})，placeholder t('editor.placeholder')，onChange 更新 content）
//   - 浏览模式：有内容 -> markdown.renderMarkdown(content)；空 -> t('editor.browseEmpty')
//   - 底部（仅编辑模式显示保存按钮）：左状态文案，右「保存」按钮（aria-busy，saving 时显示 t('editor.saving')）。
// 行为：
//   - enabled 切换：调 api.setEnabled；成功更新 enabled + onChanged()（父级刷新列表）；失败显示 enableError。
//   - 保存：api.saveContent；成功 savedContent=content、onChanged()、显示 t('editor.saved', { time })（本地时间）。
//   - 未保存保护：dirty = content !== savedContent。
//       点返回/切到浏览：dirty 且 !confirmLeave -> confirmLeave=true 并提示 t('editor.discardHint')（3 秒复位）；
//       confirmLeave=true 再点 -> 返回/切换并丢弃草稿（切浏览时 content 回填 savedContent）。
//   - 错误一律内联显示，不清空草稿。
```

### B.10 `client.app.js`
```js
export function WorkspacePromptApp({ t, api, useLocaleVersion, modules, close })
// useLocaleVersion() 订阅 locale 以触发重渲染。
// 状态：view = { kind: 'list' } | { kind: 'manage' } | { kind: 'edit', workspace }
//       listState { phase:'loading'|'ready'|'error', data, error }、manageState、notice。
// 挂载/回到 list 时加载 api.list()；进入 manage 时加载 api.catalog()。
// 渲染：<style>{modules.styles.STYLE_TEXT}</style>（一次性） + notice 条 + 当前视图。
// 通知 notice：{ tone:'ok'|'error', text, key }；4 秒自动消失（effect 清理），可手动关闭。
// 回调：
//   - onOpen(workspace) -> 进入 edit
//   - onManage() -> 进入 manage
//   - manage.onApply({add,remove}) -> api.apply -> 成功：notice 根据 added/removed 数量（t('manage.addedNotice')/removedNotice/changedNotice），
//     刷新 list，回 list；失败：把错误交给 manage 显示（返回 Promise 由 manage 捕获）。
//   - edit.onBack() -> 回 list 并刷新列表
//   - edit.onChanged() -> 后台刷新 list（不闪烁、不切视图）
```
- 错误文案统一：`t(errorMessageKey(err), err.details)`（如 `t('error.content-too-long', { limit })`；网络错误 `t('error.network')`）。
- 所有可见字符串必须来自 `t()`；数字/时间可用 `Intl.DateTimeFormat(localeActive, { timeStyle:'short' })`（用传入的 locale 或默认）。

---

## C. 插槽注册（client.js 已定）
- slot：`settings.section`，`id: 'dsh-workspace-prompt'`，`order: 25`，`label: () => t('settings.title')`。
- 组件 props 来自设置 shell：`{ close }` + 标准 props。不要依赖标准 props 的方法。

---

## D. i18n 键清单（zh/en 必须完全一致）
```
settings.title / settings.description / settings.loading / settings.count / settings.manage
settings.emptyTitle / settings.emptyBody / settings.loadFailed / settings.retry / settings.open / settings.openAria
settings.enabled / settings.disabled / settings.characters / settings.emptyPrompt
manage.title / manage.description / manage.loading / manage.emptyTitle / manage.emptyBody
manage.back / manage.apply / manage.applying / manage.added / manage.selected
manage.removeWarning / manage.confirmRemoveBody / manage.confirmApply / manage.confirmCancel
manage.loadFailed / manage.applyFailed / manage.addedNotice / manage.removedNotice / manage.changedNotice
editor.back / editor.backAria / editor.name? (不需要) / editor.mode / editor.edit / editor.browse
editor.enable / editor.enabled / editor.disabled / editor.placeholder / editor.editLabel
editor.save / editor.saving / editor.saved / editor.unsaved / editor.discardHint
editor.loading / editor.loadFailed / editor.saveFailed / editor.enableFailed / editor.browseEmpty
editor.characters / editor.retry
notice.dismiss
error.network / error.bad-request / error.workspace-not-found / error.not-added
error.content-too-long / error.io-failed / error.http / error.unknown
```
（client.i18n.js 已由 Lead 写首版；实现中如需新增键，必须同时补齐 zh/en 两份。）

---

## E. 测试与临时文件约定
- 测试文件放 `CreateDSHplugins/temp&test/host/`、`temp&test/client/`；用 `.mjs` 后缀（该目录无 package.json，`.js` 会被当 CJS）。
- 工作区受 Windows 沙箱限制：**测试运行时产生的临时文件写系统临时目录**（`os.tmpdir()`，该目录可写），不要把运行产物写进工作区；测试源码本身用文件工具写入。
- Host 单测直接 import 相对路径 `../../dsh-workspace-prompt/host/xxx.js`（ESM 可行）。
- Client 渲染测试：设 `globalThis.window.__ModuleLoader__` 收集 `load({id, chunk, factory})`，再 `await import(fileURL)`，用真实 React（参考 checkout 里 `node_modules/.pnpm/react@18.3.1/...`、`react-dom@18.3.1_react@18.3.1/...`、`jsdom`）渲染。
