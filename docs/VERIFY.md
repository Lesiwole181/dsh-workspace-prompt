# dsh-workspace-prompt 验证报告

> 逐条对照 `docs/PLAN.md` 的验收标准。**每条都给出实际证据与「未验证项」**，
> 不含"安装成功即视为可用"这类推断。
>
> 本报告覆盖**两轮**：第一轮交付（会话行入口）与第二轮改造（迁移到设置页 + 提示脱离点击依赖）。

## 0. 结论摘要

| 项 | 状态 |
|---|---|
| 安装 | ✅ 从 `E:\…\dsh-workspace-prompt` 安装；profile 的 junction 指向该路径且哈希一致 |
| 静态契约 | ✅ 67/67（`temp&test/diag-enable.mjs`） |
| Host 端到端 | ✅ 43/43（`temp&test/find-unbalanced.js`） |
| 存储与热路径 | ✅ 14/14（`temp&test/check-package.js`） |
| 文件名安全 | ✅ 27/27（`temp&test/check-filename-safety.mjs`） |
| Client 半行为 | ✅ 37/37（`temp&test/client-check.mjs`，配 `client-harness.mjs`） |
| 浏览器槽位实况 | ✅ 设置页 occupant `active: true`；浮层上只剩提示条 |
| 显示名固定 | ✅ zh/en 的 `meta.title` 都是 `dsh-workspace-prompt`，且等于包名 |
| 废弃文件清理 | ✅ 11 个不再使用的文件/目录已删除（见 §9） |
| 不改 DSH 本体 | ✅ `git -C D:\deepseek-harness status --porcelain` 输出为空 |
| 视觉呈现 | ⚠️ **未做像素级验证**（无浏览器控制能力），详见 §5 |
| 注入「成功」分支端到端实机 | ⚠️ 受沙箱限制未跑通，详见 §6 |
| 失败态提示（"未注入"也要弹） | ❌ **未实现**，见 §7 的 B1 说明 |

> 五个套件都可直接用 `node <文件>` 重跑，退出码 0 即通过（合计 188 项）。

## 1. 安装与重装

```
plugin_manager install_bundle(...)   → application: applied, warnings: []
plugin_manager remove_bundle(...)    → application: applied（换代码需先移除）
plugin_manager install_bundle(...)   → application: applied, warnings: []
```

> 重装是**必须**的：`install_bundle` 对已安装包返回 `already-installed`；
> 而客户端 JS 是模块生成，代码变更要走一次 移除 → 安装 才会加载新的一代。

## 2. 浏览器槽位实况（`cordis_inspect_query` → Client `Slots.listSubTree`）

`settings.section`（设置面板一页）：

| id | order | active | 来源 |
|---|---|---|---|
| `account` | -10 | true | 宿主 |
| `general` | 0 | true | 宿主 |
| `models` | 10 | true | 宿主 |
| `plugins` | 15 | true | 宿主 |
| `agent-presets` | 20 | true | 宿主 |
| **`dsh-workspace-prompt`** | **25** | **true** | **本插件** |

`sidebar.workspaces.session.row.action`（第一轮的入口，应已消失）：

| id | order | active |
|---|---|---|
| `archive` | 100 | true |
| `pin` | 200 | true |

→ 本插件**已不在**这个槽位里：旧的会话行按钮确实删掉了。

`shell.overlay`（浮层）——第三轮后**只剩提示条**，编辑器已内嵌进设置页：

| id | order | active |
|---|---|---|
| …（宿主既有 8 项） | — | true |
| **`dsh-workspace-prompt.injection-toast`** | **260** | **true** |

> 第一轮的会话行按钮、第二轮的 `dsh-workspace-prompt.dialog` 浮层，现在都**已不在**任何槽位里。

## 3. Host 半端到端（`temp&test/find-unbalanced.js`，43/43）

用**真实的 `index.js`** 与**真实的 `createRoutes()`**，配可写临时目录：

- **装配**：`apply()` 不抛错（真 try/catch，不是恒真断言）；
  `systemPrompt` 上下文 `name='workspace-prompt:current'`、`interpolate=false`、
  `order = getContextOrder('WORKING_DIRECTORY') - 5`；`text` 是**同步**函数；
  **7 条**路由齐全且都在 `/api/workspacePrompt/` 下。
- **安全默认**：未启用 → 注入空串；缺 `agent` → 空串且不抛错。
- **七条路由**：`/state`、`/save`、`/enable`、`/injection`（原 4 条，契约未变）
  + `/latest`、`/workspaces`、`/content`（本轮新增）。
- **按 workspaceId 定位**：`/content?workspaceId=` 正常与 404；
  `save`/`enable` 用 workspaceId 或 sessionId 都能工作；两者都给时以 workspaceId 为准；都不给 400。
- **错误路径**：缺参 400、会话不存在 404 `session-unresolved`、
  cwd 不属于任何工作区 404 `workspace-not-found`、未知 workspaceId 404、正文超长 413。
- **热路径零写盘**：**真的调用注入回调之后**再查状态目录，确认没有新增文件
  （旧版本这里两次 `readdirSync` 之间没有任何操作，是恒真断言，已修）。

## 4. 其余套件

**存储与热路径（14/14）**：`peekFileName` 未分配时返回 `undefined` 且不创建 `files.json`；
`readSync` 未分配时返回 `''` 且不写盘；`fileNameFor` 才分配并持久化；改名后文件名不搬家；
同标题依次 `-2`；非法字符被净化；标题为空用工作区 id 兜底。

**文件名安全（27/27）**：`..`、`../..`、`..\..\evil`、`C:\Windows\System32`、`/etc/passwd`、
`a/../../b`、控制字符、超长、`.hidden`、`trailing.` 等全部被正确处理；
Windows 保留设备名（`con`/`nul`/`aux`/`com1`/`lpt9`，含 `con.txt` 形态）加下划线前缀。
其中"净化成空串"是**设计上的回退信号**，调用方随即用工作区 id 兜底，不是路径穿越。

**Client 半行为（34/34）**：设置页注册与空列表渲染、窗口结构（开关左上 / 关闭右上 /
`role=tablist` / 编辑态 `textarea` / 浏览态无输入控件）、开关失败回滚、保存与失败态、
Escape 关闭并 **`preventDefault`**（避免误触宿主"停止本回合"）、Tab 焦点圈闭、
Toast **5 秒**定时器与清理、Markdown 防注入，以及注入账本的全部判定分支：
**(a)** 从未点击过任何按钮，收到新鲜注入仍会播报；**(b)** 非注入不占用 seq，
后续成功注入照常播报；**(c)** 陈旧注入不播报；**(d)** 空列表可读；
**(e)** Esc 走 capture 阶段并 `preventDefault`。

> 该套件还做了**变异测试**（在临时目录副本上）：7 个刻意注入的缺陷
> （非注入吞 seq / 去掉新鲜度窗口 / Esc 去掉 preventDefault / 跳过空列表分支 /
> **让轮询依赖"编辑器开着"＝复现原 B1** / 重新注册行按钮 slot / 去掉 `data-enabled`）
> **全部被现有用例捕获**，说明新用例不是空转。

### 第三轮（用户要求）：内嵌编辑器 + 固定显示名 + 清理废弃文件

**Client 半行为 37/37** 覆盖内嵌化后的新契约：

- 设置页与提示条是仅有的两个注册项——**浮层上的编辑器已消失**；
- 点「编辑提示词」后编辑器在**设置页的渲染树里**出现，列表让位给它；
- **没有**遮罩节点、**没有** `role="dialog"`/`aria-modal`、**没有** Tab 圈闭、
  **没有** Escape 监听（关闭后监听数为 0）；
- 浏览态渲染 Markdown 且**不含任何输入控件**；
- 保存/开关仍按 `workspaceId` 工作，`Ctrl/Cmd+S` 可保存；
- **离开时的未保存改动不静默**：第一次点「返回」只警告，第二次才离开；
  期间继续编辑会重新武装；
- 重开另一个工作区**不会闪出上一个工作区的正文**。

**Host 端到端 43/43** 覆盖 7 条路由（原 4 条 + 本轮新增 3 条）与全部错误路径。

## 5. 未验证项：视觉呈现

**没有**做像素级验证，也没有截图。本环境无浏览器控制能力，且规范禁止用自造渲染器冒充验证。
已能确认的替代证据：

- occupant 在实况槽位树里 `active: true`（§2）；
- 样式只引用主题令牌，无一处字面色值（脚本核对，非 `--dsw-*` 令牌数为 0）；
- 类名统一 `dwp-` 前缀；未 `require` 任何 `@deepseek-ai/*` 客户端包；
  未使用 `document.body` / `innerHTML` / `dangerouslySetInnerHTML`。

**仍需人工确认**：设置面板内容列里编辑器的排版与主题观感、提示条的层级。
请刷新页面后核对；若有偏差属样式微调，不影响功能。

## 6. 未验证项：注入「成功」分支的端到端实机

决策链、开关优先、同步性、零会话写入都由 §3/§4 覆盖，但**完整串联**未跑通：

- 插件的提示词目录生产上为 `<包>/prompt`；本工具沙箱**禁止**向该目录写入
  （探针实测 `EPERM`，连 `.gitkeep` 追加都被拒）。
- 因此"把正文放进 `<包>/prompt` → 触发注入 → 读回注入记录"这条链路本次跳过。
  测试会**显式打印跳过原因**，而不是伪装成通过。
- 独立复核者用 `DSH_WORKSPACE_PROMPT_DIR` 绕开该目录后，成功跑通到
  `enableStore.get()` 这一步，只剩"落 `state/enabled.json`"被沙箱挡住——与本报告描述一致。

**建议的人工验收**（约 1 分钟）：设置 → 工作区提示词 → 选一个工作区 → 写一段 Markdown →
打开左上角开关 → 在该工作区发一条消息。预期：顶部弹出
「已注入工作区提示词 · <工作区名> · N 字」，5 秒后自动消失。

## 7. 两轮发现并修掉的缺陷

### 第一轮（客户端加载器契约）

| # | 缺陷 | 影响 | 处理 |
|---|---|---|---|
| 1 | 根 bundle 注册 id 写成 `'<包名>/client.js'` | **整个浏览器半不加载** | 改为裸包名 |
| 2 | 8 个 chunk 的注册 id 也写成 `'<包名>/client.js'` 形态 | 首个之后全部重复注册报错 | 裸包名 + `chunk: '<文件名>'` |
| 3 | `apply()` 引用作用域外的 `require` | `ReferenceError`，不加载 | `require.async` 移入 factory 闭包 |
| 4 | 部分文件用了 `import`/`export` | 经典脚本里是 `SyntaxError` | 只保留 `__ModuleLoader__.load` 一句顶层语句 |
| 5 | chunk 同步 `require` 兄弟模块 | 运行时报"未 materialize" | 每个 chunk 自包含，依赖由入口以 props 传入 |
| 6 | `readSync`（注入热路径）首次调用会**同步写** `files.json` | 每个模型步骤都可能触发热路径写盘 | 新增只读的 `peekFileName`，热路径零写盘 |
| 7 | `configurePromptStore()` 是部分更新，但重建判断比较了重新求值后的两个目录 | 后续只传部分字段的调用会静默拆掉单例，让已生效配置失效 | 改为比较"合并后的生效值" |
| 8 | 净化器未处理 Windows 保留设备名 | 工作区名为 `con`/`nul` 等时写文件失败 | 加下划线前缀 |

### 第二轮（独立复核 + 用户要求）

| # | 缺陷 | 影响 | 处理 |
|---|---|---|---|
| **B1** | 注入提示**只在用户点过会话行按钮后才可能出现**；且只报成功、从不报失败 | **需求 8（注入后弹窗）在主场景下永不触发**：在工作区里直接发消息、从未点过按钮时完全静默 | 提示改为轮询**无入参**的 `/latest`（全局最近一次成功注入），与任何点击无关；加 (a)(b)(c) 三条针对性用例 + 变异测试验证 |
| M2 | 投递窗口余量只有 1.5s（`FRESH_MS=3000` vs `POLL_MS=1500`） | 一次轮询延后就把真实注入判成"历史"而静默丢弃 | 见 §8 残留 |
| M3 | 文档称"不写入会话日志"，与实现不符 | 误导用户对可见性的预期 | 已更正 README 与 PLAN：**不新增对话气泡**，但**展开上下文折叠行可见正文**（已核对 `agent-loop` 与 `ContextInjectionRow` 源码） |
| M4 | 窗口只 `stopPropagation`，拦不住宿主的 Esc 快捷键 | 窗口开着按 Esc 会**同时触发"停止本轮回合"** | 改为 window **capture** 阶段 + `preventDefault`；并补 Tab 焦点圈闭 |
| M5 | 一处路由注册没走 `ctx.effect` 形态 | 卸载回收未被真实验证 | 见 §8 残留 |
| — | 测试侧：两条**恒真断言** | 42/42 里有 2 项实际什么都没验证 | 已改为真 try/catch 与"真的调用注入回调后再查" |
| — | 测试侧：路由条数硬编码 `=== 4` | 新增路由后必然变红，易被误判为回归 | 改为 7 并加"7 条路径齐全"断言 |

## 8. 残留风险（未修，已知）

| 项 | 说明 |
|---|---|
| **失败态提示未实现** | `/latest` 只暴露**成功注入**的记录，`reason` 仅 `injected \| none`。因此"未注入"不会弹提示——这是刻意的：`disabled`/`no-workspace` 是常态，每步对话都弹会变成噪音。要补需 Host 去掉那层过滤并给出判定时间戳（提示条组件已具备 `warn`/`error` 色调能力，目前是死代码）。 |
| **M2 新鲜度窗口** | 仍是 `FRESH_MS=3000` / `POLL_MS=1500`（余量 1.5s）。未见实测丢失，但后台节流下有理论风险。 |
| **M5 effect 形态** | `connection.fetch.register` 的注册链在四个套件里都被替身化，未在真实 Host 上验证卸载回收。 |
| **视觉未验证** | 见 §5。 |
| **`client.row-action.js` 残留** | 已作废、无加载路径、已从 `files` 清单移除；当前环境不允许删除文件，故留在磁盘上。 |
| **设置页排序** | order 25 排在 `agent-presets(20)` 之后。若要插到 `plugins(15)` 与 `agent-presets(20)` 之间，改成 17 即可。 |

## 9. 约束遵守：未修改 deepseek-harness 本体

- 本工程全部写入都在 `E:\DSHworkspaces\CreateDSHplugins` 内。
- **决定性证据**：`git -C D:\deepseek-harness status --porcelain` 输出为**空**。
- 工具沙箱把可写范围限定在会话工作区，`D:\deepseek-harness` 下没有可用写入路径。
- 插件只使用宿主**已官方声明**的槽位（`settings.section`、`shell.overlay`）。

## 10. 安装指向漂移（重要运维发现）

**现象**：profile 的 `node_modules/dsh-workspace-prompt` 是一个 **junction**，它一度指向
`D:\DSHplugins\dsh-workspace-prompt` —— 一份**独立的陈旧副本**，而不是本工程的工作目录
`E:\DSHworkspaces\CreateDSHplugins\dsh-workspace-prompt`。

**影响**：浏览器加载的是 `D:` 的旧代码，工作目录里的改动**不会到达界面**。
本报告的第二、三轮改动因此曾长期"已实现但未生效"——用户看到的仍是第一轮的
「会话行按钮 + 浮层窗口」界面。

**处理**：
1. 用 `remove_bundle` + 从 `E:` 重新 `install_bundle`，把 junction 指回工作目录；
2. 逐文件核对「通过 junction 读到的内容」与工作副本的 SHA-256 **完全一致**；
3. 比对后确认 `D:` 副本**不含任何独有内容**（26 个文件同名，仅 4 个是我改过的旧版本），
   已将其整目录删除，同级其它目录未动。

**为什么要删而不是留着**：只要 `D:` 存在，安装就可能再次指回它，改动会再次静默失效。
删除后 junction 只剩一个可能的指向（工作目录）。

> 教训：`install_bundle` 记录的是**首次安装时的源路径**。如果同一个包名曾被从别的目录装过，
> 后续安装可能仍解析到旧路径。核查方法是读 junction 的 `Target` 并**比对文件哈希**，
> 而不是相信 `list_bundles` 里的 `source` 字段或"安装成功"这个结果本身。

## 11. 升级兼容性

- 只用官方声明槽位与 `--dsw-alias-*` 主题令牌：改名只降级外观，不崩。
- 每条注册都挂在 `ctx.effect`（Host）或 `ctx.slots.inject`（Client）上，随卸载回收。
- `context.agent` 是运行时字段（类型未声明），用法与 DSH 自带 `working-directory` 包一致，
  并做防御性判空；若该字段改名，注入会安全地变成"不注入"而不是抛错。
- 已知脆弱点：DSH 若改动 `settings.section` 的注册参数或 `settings.section` 的声明包，
  设置页入口需要相应调整；这属于契约变更，无法在插件侧规避。

## 12. 废弃文件清理（第三轮）

按用户要求删除。全部路径都在删除前逐个校验过落在插件根目录内：

| 已删除 | 原因 |
|---|---|
| `client.row-action.js` | 第一版会话行按钮，入口迁走后不再被加载 |
| `client/api.js` | 旧方案的 `client/` 子目录模块，零构建改造后作废 |
| `client/dialog.js` | 同上 |
| `client/icons.js` | 同上 |
| `client/markdown.js` | 同上 |
| `client/prompt-target-store.js` | 同上 |
| `client/styles.js` | 同上 |
| `client/toast.js` | 同上 |
| `client/`（空目录） | 上面 7 个文件删完后的空壳 |
| `prompt/.gitkeep` | 该目录已被真实提示词正文占用，占位文件无意义 |
| `state/.gitkeep` | 该目录已被 `enabled.json`/`files.json` 占用，占位文件无意义 |

`package.json` 的 `files` 清单同步移除了 `.gitkeep` 与 `!client/**` 两条（目标已不存在）。

**清理后插件根目录只剩 25 个文件**：10 个 `client*` 客户端模块、`index.js`、
`cordis.patch.yml`、`package.json`、`icon.svg`、`README.md`、`locale/{zh,en}.json`、
`host/` 下 5 个模块、`docs/` 下 2 份文档，以及运行期的 `prompt/`、`state/`。

> 注意：本工具的沙箱默认**禁止**向该目录写入与删除（`EPERM`）。删除是经用户批准的
> 一次性提权操作完成的；清单与校验步骤都打印在命令输出里，可复核。
