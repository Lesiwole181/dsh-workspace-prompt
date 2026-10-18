# HTTP API 说明（API）

浏览器半通过 Connection 已鉴权的同源 `/api` 通道访问 Host。所有请求由 DSH 的 Connection 先完成鉴权，插件不新开端口、不自行认证。

- Base：`/api/workspacePrompt`
- 成功：HTTP `200`，`{ "version": 1, ... }`，`cache-control: no-store`
- 失败：`{ "error": { "code": "<code>", "details"?: { ... } } }`，`cache-control: no-store`
- 错误文案不在服务端生成：Client 按 `code` 从 locale 词典取文案（因此 Host 无 locale 依赖）。

## 1. `GET /api/workspacePrompt/list`

返回"已添加进界面"的工作区（按 DSH workspace 持久顺序过滤）。

```json
{
  "version": 1,
  "promptDirectory": "E:\\...\\dsh-workspace-prompt\\prompt",
  "workspaces": [
    {
      "id": "ws_xxx",
      "title": "我的项目",
      "path": "E:\\projects\\demo",
      "name": "我的项目",
      "fileName": "我的项目.md",
      "enabled": true,
      "hasContent": true,
      "characters": 128
    }
  ]
}
```

`ListedWorkspace` 字段：
| 字段 | 说明 |
|---|---|
| `id` | 工作区 id |
| `title` | workspaceRegistry 中的原始标题 |
| `path` | 工作区根目录绝对路径 |
| `name` | 展示名（title 为空时回退目录末段/id） |
| `fileName` | 提示词文件名（`prompt/` 下）；缺失时 Host 会分配并持久化 |
| `enabled` | 启用开关 |
| `hasContent` | 正文 trim 后非空 |
| `characters` | 正文字符数 |

## 2. `GET /api/workspacePrompt/catalog`

返回 DSH 中全部工作区 + 是否已添加（供「管理工作区」使用）。

```json
{
  "version": 1,
  "workspaces": [
    { "id": "ws_xxx", "title": "我的项目", "path": "E:\\projects\\demo", "name": "我的项目", "added": true }
  ]
}
```

## 3. `POST /api/workspacePrompt/apply`

批量添加/移除。一次请求完成 diff：

```json
// 请求
{ "add": ["ws_a", "ws_b"], "remove": ["ws_c"] }
// 响应
{
  "version": 1,
  "added": ["ws_a", "ws_b"],
  "removed": ["ws_c"],
  "ignored": ["ws_unknown"],
  "workspaces": [ /* 同 /list 的 workspaces */ ]
}
```

语义：
- `add`：只添加 registry 中存在的、且当前未添加的工作区；分配 `fileName`；
- `remove`：从 added 集合移除，删除其提示词文件与启用标记；
- 已存在/不存在等无效 id 进入 `ignored`；
- `add ∩ remove` 非空 → `400 bad-request`；
- add+remove 去重后总数 > 1000 → `400 bad-request`；
- 变更在 Host 内串行化。

## 4. `GET /api/workspacePrompt/content?workspaceId=<id>`

```json
{ "version": 1, "workspace": { /* ListedWorkspace */ }, "content": "# 提示词正文\n..." }
```

## 5. `POST /api/workspacePrompt/save`

```json
// 请求
{ "workspaceId": "ws_xxx", "content": "# 新的提示词" }
// 响应
{ "version": 1, "workspace": { /* ListedWorkspace */ }, "savedAt": 1760000000000 }
```

- `content` 必须是字符串，长度 ≤ 200000（否则 413 `content-too-long`，`details.limit = 200000`）；
- 原子写入 `prompt/<fileName>`。

## 6. `POST /api/workspacePrompt/enable`

```json
// 请求
{ "workspaceId": "ws_xxx", "enabled": true }
// 响应
{ "version": 1, "workspace": { /* ListedWorkspace */ } }
```

## 7. 错误码

| code | HTTP | 触发条件 | Client 文案键 |
|---|---|---|---|
| `bad-request` | 400 | 参数缺失/类型错误、apply 交集、超出批量上限 | `error.bad-request` |
| `workspace-not-found` | 404 | workspaceId 不在 registry | `error.workspace-not-found` |
| `not-added` | 409 | 工作区存在但未添加进界面 | `error.not-added` |
| `content-too-long` | 413 | 正文超过 200000 字符（`details.limit`） | `error.content-too-long` |
| `io-failed` | 500 | 文件读写失败（`details.reason` 为技术原因） | `error.io-failed` |
| （网络失败） | — | fetch 抛错 | `error.network` |
| （其它 HTTP） | — | 非 2xx 且无 `error` 字段 | `error.http` |

## 8. 状态文件格式

`state/workspaces.json`
```json
{
  "version": 1,
  "workspaces": [
    { "id": "ws_xxx", "fileName": "我的项目.md", "addedAt": 1760000000000 }
  ]
}
```

`state/enabled.json`
```json
{ "version": 1, "enabled": { "ws_xxx": true } }
```

两者均为容错读取：缺失/损坏按空集合处理；非法条目丢弃；兼容旧版裸数组/裸对象结构。
