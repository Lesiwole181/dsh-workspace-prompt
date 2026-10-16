/**
 * 浏览器半的数据面：7 条 `/api/workspacePrompt/*` 路由（注册在 Connection 鉴权闸门内）。
 *
 * 其中前 4 条（`state` / `save` / `enable` / `injection`）是 PLAN 第 5.2 节的既定契约，
 * 路径、方法、入参、返回与错误码**一律冻结**，既有测试与浏览器半都在用；
 * 后 3 条（`latest` / `workspaces` / `content`）是「入口迁到设置页」新增的：
 * 设置页拿不到 sessionId，只能按 `workspaceId` 定位；注入提示也不再能在"用户点过某一行"
 * 时才开始轮询，因此多一条**无入参**的全局最近注入。
 *
 * 模块职责（只做这些）：解析请求 → 调用 `workspace-resolver` / `prompt-store` /
 * `enable-store` / `injection-registry` → 返回 JSON。业务规则（净化、去重、原子写）都在各自模块里。
 *
 * 响应约定（PLAN 第 5.2 节）：
 * - 成功：对应字段的 JSON，统一带 `cache-control: no-store`；
 * - 失败：`{ error: { code, message } }`，`message` 是可直接展示的中文原因；
 * - 状态码：400 `workspace-prompt/bad-request`、404 `workspace-prompt/session-unresolved`、
 *   404 `workspace-prompt/workspace-not-found`、500 `workspace-prompt/io-failed`、
 *   413 `workspace-prompt/content-too-long`（正文超长，PLAN 之外由契约补充）。
 *
 * 定位方式（两种，产出同一个工作区对象 `{ id, title, path }`）：
 * - `sessionId`（老 4 条路线）：经 `workspace-resolver` 走 sessionQuery → cwd → resolveByPath；
 * - `workspaceId`（新 3 条路线）：直接在 `ctx.workspaceRegistry.list()` 里按 id 命中，不碰磁盘。
 * `save` / `enable` 两条写路由**同时接受**两者，都给时以 `workspaceId` 为准（它更直接，
 * 不需要读会话）；两者都没有则 400。
 *
 * `/injection` 的例外：它返回的是**注入回调每一步写下的判定记录**，因此
 * 「该会话所在目录不属于任何工作区」时是 `200 + injected:false + reason:'no-workspace'`，
 * 而不是 404——客户端要的是可读原因，不是一次请求失败。只有该会话还没跑过任何模型步骤时，
 * 才现场诊断一次作为兜底。
 */

/** 全部 7 条路由的路径常量（与浏览器半的 URL 一一对应）。 */
export const ROUTES = {
  /** GET   `?sessionId=` → 开关 + 正文 + 文件名。 */
  state: '/api/workspacePrompt/state',
  /** POST  `{ sessionId | workspaceId, content }` → 写入正文。 */
  save: '/api/workspacePrompt/save',
  /** POST  `{ sessionId | workspaceId, enabled }` → 切换启用开关。 */
  enable: '/api/workspacePrompt/enable',
  /** GET   `?sessionId=` → 该会话最近一次注入结果。 */
  injection: '/api/workspacePrompt/injection',
  /** GET   无入参 → 全局最近一次**成功注入**；没有过则 `seq:0 / injected:false / reason:'none'`。 */
  latest: '/api/workspacePrompt/latest',
  /** GET   无入参 → 工作区清单（不含正文），按标题排序。 */
  workspaces: '/api/workspacePrompt/workspaces',
  /** GET   `?workspaceId=` → 单个工作区的开关 + 正文 + 文件名（设置页用）。 */
  content: '/api/workspacePrompt/content',
}

/** 正文长度上限（字符）；超过直接 413，避免把整个 state 文件写爆。 */
export const MAX_CONTENT_CHARACTERS = 200_000

/** 错误码常量，便于测试与调用方对齐。 */
export const ERROR_CODES = {
  badRequest: 'workspace-prompt/bad-request',
  sessionUnresolved: 'workspace-prompt/session-unresolved',
  workspaceNotFound: 'workspace-prompt/workspace-not-found',
  ioFailed: 'workspace-prompt/io-failed',
  contentTooLong: 'workspace-prompt/content-too-long',
}

/** 未注入原因：与浏览器半的展示逻辑一一对应。 */
export const INJECTION_REASONS = {
  injected: 'injected',
  disabled: 'disabled',
  empty: 'empty',
  noWorkspace: 'no-workspace',
  none: 'none',
}

/**
 * 构造全部 7 条路由。
 * @param {object} deps - 依赖。
 * @param {object} deps.resolver - `createWorkspaceResolver()` 的返回值（提供 `resolve`）。
 * @param {object} deps.promptStore - `host/prompt-store.js` 模块（`read`/`write`/`fileNameFor`/`hasContent`）。
 * @param {object} deps.enableStore - `createEnableStore()` 的返回值（`get`/`set`）。
 * @param {object} deps.registry - `createInjectionRegistry()` 的返回值（`latest`/`list`/`latestOverall`/`seq`）。
 * @param {object} [deps.workspaceRegistry] - `ctx.workspaceRegistry`（提供同步的 `list()`）；
 *   缺省时按 `workspaceId` 定位的三条新路由一律 500（`workspace-prompt/io-failed`）。
 * @param {(message: string) => void} [deps.onWarn] - 告警出口。
 * @returns {Array<{path: string, methods: string[], requestBody: 'buffered', fetch: (request: Request) => Promise<Response>}>}
 *   可直接交给 `ctx.connection.fetch.register()` 的路由数组（前 4 条为冻结的既有契约）。
 */
export function createRoutes({ resolver, promptStore, enableStore, registry, workspaceRegistry, onWarn }) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}

  /** 取出并校验一个 id 参数：去首尾空白，空串/非字符串一律视为"没给"。 */
  const idOf = (value) => {
    const id = typeof value === 'string' ? value.trim() : ''
    return id === '' ? undefined : id
  }

  /**
   * 列出宿主登记的全部工作区（同步，不碰磁盘）。
   * @returns {{workspaces: Array<{id: string, title: string, path: string}>}|{error: Response}}
   *   工作区数组，或已构造好的错误响应。
   */
  const listWorkspaces = () => {
    if (workspaceRegistry === undefined || workspaceRegistry === null) {
      return { error: failure(500, ERROR_CODES.ioFailed, '宿主未提供 workspaceRegistry 服务，无法列出工作区。') }
    }
    let entries
    try {
      entries = workspaceRegistry.list()
    } catch (error) {
      warn(`dsh-workspace-prompt: 列出工作区失败：${describeError(error)}`)
      return { error: failure(500, ERROR_CODES.ioFailed, `列出工作区失败：${describeError(error)}`) }
    }
    const workspaces = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry !== null && typeof entry === 'object')
      .map((entry) => ({
        id: String(entry.id ?? ''),
        title: String(entry.title ?? ''),
        path: String(entry.path ?? ''),
      }))
    return { workspaces }
  }

  /**
   * 按 workspaceId 定位工作区（同步）；失败时返回已构造好的错误响应。
   * @param {string} workspaceId - 工作区 id。
   * @returns {{workspace: {id: string, title: string, path: string}}|{error: Response}}
   */
  const locateById = (workspaceId) => {
    const listed = listWorkspaces()
    if (listed.error !== undefined) return listed.error
    const workspace = listed.workspaces.find((entry) => entry.id === workspaceId)
    if (workspace === undefined) {
      // 与 sessionId 路线上的 workspace-not-found 同码同状态：都是"这个工作区不存在"。
      return { error: failure(404, ERROR_CODES.workspaceNotFound, '找不到该工作区（可能已被删除）。') }
    }
    return { workspace }
  }

  /**
   * 解析请求体里的定位参数：`workspaceId` 优先，其次 `sessionId`。
   * @param {object} body - 已解析的 JSON 请求体。
   * @returns {{by: 'workspaceId'|'sessionId', value: string}|undefined} 定位参数；两者都没给时为 undefined。
   */
  const targetOf = (body) => {
    const workspaceId = idOf(body.workspaceId)
    if (workspaceId !== undefined) return { by: 'workspaceId', value: workspaceId }
    const sessionId = idOf(body.sessionId)
    if (sessionId !== undefined) return { by: 'sessionId', value: sessionId }
    return undefined
  }

  /**
   * 按定位参数解析工作区；失败时返回已构造好的错误响应。
   * @param {{by: 'workspaceId'|'sessionId', value: string}} target - {@link targetOf} 的结果。
   * @returns {Promise<{workspace: {id: string, title: string, path: string}}|{error: Response}>}
   */
  const locateTarget = async (target) => (
    target.by === 'workspaceId' ? locateById(target.value) : locate(target.value)
  )

  /**
   * 解析 sessionId → 工作区；失败时返回已构造好的错误响应。
   * @returns {Promise<{workspace: {id: string, title: string, path: string}}|{error: Response}>}
   */
  const locate = async (sessionId) => {
    try {
      return { workspace: await resolver.resolve(sessionId) }
    } catch (error) {
      if (error?.code === 'session-unresolved') {
        return { error: failure(404, ERROR_CODES.sessionUnresolved, `找不到该会话：${describeError(error)}`) }
      }
      if (error?.code === 'workspace-not-found') {
        return { error: failure(404, ERROR_CODES.workspaceNotFound, '该会话所在目录不属于任何工作区。') }
      }
      warn(`dsh-workspace-prompt: 定位工作区失败：${describeError(error)}`)
      return { error: failure(500, ERROR_CODES.ioFailed, `定位工作区失败：${describeError(error)}`) }
    }
  }

  /** 读取 JSON 请求体；失败时返回已构造好的错误响应。 */
  const readJson = async (request) => {
    let parsed
    try {
      parsed = await request.json()
    } catch {
      return { error: failure(400, ERROR_CODES.badRequest, '请求体必须是合法的 JSON。') }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: failure(400, ERROR_CODES.badRequest, '请求体必须是 JSON 对象。') }
    }
    return { body: parsed }
  }

  /** GET `/state`：开关 + 正文 + 文件名。 */
  const fetchState = async (request) => {
    const sessionId = idOf(new URL(request.url).searchParams.get('sessionId'))
    if (sessionId === undefined) {
      return failure(400, ERROR_CODES.badRequest, '缺少 sessionId 参数。')
    }
    const located = await locate(sessionId)
    if (located.error !== undefined) return located.error
    const { workspace } = located
    try {
      const content = await promptStore.read(workspace)
      const fileName = promptStore.fileNameFor(workspace)
      const enabled = enableStore.get(workspace.id)
      return success({
        workspaceId: workspace.id,
        workspaceName: workspace.title,
        fileName,
        enabled,
        content,
        characters: content.length,
      })
    } catch (error) {
      warn(`dsh-workspace-prompt: 读取工作区提示词失败：${describeError(error)}`)
      return failure(500, ERROR_CODES.ioFailed, `读取提示词失败：${describeError(error)}`)
    }
  }

  /** POST `/save`：原子写入正文。定位可用 `workspaceId` 或 `sessionId`（前者优先）。 */
  const fetchSave = async (request) => {
    const parsed = await readJson(request)
    if (parsed.error !== undefined) return parsed.error
    const target = targetOf(parsed.body)
    if (target === undefined) {
      return failure(400, ERROR_CODES.badRequest, '缺少 workspaceId 或 sessionId 参数。')
    }
    const { content } = parsed.body
    if (typeof content !== 'string') {
      return failure(400, ERROR_CODES.badRequest, 'content 必须是字符串。')
    }
    if (content.length > MAX_CONTENT_CHARACTERS) {
      return failure(
        413,
        ERROR_CODES.contentTooLong,
        `提示词正文过长（${content.length} 字符），上限为 ${MAX_CONTENT_CHARACTERS} 字符。`,
      )
    }
    const located = await locateTarget(target)
    if (located.error !== undefined) return located.error
    try {
      const fileName = await promptStore.write(located.workspace, content)
      return success({ fileName, characters: content.length, savedAt: Date.now() })
    } catch (error) {
      warn(`dsh-workspace-prompt: 写入工作区提示词失败：${describeError(error)}`)
      return failure(500, ERROR_CODES.ioFailed, `保存提示词失败：${describeError(error)}`)
    }
  }

  /** POST `/enable`：切换启用开关。定位可用 `workspaceId` 或 `sessionId`（前者优先）。 */
  const fetchEnable = async (request) => {
    const parsed = await readJson(request)
    if (parsed.error !== undefined) return parsed.error
    const target = targetOf(parsed.body)
    if (target === undefined) {
      return failure(400, ERROR_CODES.badRequest, '缺少 workspaceId 或 sessionId 参数。')
    }
    const { enabled } = parsed.body
    if (typeof enabled !== 'boolean') {
      return failure(400, ERROR_CODES.badRequest, 'enabled 必须是布尔值。')
    }
    const located = await locateTarget(target)
    if (located.error !== undefined) return located.error
    try {
      const value = await enableStore.set(located.workspace.id, enabled)
      return success({ enabled: value })
    } catch (error) {
      warn(`dsh-workspace-prompt: 保存启用开关失败：${describeError(error)}`)
      return failure(500, ERROR_CODES.ioFailed, `保存启用开关失败：${describeError(error)}`)
    }
  }

  /** GET `/injection`：最近一次注入判定结果（成功即含工作区与字符数，未注入给出原因）。 */
  const fetchInjection = async (request) => {
    const sessionId = idOf(new URL(request.url).searchParams.get('sessionId'))
    if (sessionId === undefined) {
      return failure(400, ERROR_CODES.badRequest, '缺少 sessionId 参数。')
    }
    // 注入回调每一步都会写一条判定记录，所以这里通常不需要再做任何解析。
    const record = registry.latest(sessionId)
    if (record !== undefined) {
      return success({
        seq: record.seq,
        injected: record.injected === true,
        reason: record.reason ?? (record.injected === true ? INJECTION_REASONS.injected : INJECTION_REASONS.none),
        workspaceName: record.workspaceName ?? '',
        characters: record.characters ?? 0,
        injectedAt: record.injectedAt ?? 0,
      })
    }
    // 该会话还没跑过任何模型步骤（例如刚打开窗口）：现场诊断一次，只为给出可读原因。
    const diagnosis = await diagnose(sessionId)
    return success({
      seq: registry.seq,
      injected: false,
      reason: diagnosis.reason,
      workspaceName: diagnosis.workspaceName,
      characters: 0,
      injectedAt: 0,
    })
  }

  /**
   * 没有注入记录时现场诊断“为什么没注入”。
   * 只读，不产生副作用（会顺带预热解析缓存）。
   * @returns {Promise<{reason: string, workspaceName: string}>} 原因与工作区名。
   */
  const diagnose = async (sessionId) => {
    const located = await locate(sessionId)
    if (located.error !== undefined) {
      return { reason: INJECTION_REASONS.noWorkspace, workspaceName: '' }
    }
    const { workspace } = located
    if (!enableStore.get(workspace.id)) {
      return { reason: INJECTION_REASONS.disabled, workspaceName: workspace.title }
    }
    try {
      if (!promptStore.hasContent(workspace)) {
        return { reason: INJECTION_REASONS.empty, workspaceName: workspace.title }
      }
    } catch {
      return { reason: INJECTION_REASONS.empty, workspaceName: workspace.title }
    }
    return { reason: INJECTION_REASONS.none, workspaceName: workspace.title }
  }

  /**
   * GET `/latest`：全局最近一次**成功注入**（不需要任何入参）。
   *
   * 这是会话行按钮删除后提示条的新数据源：客户端不再需要先知道 sessionId。
   * 成功注入的记录必然 `injected === true` 且 `injectedAt > 0`；一次都没有过时返回全零骨架，
   * 客户端拿 `seq === 0` 当"还没有基线"，所以这里绝不能拿"未注入"的判定来充当结果。
   */
  const fetchLatest = async () => {
    const record = registry.latestOverall()
    if (record === undefined) {
      return success({
        seq: 0,
        injected: false,
        reason: INJECTION_REASONS.none,
        sessionId: '',
        workspaceName: '',
        characters: 0,
        injectedAt: 0,
      })
    }
    return success({
      seq: record.seq,
      injected: record.injected === true,
      reason: record.reason ?? INJECTION_REASONS.none,
      sessionId: record.sessionId ?? '',
      workspaceName: record.workspaceName ?? '',
      characters: record.characters ?? 0,
      injectedAt: record.injectedAt ?? 0,
    })
  }

  /**
   * GET `/workspaces`：工作区清单（设置页列表用，**不返回正文**）。
   *
   * `characters` / `hasContent` 都基于**映射已分配**的正文文件（`peekFileName` + `readSync`，
   * 与注入路径同源、只读、不在列表请求上分配文件名），因此它如实回答
   * "现在这个工作区会不会注入、会注入多少字"，而不是"磁盘上碰巧躺着哪些文件"；
   * 尚未分配文件名的显示为空串，由界面决定怎么措辞。
   */
  const fetchWorkspaces = async () => {
    const listed = listWorkspaces()
    if (listed.error !== undefined) return listed.error
    try {
      const workspaces = await Promise.all(listed.workspaces.map(async (workspace) => {
        const content = await promptStore.read(workspace)
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.title,
          fileName: promptStore.peekFileName(workspace) ?? '',
          enabled: enableStore.get(workspace.id) === true,
          characters: content.length,
          hasContent: content.trim() !== '',
        }
      }))
      // 标题允许重复（不同目录可以同名），再用 id 兜底，保证顺序稳定、可复现。
      workspaces.sort((left, right) => left.workspaceName.localeCompare(right.workspaceName, 'zh-Hans-CN')
        || (left.workspaceId < right.workspaceId ? -1 : left.workspaceId > right.workspaceId ? 1 : 0))
      return success({ workspaces })
    } catch (error) {
      warn(`dsh-workspace-prompt: 读取工作区清单失败：${describeError(error)}`)
      return failure(500, ERROR_CODES.ioFailed, `读取工作区清单失败：${describeError(error)}`)
    }
  }

  /**
   * GET `/content?workspaceId=`：按工作区定位的 `/state`（设置页打开窗口时用）。
   * 与 `/state` 一样属于**用户动作路径**，因此同样允许分配文件名映射（`fileNameFor` 会首次落
   * `state/files.json`）；返回字段与 `/state` 完全一致，浏览器半两条路可以共用一套解析。
   */
  const fetchContent = async (request) => {
    const workspaceId = idOf(new URL(request.url).searchParams.get('workspaceId'))
    if (workspaceId === undefined) {
      return failure(400, ERROR_CODES.badRequest, '缺少 workspaceId 参数。')
    }
    const located = locateById(workspaceId)
    if (located.error !== undefined) return located.error
    const { workspace } = located
    try {
      const content = await promptStore.read(workspace)
      const fileName = promptStore.fileNameFor(workspace)
      const enabled = enableStore.get(workspace.id)
      return success({
        workspaceId: workspace.id,
        workspaceName: workspace.title,
        fileName,
        enabled,
        content,
        characters: content.length,
      })
    } catch (error) {
      warn(`dsh-workspace-prompt: 读取工作区提示词失败：${describeError(error)}`)
      return failure(500, ERROR_CODES.ioFailed, `读取提示词失败：${describeError(error)}`)
    }
  }

  return [
    { path: ROUTES.state, methods: ['GET'], requestBody: 'buffered', fetch: fetchState },
    { path: ROUTES.save, methods: ['POST'], requestBody: 'buffered', fetch: fetchSave },
    { path: ROUTES.enable, methods: ['POST'], requestBody: 'buffered', fetch: fetchEnable },
    { path: ROUTES.injection, methods: ['GET'], requestBody: 'buffered', fetch: fetchInjection },
    { path: ROUTES.latest, methods: ['GET'], requestBody: 'buffered', fetch: fetchLatest },
    { path: ROUTES.workspaces, methods: ['GET'], requestBody: 'buffered', fetch: fetchWorkspaces },
    { path: ROUTES.content, methods: ['GET'], requestBody: 'buffered', fetch: fetchContent },
  ]
}

/**
 * 构造一个成功响应：JSON + `cache-control: no-store`。
 * @param {object} value - 响应体。
 * @returns {Response} HTTP 响应。
 */
function success(value) {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

/**
 * 构造一个失败响应：`{ error: { code, message } }` + 状态码 + `cache-control: no-store`。
 * @param {number} status - HTTP 状态码。
 * @param {string} code - 错误码。
 * @param {string} message - 可直接展示的中文原因。
 * @returns {Response} HTTP 响应。
 */
function failure(status, code, message) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

/** 把任意错误转成可读的一行。 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
