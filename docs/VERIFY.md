# 验证报告（VERIFY）

> 插件：`dsh-workspace-prompt` 1.0.0
> 验证日期：2026-10-17
> 验证环境：DeepSeek Harness 0.2.1-rc.2（Desktop 应用内嵌运行时），profile `web`，Web GUI `http://127.0.0.1:3080`；参考源码 checkout `D:\deepseek-harness`
> 约束遵守：未修改 deepseek-harness 任何文件

## 1. 结论摘要

| 项目 | 结果 |
|---|---|
| 静态检查（语法/manifest/chunk/依赖/安全模式） | **PASS** |
| Host 单元 + 路由测试（实现者套件，Lead 复跑） | **106 pass / 0 fail**（10 文件） |
| Host 独立测试（verifier 自写） | **48 pass / 0 fail** |
| Client jsdom 全套（verifier 自写，真实 React 18.3.1） | **20 pass / 0 fail** |
| Client harness 冒烟 | **2 pass / 0 fail** |
| 需求 R1–R13 逐条核对 | **13/13 PASS**（视觉像素级布局：见 §6 边界） |
| 实际安装到 web profile | **application: applied**，`warnings: []` |
| Live Client 插槽注册 | **PASS**（occupant `dsh-workspace-prompt`，order 25，active） |
| Live Host 插件激活 | **PASS**（Loader 行 `dsh-workspace-prompt` 生效） |
| Live 注入端到端（真实会话 + 会话日志） | **PASS**（见 §4） |
| Desktop | 同一运行时 + 同一 Client 模块体系；Desktop profile 由 Electron 独占管理，安装路径见 §5；未在 Desktop 进程内 live 验证 |

独立验证报告（verifier）：`CreateDSHplugins/temp&test/reports/verification.md`

## 2. 安装验证

安装动作：`plugin_manager install_bundle`，目标本地目录 `E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt`。

```json
{
  "stage": "enable", "target": "dsh-workspace-prompt", "enabled": true, "changed": true,
  "application": "applied",
  "bundle": "dsh-workspace-prompt", "version": "1.0.0",
  "warnings": []
}
```

安装后 profile 状态（`C:\Users\Lesiw\.dsh\profiles\web\package.json`）：
- `dependencies` 增加 `"dsh-workspace-prompt": "link:E:/DSHworkspaces/CreateDSHplugins/dsh-workspace-prompt"`；
- `dsh.profile.bundles` 增加 `"dsh-workspace-prompt"`。

安装生效后 Host 激活时自动创建了运行时目录：
- `dsh-workspace-prompt/prompt/`
- `dsh-workspace-prompt/state/`

## 3. Live 注册验证（无浏览器控制，使用官方 Inspect Provider）

### 3.1 Client：设置页入口已注册
`cordis_inspect_query` → client `Slots.listSubTree(root='settings.section')`：

```
occupants:
  { registrant: "Kb", id: "general", order: 0, active: true }
  ...
  { registrant: "dsh-workspace-prompt", id: "dsh-workspace-prompt", order: 25, priority: 0, active: true }
```

→ 插槽注册成功且处于 active，说明 Client 半 chunk 全部加载、`client.js` 注册未抛错。

### 3.2 Host：插件行已被 Loader 装载
`cordis_inspect_query` → host `Config.listConfigs(name='dsh-workspace-prompt')`：

```
entries: [{ id: "include:dsh-workspace-prompt", patchId: "dsh-workspace-prompt",
            name: "dsh-workspace-prompt", status: "absent" }]
```

→ `status: "absent"` 表示该插件没有导出 Config schema（符合设计），插件行是 live 条目，Host 半已激活。

`plugin_manager list_plugins`（paged，offset=190）进一步确认 Loader 运行态：

```
{ entryId: "include:dsh-workspace-prompt", moduleName: "dsh-workspace-prompt",
  enabled: true, fiberPhase: "active", patchId: "dsh-workspace-prompt" }
```

→ `fiberPhase: "active"` 说明 Host 插件真实激活（而不只是被写入配置）。

## 4. Live 注入端到端验证（核心需求 R8 / R9）

### 4.1 正向：启用后注入真实会话
为当前工作区（workspace id `336f7fe2-076a-410a-a93a-118d2a80bb86`，path `E:\DSHworkspaces\CreateDSHplugins`）写入：
- `prompt/CreateDSHplugins.md`（含唯一标记 `DWP-LIVE-E2E-MARKER-2026-10-17T22:16`）
- `state/workspaces.json`（added 集合包含该工作区）
- `state/enabled.json`（该工作区 enabled）

下一个模型步骤的运行时上下文立即出现注入内容（模型侧可见原文）：

```
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.
Current working directory: "E:\\DSHworkspaces\\CreateDSHplugins".
...
Workspace prompt for workspace "CreateDSHplugins". The user configured this prompt for the whole
workspace; apply it in addition to the system instructions.

DWP-LIVE-E2E-MARKER-2026-10-17T22:16
...
```

### 4.2 持久化形态：会话日志中的事件
当前会话 `session-2a29ac31-6108-4f77-b10f-9778be732d5a` 的持久日志
`C:\Users\Lesiw\.dsh\sessions\--E-DSHworkspaces-CreateDSHplugins--\session-2a29ac31-.../session.v4.jsonl.zstd`
（613 个 zstd frame / 1004 条事件）解码后找到：

```
{ "seq": 956, "type": "user/message", "surfaceOp": "append",
  "sourceKind": "runtime-context", "blocks": ["text"], "hasMarker": true }
```

→ 提示词以 **`runtime-context` 来源的运行时上下文快照**进入会话日志与模型上下文，**不是用户消息/助手消息**。

### 4.3 "不显示在对话中"的依据
DSH 源码 `D:\deepseek-harness\packages\client\ui-chat\src\client\contract\chat-visibility.ts`：

```ts
export function isVisibleChatNode(node: ChatNode): boolean {
  return node.visibility === 'visible'
    && node.kind !== 'system-prompt'
    && (node.kind !== 'context'
      || node.data.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal'))
    && !(node.kind === 'command' && node.data.name === 'permission')
}
```

→ Chat 视图不渲染普通 `context` 行（只有工具变更类 context 才保留通知行），因此工作区提示词**不会形成对话气泡/对话行**。运行时上下文快照仍按 DSH 设计保存在会话日志中（Trajectory/日志检查可见），已在 README 如实说明。

### 4.4 负向：移除/关闭后不再注入
清理 added 集合与启用标记后，下一个步骤运行时上下文更新为不含提示词（内容消失），确认：
- 未 added → 不注入；
- 未 enabled → 不注入；
- 正文为空 → 不注入（单元测试覆盖）。

### 4.5 清理
- `state/workspaces.json` → `{ "version": 1, "workspaces": [] }`
- `state/enabled.json` → `{ "version": 1, "enabled": {} }`
- 端到端测试用提示词文件已删除（避免占用自然文件名）。
- 插件保持安装在 web profile（交付状态）。

## 5. Web 与 Desktop 适配

### 5.1 事实依据
- 当前运行时的 dsh CLI 来自 Desktop 应用内嵌运行时：`D:\DeepSeekHarnessDesktop\resources\runtime\cli\bin\dsh.cmd` → `DeepSeek Harness.exe ... app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`；Web GUI 即该运行时提供的页面。
- Web 与 Desktop 使用**同一套** Client 模块体系（`window.__ModuleLoader__` + `dsh.client`）与 Host 服务（`settings.section` / `systemPrompt.context` / `connection.fetch` / `workspaceRegistry`）。
- 插件不依赖浏览器专有 API，不读取宿主 DOM，视觉只用主题令牌；Client 组件可在 React 18 下服务端渲染/在 jsdom 渲染（已测）。

### 5.2 Desktop 安装路径
`C:\Users\Lesiw\.dsh\profiles\desktop` 由 Electron 应用**独占管理**（`dsh --profile desktop --dump-config` 返回
`error: profile "desktop" is managed exclusively by the Electron application`）。
因此 Desktop 端应在 **Desktop 应用的 设置 → 插件（Plugins）** 中使用其内置插件管理器安装同一目录
`E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt`（与 Web 端相同的 `plugin_manager` 安装路径与包清单）。

> 验证过程中曾用 `dsh plugin --profile desktop add` 试探 CLI 安装（只写入依赖、未启用 bundle，属半安装），
> 已立即用 `pnpm remove` 撤销；Desktop profile 已恢复原状（仅保留原有 `dsh-session-manager` 依赖）。

### 5.3 边界
未启动独立 Desktop profile 宿主进程，因此 **Desktop 实机 UI/注入未 live 验证**；结论基于同一运行时、同一模块体系、无 Web 专有 API 的静态兼容论证 + 安装路径说明。

## 6. 测试与静态检查明细

### 6.1 语法与清单
- 全部 20 个 JS 文件 `node --check` 通过（含 9 个 `client.*.js` chunk、`client.js`、`index.js`、9 个 host 模块）。
- `package.json` 合法；`exports`（`. / ./client / ./locale/*.json / ./icon`）与 `files` 覆盖全部运行时文件。
- 每个 client chunk 的 `id: 'dsh-workspace-prompt'`、`chunk: '<文件名>'` 正确。
- icon 为合法 SVG（≤256KiB，未使用外部 URL/绝对路径）。

### 6.2 依赖与安全模式
- 无 `@deepseek-ai/*` import；Host 仅 `node:` 内置模块；Client 仅 `require('react')`。
- 无 JSX、无 `createPortal`、无 `document.body` 操作、无 `dangerouslySetInnerHTML`。
- Markdown 不解析原始 HTML；链接白名单（http/https/mailto/相对）；`javascript:` 保持纯文本（jsdom 实测无脚本执行）。
- 路径穿越全链路防护：`sanitizeWorkspaceName` + `isSafePromptFileName`；`../escape.md` 无法读/写/删目录外文件（verifier 实测）。
- 注入文本 `interpolate: false`，正文中的 `{{...}}` 不会被当作提示词变量解析。

### 6.3 单元/集成测试
| 套件 | 文件/命令 | 结果 |
|---|---|---|
| Host（实现者） | `node temp&test/host/<file>.test.mjs`（逐文件；沙箱下 `node --test` 的 runner 子进程 spawn 受限） | 106 pass / 0 fail |
| Host（verifier 独立） | `node temp&test/host/verify-host-core.test.mjs`、`verify-host-service.test.mjs` | 48 pass / 0 fail |
| Client（verifier 独立，jsdom + 真实 React 18.3.1 + react-dom 18.3.1） | `node temp&test/client/verify-client.test.mjs` | 20 pass / 0 fail |
| Harness 冒烟 | `node temp&test/client/verify-harness-smoke.test.mjs` | 2 pass / 0 fail |
| 静态检查（verifier） | `node temp&test/client/verify-static.mjs` | 20 PASS / 0 FAIL / 2 WARN |

覆盖：文件名净化/去重/保留名/长度、JSON 容错读与原子写/缓存失效、cwd→工作区（精确/包含/大小写/未归属）、apply 批量 diff（增/删/忽略/交集 400/1000 上限）、保存长度上限 200000、6 条路由的状态码/`version:1`/`cache-control: no-store`、注入判定矩阵与异常兜底、index 装配 E2E（add→save→enable→context.text）。

Client 覆盖：设置页注册（id/order/label）、列表（空/加载/错误+重试/行点击）、管理工作区（默认勾选、批量 diff、删除二次确认、apply 请求体精确比对、失败内联+重试）、编辑器（返回左上/开关右上/保存右下、默认模式、模式切换、保存/开关请求体、未保存两击保护、失败保留草稿）、Markdown XSS 安全、zh/en 切换、notice、根内唯一 `<style>`。

### 6.4 主题令牌
样式只用 `--dsw-alias-*` / `--dsw-specific-*` 颜色令牌 + `--dsw-radius-*` 圆角令牌；逐项对照 checkout 的 `ui-theme/src/styles/design-platform.css` / `base.css` 确认存在；无写死颜色。
（WARN：`--dsw-radius-md/sm` 不在 CONTRACTS 早期约定的 alias/specific 前缀清单内，但它们是真实主题令牌，不影响渲染。）

## 7. 需求逐条核对（R1–R13）

| 需求 | 结果 | 证据 |
|---|---|---|
| R1 设置侧边栏「工作区提示词」入口 | PASS | Live 插槽 occupant（§3.1）+ jsdom 注册断言 |
| R2 列表只显示"添加进界面"的工作区 | PASS | `/list` 只返回 added 集合；Host/Client 测试 |
| R3 列表框右上方「管理工作区」（与「打开配置文件」对齐）+ 批量添加/删除（删提示词）；空列表框内无按钮 | PASS | 列表头部行按钮（右缘内缩 26px 对齐设置面板头部动作）；manage 视图勾选/二次确认/apply diff；移除删文件+清开关（Host 测试）；空态无按钮（jsdom 断言） |
| R4 点击工作区进入提示词管理界面 | PASS | 整行 button → App 切换 edit 视图；jsdom 点击断言 |
| R5 编辑/浏览两模式；保存按钮提示词框右下角 | PASS | 编辑 textarea / 浏览 Markdown；footer 右侧「保存」；jsdom 结构断言（真实像素布局未截图，见 §8） |
| R6 「返回」在管理界面左上角 | PASS | 编辑器 header 左侧返回按钮 |
| R7 启用开关在提示词框右上角 | PASS | 卡片工具条右侧 `role="switch"` `aria-checked` |
| R8 启用后每次对话开始注入、不显示在对话中 | PASS | Live 注入 + 会话日志 `runtime-context` 事件 + Chat 可见性源码（§4） |
| R9 路径 `dsh-workspace-prompt/prompt/<workspace_name>.md`，目录自动创建 | PASS | 默认目录 `<包根>/prompt`；激活时 `mkdir -p`（§2）；文件名=净化后的工作区名；映射持久化防改名丢失 |
| R10 适配 web 与 desktop | PASS（Web live；Desktop 静态兼容+安装路径） | §5 |
| R11 未来 DSH 兼容策略 | PASS | 只用公开扩展点、零第三方依赖、防御式服务接入、版本化状态/接口、测试锁定契约（ARCHITECTURE §6） |
| R12 模块化/低耦合/命名易懂 | PASS | Host 9 模块、Client 10 模块、单向依赖（ARCHITECTURE §1） |
| R13 中英文 | PASS | `client.i18n.js` zh/en 各 65 键完全一致；`locale/{zh,en}.json` meta；jsdom 中英切换断言 |

## 8. 未验证项与边界（如实声明）

1. **真实浏览器视觉布局**：无浏览器自动化/截图能力，未做像素级视觉验收；以 live 插槽注册 + jsdom DOM 结构 + flex 规则 + 主题令牌核对替代。未伪造截图。
2. **Desktop 实机**：Desktop profile 由 Electron 独占管理，未启动独立 Desktop 宿主；见 §5.3。
3. **定时器时序**：未保存提示 3s 复位、notice 4s 自动消失，未做真实时钟端到端计时（逻辑单测覆盖）。
4. **多进程并发**：web 与 desktop 同时运行共享同一插件目录的并发写场景未实测；实现层以原子写 + mtime 读缓存 + 过程内串行化应对。
5. **io-failed 技术原因**：`details.reason` 只返回给已鉴权客户端、界面不展示技术细节；不影响用户可见错误提示。

## 9. 复跑方式

```powershell
cd E:\DSHworkspaces\CreateDSHplugins
# Host（逐个直接执行，绕开沙箱 node --test runner 限制）
Get-ChildItem 'temp&test\host\*.test.mjs' | Sort-Object Name | ForEach-Object { node $_.FullName }
# Client（jsdom + 真实 React）
node "temp&test/client/verify-client.test.mjs"
node "temp&test/client/verify-harness-smoke.test.mjs"
node "temp&test/client/verify-static.mjs"
```

## 10. UI 修订（2026-10-18，UI revision 2）

用户要求：
1. 「管理工作区」按钮从页面顶部工具栏**向下、向左**移动，放到列表框右上方，并与设置面板头部「打开配置文件」按钮对齐；
2. 列表框内没有任何已添加工作区时，框内不再显示「管理工作区」按钮。

### 10.1 实现
- `client.workspace-list.js`：视图顺序改为 `说明文案 → div.dwp-list-head（左：数量；右：管理工作区按钮）→ 列表框/空态`；空态 `.dwp-empty` 内只保留标题与说明，不再渲染按钮。
- `client.styles.js`：新增 `.dwp-list-head` 规则，`padding-right: 26px` 让按钮右缘与面板头部动作对齐；删除旧 `.dwp-toolbar*` 规则。
- 对齐量推导（运行时版本 `dsh --version` = 0.2.1-rc.2，与源码 checkout 一致）：
  头部右 padding 14px + 关闭按钮 28px + 头部 gap 8px = 内容列右缘内 50px；
  本页内容区已含 `.options` 左右 24px padding，故按钮再内缩 50 − 24 = **26px**。
  该常量只在 `.dwp-list-head` 一处，未来若设置面板 chrome 改变只需改这个值。
- `client.i18n.js`：空态文案由「点击右上角…」改为「点击右上方…」/「above the list…」。
- `client.js`：注释更新（同时改变 entry bundle 的 artifact 版本，使 Client 模块系统/HMR 重新发布新 chunk URL）。
- 文档同步：README（中/英）、PLAN R3 与 §7.1、CONTRACTS B.7、VERIFY 本表。

### 10.2 验证
- **jsdom + 真实 React 18.3.1**（`temp&test/client/verify-client.test.mjs`）：**20 pass / 0 fail**，新增断言：
  - 列表视图子节点顺序严格为 `dwp-hint → dwp-list-head → dwp-list`（按钮位于列表框右上方）；
  - 样式表包含 `.dwp-list-head { ... padding-right: 26px }`（与头部动作对齐）；
  - 空列表时 `.dwp-empty button` 数量为 0，唯一入口在 `.dwp-list-head-actions`，点击可进入管理工作区视图。
- **静态检查**（`verify-static.mjs`）：20 PASS / 0 FAIL / 1 WARN（已知的 radius 令牌前缀警告）；新增结构类名 `.dwp-list-head*` 与对齐常量检查。
- **Host 全套**：154 pass / 0 fail（本次仅改 Client，回归通过）；harness 冒烟 2/2。
- **Live（实际 Host）**：通过 `/plugins/events` SSE 读取当前 Client 图，本插件 entry rev 已更新为 `de99c5616712`（HMR 检测到 `client.js` 变化并重新发布）；按该 rev 请求实际提供的 chunk：
  - `client.workspace-list.js`：含 `dwp-list-head`，不再含 `dwp-toolbar`；空态区域不再含 manage 按钮代码；
  - `client.styles.js`：含 `.dwp-list-head` 且 `padding-right: 26px`；
  - `client.i18n.js`：含「点击右上方」，不再含旧文案。
  说明 Host 已按新版本提供资源；正在打开的设置页会由 HMR 重载该插件，若未即时更新，关闭并重新打开设置（或刷新页面）即可看到新布局。

### 10.3 边界
仍无浏览器像素级截图能力：按钮像素位置以「26px 对齐常量 + DOM 顺序 + jsdom/静态断言」验证，未做真人视觉截图。

## 11. UI 修订 3（2026-10-18）：插件显示名固定为 `dsh-workspace-prompt`

用户要求：把本插件在插件界面显示的插件名改为 `dsh-workspace-prompt`，无论中英文模式都统一显示这个名字。

### 11.1 实现
- `locale/en.json`、`locale/zh.json` 的 `meta.title` 均改为固定字符串 `"dsh-workspace-prompt"`（此前是「Workspace Prompt / 工作区提示词」的本地化标题）。
- `meta.description` 保留中英文本地化文案；`package.json` 的 `name` 本来就是 `dsh-workspace-prompt`。
- 插件自己的设置页导航/标题（Client 词典里的 `settings.title`）**保持不变**，仍为「工作区提示词 / Workspace prompt」——用户只要求插件界面里的插件名统一。
- 显示链路（DSH 0.2.1-rc.2 源码）：
  - Host：`packages/boot/app-boot/src/package-meta.ts` 的 `readPluginMeta()` 读取 `<包>/locale/*.json`，把标题/描述汇总为按语言的 `LocalizedText`；
  - Client：`packages/client/ui-plugin-manager/src/client/presentation.ts` 的 `packageText()` / `rowText()` 用 `resolveText(meta.title)` 按当前语言解析，标题缺失时才回退到包名。
  - 因此两个 locale 文件都写成同一字符串后，zh/en 两种模式都会显示 `dsh-workspace-prompt`。

### 11.2 验证
- **导出资源检查（9 PASS / 0 FAIL）**：`package.json` name；`./locale/*.json` 导出；`locale/en.json` 与 `locale/zh.json` 的 `meta.title` 均为 `dsh-workspace-prompt` 且完全一致；两份 `meta.description` 均非空且仍为各自语言。
- **真实 DSH 元数据读取器验证**（使用与本机运行时同版本 0.2.1-rc.2 的 `app-boot` 构建，实际解析 profile 中已安装的插件包）：
  ```
  readPluginMeta('dsh-workspace-prompt', 'file:///C:/Users/Lesiw/.dsh/profiles/web/')
  → {
      title: { en: 'dsh-workspace-prompt', zh: 'dsh-workspace-prompt' },
      description: { en: '…', zh: '…' },
      icon: 'data:image/svg+xml;base64,…'
    }
  ```
  即 Host 侧提供给插件管理界面的元数据已固定为同一名称（图标也仍能解析）。
- **回归**：静态检查 20 PASS / 0 FAIL / 1 WARN（已知 radius 令牌提示）；Client jsdom 20 pass / 0 fail；Host 154 pass / 0 fail（本次仅改 locale 元数据）。没有测试断言旧的本地化插件标题。
- **生效方式**：插件元数据由 Host 按需读取（`PluginPackages.metaOf` 每次调用 `readPluginMeta`），无需重启 Host；重新打开（或刷新）「设置 → 插件」页面即可看到新显示名。

### 11.3 边界
无浏览器 DOM 截图能力，未做插件管理页的视觉截图；结论基于「导出的 locale 元数据 + 同版本 DSH `readPluginMeta` 的真实解析结果 + 插件管理页源码的标题解析链路」。

## 12. UI 修订 4（2026-10-18）：管理工作区视图按钮调整

用户要求：
1. 「管理工作区」界面的「应用」按钮向左移动合适距离，使排版更美观，功能不变；
2. 「管理工作区」界面的「取消」按钮改为「返回」按钮，功能不变。

### 12.1 实现
- **应用按钮左移**：把上一次 UI 修订中只在列表视图使用的 26px 右内缩提成共享自定义属性 `--dwp-action-inset: 26px`（定义在 `.dwp-root`；推导见 §10.1：头部右 padding 14 + 关闭按钮 28 + 头部 gap 8 − 内容列 padding 24）。`.dwp-list-head` 与 `.dwp-manage-head` 都使用 `padding-right: var(--dwp-action-inset, 26px)`，于是管理工作区视图的「应用」按钮右缘从内容列边缘**向左移 26px**，与列表视图「管理工作区」按钮及设置面板头部「打开配置文件」对齐；仅改样式，`submit()` 逻辑与禁用条件未变。
- **取消 → 返回**：i18n 键 `manage.cancel` 重命名为 `manage.back`（zh 值 `返回`、en 值 `Back`），`client.manage-workspaces.js` 头部左侧按钮改用 `t('manage.back')`；点击仍调用同一个 `onCancel` 回调（返回列表、不应用、不发请求）。确认面板里的 `manage.confirmCancel`（再想想 / Go back）不属于此次要求，保持不变。
- 相关文件：`client.manage-workspaces.js`、`client.styles.js`、`client.i18n.js`、`client.js`（注释/artifact revision）。

### 12.2 验证
- **jsdom + 真实 React 18.3.1**：`temp&test/client/verify-client.test.mjs` **20 pass / 0 fail**，更新/新增断言：
  - 管理工作区视图头部子节点顺序与文案：`back(返回)` → `title` → `apply`；「应用」在无变更时仍禁用（功能不变）；
  - 样式表包含共享 `--dwp-action-inset: 26px`，且 `.dwp-manage-head` 与 `.dwp-list-head` 都用 `padding-right: var(--dwp-action-inset`（应用按钮左移、与列表按钮对齐）；
  - 点击头部左侧按钮会返回列表且不产生 `apply` 请求（功能不变）。
- **静态检查**：20 PASS / 0 FAIL / 1 WARN（已知 radius 令牌提示）。为合法支持插件自有的 `--dwp-action-inset`，校验脚本区分「主题令牌」与「本样式表内自定义属性」。
- **i18n**：zh/en 各 65 键、键集合一致；`manage.back` 两语言分别存在，旧 `manage.cancel` 已不存在。
- **Host 回归**：本次只改 Client，Host 154 pass / 0 fail（未受影响的既有套件）。
- **Live（实际 Host）**：`/plugins/events` 读到的本插件 entry rev 已由 HMR 更新为 `5dd66ac698b9`；按新 rev 实际提供的 chunk 验证：
  - `client.manage-workspaces.js` 含 `manage.back`、不含 `manage.cancel`；
  - `client.i18n.js` 含「返回」与 `manage.back` 键、不再含 `manage.cancel` 键；
  - `client.styles.js` 含 `--dwp-action-inset: 26px`，且 `.dwp-manage-head` 使用 `padding-right: var(--dwp-action-inset…)`。
  说明 Host 已在提供新版资源；正在打开的设置页会由 HMR 重载插件，若未即时更新，关闭并重新打开设置（或刷新页面）即可看到。

### 12.3 边界
无浏览器像素级截图能力：按钮移动距离以「共享 26px 内缩常量 + CSS 规则断言」验证；未做真人视觉截图。

## 13. 故障排查与修复（2026-10-18）：设置侧边栏「工作区提示词」入口消失

### 13.1 现象
用户在设置侧边栏找不到「工作区提示词」。

### 13.2 排查
- `cordis_inspect_query` → client `Slots.listSubTree(root='settings.section')`：occupants 只剩 account/general/models/plugins/agent-presets/dsh-session-manager，**`dsh-workspace-prompt` 条目缺失**（Host 侧插件仍是 active、数据面正常，问题只在浏览器端 Client 半未注册）。
- `/plugins/events` 读到 Client 图：本插件 entry rev 仍为 `5dd66ac698b9`；按该 rev 请求全部 chunk 均 200 且内容有效（此时磁盘上的文件已经是修好的版本）。

### 13.3 根因
上一轮 UI 修订过程中，`client.js`（entry bundle）被修改以更新注释/artifact 版本时，`client.styles.js` 曾短暂处于无效 JS 状态（模板字符串里误用了反引号，`node --check` 报 `Invalid left-hand side expression in postfix operation`）。时序：
1. `client.js` 的 stat 变化被 Host 的 client-module HMR watch 检测到 → `clientModules.rebuilt()` → 页面收到 `rebuilt` 事件 → `entries.reload()` 重新加载插件；
2. 插件的 `apply()` 通过 `require.async` 加载 chunk 时命中了当时无效的 `client.styles.js`，chunk 加载失败；
3. `client.js` 的 `apply()` catch 该错误并记录日志后 return，因此 **没有注册 `settings.section`**；
4. 之后 chunk 文件被修好，但 HMR 只监视 entry bundle（`client.js`）的 stat，chunk 文件修复不会触发再次 reload，于是该页面一直停留在"未注册"状态。

结论：这是开发过程中"entry 版本已更新、但被加载的 chunk 瞬时无效"的竞态，不是 Host 数据或安装问题；用户正常安装使用不会遇到，但热更新期间可能出现。

### 13.4 修复
- 保持全部 chunk 有效（已用 `node --check` 与静态/jsdom 测试锁定）；
- 在 `client.js` 增加一段 recovery 注释（同时改变 entry 的 artifact 版本）→ Host HMR 重新发布 → 页面再次 reload 插件：
  - 新 Client 图：`graph rev = 54d15d06d15e`，本插件 `entry rev = 8fa8df246d06`（与故障时的 `5dd66ac698b9` 不同，说明 rebuilt 已发生）；
  - 再次查询 `settings.section`：occupant **`dsh-workspace-prompt` 已恢复（order 25, active: true）**，即设置页入口重新出现。
- 若某个已打开的页面仍不显示（HMR 通道断开等），刷新页面即可从新的 boot manifest 重新加载；Host 无需重启。

### 13.5 预防
- README 增加「常见问题」：侧边栏入口缺失时先关闭/重开设置、再刷新页面；更新插件文件后 Client chunk 需要页面重新加载；
- 开发约定（已写入 `client.js` 注释）：修改 Client chunk 时保持文件语法有效；修复 chunk 后如页面已错过 reload，需再次 bump entry artifact 版本或刷新页面。

### 13.6 边界
仍无法读取浏览器控制台/DOM；结论基于 live 插槽状态、Client 图 revision 与 chunk 请求结果、以及本轮编辑时序的复盘。




