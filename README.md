# dsh-workspace-prompt — 工作区提示词

给每个**工作区**配一份提示词，并让它在**该工作区的每一次对话开始时自动注入 Agent**。

- **入口**：**设置 → dsh-workspace-prompt**（设置面板左侧导航里的独立一页）。
  页面列出所有工作区及其启用状态与字数。
- **编辑器**：点某一行的「编辑提示词」后，编辑器**直接在设置页内打开**（不弹独立窗口）。
  左上角是**启用开关**，右上角是「**← 返回**」（回到工作区列表），中间是「**编辑 / 浏览**」两种模式。
  编辑模式可写可存；浏览模式只读、按 Markdown 渲染。
- **注入**：开关打开后，该工作区内每次对话开始都会把提示词注入 Agent 的运行时上下文，
  **不会新增对话气泡**（但它随上下文快照可见——见下文「提示词会不会出现在对话里？」）。
- **反馈**：每次成功注入后屏幕顶部弹出一条提示，**5 秒自动关闭**，右上角也可手动关闭。

> 插件在插件列表里显示的名字固定为 **`dsh-workspace-prompt`**，不随界面语言变化。

## 使用

1. 打开**设置**（侧边栏底部齿轮），在左侧导航选「**dsh-workspace-prompt**」。
2. 在列表里找到目标工作区，点右侧「**编辑提示词**」——编辑器在同一页内展开。
3. 编辑器左上角开关决定**是否启用**；切到「编辑」写 Markdown，点「保存」。
   右上角「← 返回」回到列表；**有未保存改动时第一次点会先提示，再点一次才离开**。
4. 之后在该工作区里发消息，对话开始时会自动注入；顶部提示条会报告结果。

> 列表为空？说明当前还没有任何工作区。先创建或打开一个工作区，再回到这一页。

## 文件与状态

| 路径 | 作用 |
|---|---|
| `prompt/<工作区名>.md` | 该工作区的提示词正文（Markdown） |
| `state/enabled.json` | 启用开关：`{ "<工作区id>": true }`，只记录打开的工作区 |
| `state/files.json` | 工作区 id → 文件名的持久映射（改名后文件不搬家） |

文件名取工作区标题并做净化：去掉 `\ / : * ? " < > |` 与控制字符、首尾空白与点，最长 80 字符；
标题不可用时回退到工作区 id；同标题的不同工作区依次得到 `-2`、`-3`。
提示词目录可用环境变量 `DSH_WORKSPACE_PROMPT_DIR`（须为绝对路径）覆盖。

## 注入方式

Host 半用 `ctx.systemPrompt.context()` 注册一条名为 `workspace-prompt:current` 的
**运行时上下文**，位置紧邻「当前工作目录」之前：

- 会话按 `header.cwd` 解析到所属工作区（`ctx.workspaceRegistry.resolveByPath`）；
- 只有该工作区开关为**开**且正文非空时才注入；
- 每次模型步骤都会重新求值 → 「每一次对话开始」必然带上最新内容；
- 每次求值都会在 Host 侧记一条判定记录（注入成功，或未注入的原因），
  浏览器半据此报告结果——这就是顶部提示条的信息来源。

### 提示词会不会出现在对话里？

**不会作为对话气泡出现**，正文也不占一条聊天消息。但需要如实说明一点：
DSH 会把本次请求的运行时上下文快照落进会话日志，Web 端把它渲染成一条**折叠行**
（标题形如「上下文注入 · <工作区名>」）。**展开这条折叠行就能看到提示词正文。**

这是 DSH 运行时上下文的通用行为（`working-directory` 等内置上下文同样如此），
本插件的工作区提示词沿用同一机制。如果你的场景要求正文**绝对不可见**，
请不要启用本插件——按设计它做不到这一点。

## 数据接口

浏览器半通过 Connection 已鉴权的 `/api` 通道与 Host 通信（同源 `fetch`）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/workspacePrompt/workspaces` | GET | 设置页列表：全部工作区 + 开关 + 字数（不含正文） |
| `/api/workspacePrompt/content?workspaceId=…` | GET | 读取某工作区的正文、开关、文件名 |
| `/api/workspacePrompt/save` | POST | 保存正文（`workspaceId` 或 `sessionId`） |
| `/api/workspacePrompt/enable` | POST | 切换启用开关（`workspaceId` 或 `sessionId`） |
| `/api/workspacePrompt/latest` | GET | **全局**最近一次成功注入（无入参）——提示条的数据源 |
| `/api/workspacePrompt/state?sessionId=…` | GET | 按会话读正文、开关、文件名 |
| `/api/workspacePrompt/injection?sessionId=…` | GET | 该会话最近一次注入判定结果 |

失败一律返回 `{ error: { code, message } }`，窗口把 `message` 直接显示在底部状态栏。

> 提示条走 `/latest`（**全局、无入参**），因此**不需要你先点开过任何东西**——
> 只要某个工作区启用了提示词，你在里面发消息后的注入都会被播报。
> 这是刻意设计：早期版本靠"点过某个会话行"才知道该看哪个会话，那条链已废弃。

## 文件结构

```
dsh-workspace-prompt/
├── package.json             清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml         Loader 补丁：插入一行 Host 插件
├── index.js                 Host 半入口：组装 + 注入注册 + 路由注册
├── host/
│   ├── prompt-store.js      正文读写、文件名净化与去重
│   ├── enable-store.js      state/enabled.json
│   ├── workspace-resolver.js 会话 → 工作区（同步缓存 + 异步预热）
│   ├── injection-registry.js 每次判定结果（供反馈）
│   └── api-routes.js        /api/workspacePrompt/*
├── client.js                浏览器半入口：加载子模块 + 注册设置页与提示条
├── client.settings.js       设置页：工作区列表 ⇄ 内嵌编辑器
├── client.api.js            /api 调用封装
├── client.store.js          当前编辑目标 + 提示条通知队列 + 注入账本
├── client.dialog.js         内嵌编辑器组件（`WorkspacePromptEditor`）
├── client.toast.js          注入结果提示条（唯一的浮层）
├── client.markdown.js       轻量 Markdown 渲染（不渲染原始 HTML）
├── client.icons.js          内联 SVG 图标
├── client.styles.js         `.dwp-` 样式（只用主题令牌）
├── locale/{zh,en}.json      插件显示名与说明
├── icon.svg                 插件图标
├── prompt/                  提示词正文
├── state/                   开关与文件名映射
└── docs/{PLAN.md,VERIFY.md} 工程规划与验证报告
```

> 文件名 `client.dialog.js` 是历史遗留（第一版它是模态对话框）。它现在的导出是
> `WorkspacePromptEditor`，**与浮层无关**——编辑器内嵌在设置页里。
>
> 第一版的 `client.row-action.js`（会话行行尾按钮）与旧的 `client/` 子目录都**已删除**。

`client.<名字>.js` 是**包内子模块**，不是普通源码目录：DSH 的客户端模块系统只允许
`client.<名字>.js` 这种命名，并要求它们与 `client.js` 一样放在**包根**，由 `client.js`
通过 `require.async('./client.<名字>.js')` 加载。因此本插件**零构建**——不需要打包器。

## 依赖的宿主扩展点

- `settings.section`（设置面板的一页；由 `@deepseek-ai/dsh-client-ui-settings` 声明）
- `shell.overlay`（窗口与提示条）

两者都是 DSH **已官方声明**的插槽，因此本插件**不修改 deepseek-harness 的任何文件**。

> 说明：工作区行 “...” 菜单（含「重命名 / 删除工作区」）在 DSH 中是**硬编码且未声明槽位**的，
> 工作区行本身也没有任何槽位（`ProjectRowItem` 里一次 `renderSlot` 都没有），
> 而插槽系统只允许注册到已声明的槽位。所以侧边栏里**挂不上**工作区级的按钮，
> 入口因此放在设置面板里。

## 卸载

在 Plugins 页面移除本 bundle 即可：Host 半的提示词上下文与七条路由随 Cordis effect 一起注销，
浏览器半的设置页、窗口与提示条随之消失；`prompt/` 与 `state/` 下的文件保留在原地。
