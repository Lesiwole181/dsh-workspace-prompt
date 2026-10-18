# dsh-workspace-prompt（工作区提示词）

给每个**工作区**维护一份 Markdown 提示词，并在启用后让它在该工作区**每次对话开始时自动注入 Agent**——不会新增对话气泡。

- **入口**：设置 → 侧边栏「工作区提示词」。
- **列表**：只显示**添加进此界面**的工作区；列表框右上方（与设置面板右上角「打开配置文件」对齐）的「管理工作区」按钮可批量添加/移除（移除会同时删除其提示词）。
- **编辑**：点击列表中的任一工作区进入「管理该工作区的提示词」：
  - 左上角「← 返回」回到列表；
  - 提示词框右上角是**启用开关**；
  - 支持「编辑 / 浏览」两种模式：编辑模式写 Markdown，**保存按钮在提示词框右下角**；浏览模式只读并按 Markdown 渲染；
  - 每行/每页文案均支持**中文 / English**。
- **注入**：开关打开且正文非空时，在该工作区的所有会话中，每次对话开始都会把提示词作为运行时上下文注入 Agent。提示词不会出现在对话气泡里；DSH 的会话日志/检查视图会保留运行时上下文快照（见下文说明）。

> **插件显示名**：在「设置 → 插件」等插件界面里，本插件的显示名固定为 **`dsh-workspace-prompt`**，中文/English 两种语言模式下都相同；插件自己的设置页标题和侧边栏入口仍是「工作区提示词 / Workspace prompt」。

## 安装

本插件是一个标准 DSH bundle（`package.json` 的 `dsh.bundle.patch` + `dsh.client`），零第三方依赖、零构建。

### 方式 A：插件管理器（推荐）

1. 打开 DSH 设置 → 插件（Plugins）；
2. 添加并安装本地目录 `E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt`（或通过 DSH 的插件安装入口安装该目录）；
3. 安装完成后刷新页面，设置里即出现「工作区提示词」。

> 安装会由 DSH 的插件管理器写入当前 profile（web / desktop 各自 profile 需分别安装一次），不会修改 deepseek-harness 本体文件。

### 方式 B：命令行（仅 Web profile）

```powershell
dsh plugin --profile web add E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt
```

> **Desktop 例外**：`profiles/desktop` 由 Electron 应用独占管理，命令行安装不会被应用启用。
> 请在 **Desktop 应用 → 设置 → 插件** 中安装同一目录 `E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt`。

## 使用

1. 打开**设置**（侧边栏底部齿轮）→ 左侧「**工作区提示词**」。
2. 首次使用点列表框右上方的「**管理工作区**」（与设置面板右上角「打开配置文件」对齐），勾选要管理的工作区 →「应用」。
3. 回到列表，点击任一工作区：
   - 点「编辑」写提示词，点右下角「保存」；
   - 点「浏览」查看 Markdown 渲染效果；
   - 打开提示词框右上角开关以启用注入；
   - 左上角「← 返回」回到列表。
4. 在该工作区里发消息，对话开始时提示词即被注入（无需任何额外操作）。

> 列表为空？说明还没有添加工作区：先用「管理工作区」勾选，或先在侧边栏创建/打开一个工作区。

## 数据与配置

| 路径 | 作用 |
|---|---|
| `prompt/<工作区名>.md` | 每个工作区的提示词正文（UTF-8 Markdown） |
| `state/workspaces.json` | 已添加的工作区、文件名映射、添加时间 |
| `state/enabled.json` | 启用开关（只记录打开的） |

- 目录默认在**插件包根**下（即 `...\dsh-workspace-prompt\prompt\`、`...\state\`），不存在时自动创建。
- 文件名由工作区名净化生成；同名工作区自动追加 `-2`、`-3`；工作区改名不会移动文件（映射保存在状态文件里）。
- 可选配置（写入 profile 的 `cordis.patch.yml`，覆盖插件行 config）：
  ```yaml
  - id: dsh-workspace-prompt
    config:
      promptDirectory: 'D:\my-prompts'   # 绝对路径，默认 <插件包根>/prompt
      stateDirectory: 'D:\my-prompts-state'
  ```
- 也可用环境变量 `DSH_WORKSPACE_PROMPT_DIR`（绝对路径）覆盖提示词目录。

## 提示词会出现在对话里吗？

**不会作为对话气泡出现**，也不占一条聊天消息。但需要如实说明：DSH 会把本次请求的**运行时上下文快照**写进会话日志（会话日志是唯一事实来源），Web 端在 Chat 视图**不显示普通 context 行**；在 Trajectory / 会话日志检查视图里可以看到快照内容。这是 DSH 运行时上下文的通用行为（内置的「当前工作目录」等上下文同样如此），不是本插件额外添加的对话行。

## 兼容性

- 面向 DeepSeek Harness **0.2.1-rc.2** 开发；Web 与 Desktop 使用同一套 Client 模块体系与 Host 服务，因此同一插件包在两端通用（各自 profile 安装一次）。
- 只用公开扩展点：`settings.section` 插槽、`ctx.systemPrompt.context()`、`ctx.connection.fetch`、`ctx.workspaceRegistry`；**不修改 deepseek-harness 本体**。
- 零第三方依赖（Host 只用 Node 内置模块，Client 只用平台 `react`），降低未来 DSH 升级的破坏面；状态文件与 HTTP 响应带 `version: 1`，读取端容错。

## 常见问题

- **设置侧边栏看不到「工作区提示词」**：先关闭并重新打开设置面板；仍看不到则刷新页面（Client 部分由浏览器的模块表加载，页面需要重新加载才会挂载）。若仍缺失，检查「设置 → 插件」里本插件是否已安装并启用。
- **刚更新过插件文件后行为没变**：Client chunk 需要页面重新加载才能生效（Host 会通过 HMR 重新发布，通常自动重载插件；否则刷新页面即可）；Host 半的数据接口无需重启。

## 卸载

在插件管理页移除本 bundle 即可：Host 的运行时上下文/路由、Client 的设置页随插件卸载消失；`prompt/` 与 `state/` 数据保留在原地（可手动备份或删除）。

## 开发与测试

- 结构：`index.js`（Host 组装）、`host/`（9 个模块）、`client.js`（Client 入口）、`client.*.js`（chunk 模块）、`docs/`（规划 / 契约 / 架构 / API / 验证）。
- 详见 `docs/ARCHITECTURE.md`、`docs/API.md`、`docs/CONTRACTS.md`。
- 本插件无需构建：Client chunk 由 DSH 的 Client 模块表直接加载。
- 测试文件在工程上级目录的 `CreateDSHplugins/temp&test/`（不随插件包发布）。
- 验证记录与复跑命令见 `docs/VERIFY.md`（含 live 安装、插槽注册、真实会话注入 E2E 与会话日志证据）。

## License

MIT
