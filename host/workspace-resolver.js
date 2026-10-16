/**
 * 会话 → 工作区解析。
 *
 * 模块职责（只做这些）：
 * 1. 异步解析：`sessionId` → `ctx.sessionQuery.readSurface()` 取 `session.cwd`
 *    → `ctx.workspaceRegistry.resolveByPath(cwd)` 取 `{ id, title, path }`；
 * 2. 同步缓存查询：`resolveCwdSync(cwd)` 专供系统提示词注入回调（同步、不能 await）；
 * 3. 异步预热：`prime(cwd)` 在缓存未命中时由注入路径触发，下一步即命中；
 * 4. 只依赖 node: 内置模块，零第三方依赖。
 *
 * 解析失败的两种语义（供路由映射状态码）：
 * - `session-unresolved`：会话读不到，或会话没有 cwd；
 * - `workspace-not-found`：cwd 不属于任何工作区（含路径不存在，`resolveByPath` 内部 realpath 抛错）。
 *
 * `resolveByPath()` 对不存在的路径会**抛错**，对存在但无人认领的目录返回 `undefined`，
 * 两种都按“不属于任何工作区”处理（契约要求 try/catch）。
 */

/** 缓存条目的新鲜期：超过后仍先用旧值注入，同时后台重新解析（stale-while-revalidate）。 */
const DEFAULT_STALE_AFTER_MS = 30_000

/** 缓存条目上限：会话分布很散时也不会无限增长。 */
const MAX_CACHE_ENTRIES = 200

/**
 * 规范化 cwd，作为缓存 key：
 * 反斜杠转正斜杠、去尾斜杠、去首尾空白；Windows 下再转小写（文件系统不区分大小写）。
 * @param {unknown} cwd - 原始 cwd。
 * @returns {string} 规范化后的 key；输入为空时返回空串。
 */
export function normalizeCwd(cwd) {
  const slashed = String(cwd ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

/** 会话 → 工作区解析失败；`code` 供路由映射 HTTP 状态码。 */
export class WorkspaceResolveError extends Error {
  /**
   * @param {'session-unresolved'|'workspace-not-found'} code - 失败类别。
   * @param {string} message - 可直接展示的中文原因。
   */
  constructor(code, message) {
    super(message)
    this.name = 'WorkspaceResolveError'
    this.code = code
  }
}

/**
 * 创建一个会话 → 工作区解析器。
 * @param {object} options - 依赖与配置。
 * @param {object} [options.sessionQuery] - `ctx.sessionQuery`，缺省时所有解析都按“会话不可解析”处理。
 * @param {object} [options.workspaceRegistry] - `ctx.workspaceRegistry`，缺省时所有解析都按“不属于任何工作区”处理。
 * @param {(message: string) => void} [options.onWarn] - 告警出口。
 * @param {number} [options.staleAfterMs] - 缓存新鲜期（毫秒），默认 30000。
 * @returns {{ resolve: (sessionId: string) => Promise<{id: string, title: string, path: string}>, resolveCwdSync: (cwd: unknown) => {id: string, title: string, path: string}|undefined, prime: (cwd: unknown) => Promise<{id: string, title: string, path: string}|undefined>, invalidate: () => void, size: () => number }}
 *   解析器：`resolve` 异步（路由用）、`resolveCwdSync` 同步（注入用）、`prime` 预热。
 */
export function createWorkspaceResolver({
  sessionQuery,
  workspaceRegistry,
  onWarn,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  /** 规范化 cwd → `{ at, workspace }`；`workspace` 为 undefined 表示“确定不属于任何工作区”。 */
  const cache = new Map()

  /** 写入缓存并维护淘汰顺序。 */
  const remember = (key, workspace) => {
    cache.delete(key)
    cache.set(key, { at: Date.now(), workspace })
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next()
      if (oldest.done === true) break
      cache.delete(oldest.value)
    }
  }

  /**
   * 异步解析一个 cwd 属于哪个工作区，并回填同步缓存；本函数不抛错。
   * @param {unknown} cwd - 会话的工作目录。
   * @returns {Promise<{id: string, title: string, path: string}|undefined>} 工作区，未命中为 undefined。
   */
  const prime = async (cwd) => {
    const key = normalizeCwd(cwd)
    if (key === '') return undefined
    if (workspaceRegistry === undefined || workspaceRegistry === null) {
      remember(key, undefined)
      return undefined
    }
    let workspace
    try {
      workspace = await workspaceRegistry.resolveByPath(String(cwd).trim())
    } catch (error) {
      // 路径不存在（realpath 抛 ENOENT）等一律按“不属于任何工作区”处理。
      if (error?.code !== 'ENOENT') {
        warn(`dsh-workspace-prompt: 解析工作区失败（${String(cwd)}）：${describeError(error)}`)
      }
      remember(key, undefined)
      return undefined
    }
    if (workspace === undefined || workspace === null) {
      remember(key, undefined)
      return undefined
    }
    const described = {
      id: String(workspace.id ?? ''),
      title: String(workspace.title ?? ''),
      path: String(workspace.path ?? cwd),
    }
    remember(key, described)
    return described
  }

  return {
    /**
     * 解析一个会话所属的工作区（异步，/api 路由使用）。
     * @param {string} sessionId - 会话 id。
     * @returns {Promise<{id: string, title: string, path: string}>} 工作区标识。
     * @throws {WorkspaceResolveError} 会话不可解析或 cwd 不属于任何工作区。
     */
    async resolve(sessionId) {
      if (sessionQuery === undefined || sessionQuery === null) {
        throw new WorkspaceResolveError('session-unresolved', '宿主未提供 sessionQuery 服务，无法定位会话。')
      }
      let surface
      try {
        surface = await sessionQuery.readSurface(sessionId)
      } catch (error) {
        throw new WorkspaceResolveError('session-unresolved', `读取会话失败：${describeError(error)}`)
      }
      const cwd = surface?.session?.cwd
      if (typeof cwd !== 'string' || cwd.trim() === '') {
        throw new WorkspaceResolveError('session-unresolved', '该会话没有工作目录，无法定位工作区。')
      }
      const workspace = await prime(cwd)
      if (workspace === undefined) {
        throw new WorkspaceResolveError('workspace-not-found', '该会话所在目录不属于任何工作区。')
      }
      return workspace
    },

    /**
     * 同步查询某个 cwd 属于哪个工作区（系统提示词注入路径使用）。
     * 缓存未命中时返回 undefined 并触发一次异步预热（本步不注入，下一步生效）。
     * @param {unknown} cwd - 会话的工作目录。
     * @returns {{id: string, title: string, path: string}|undefined} 工作区，未命中为 undefined。
     */
    resolveCwdSync(cwd) {
      const key = normalizeCwd(cwd)
      if (key === '') return undefined
      const entry = cache.get(key)
      if (entry === undefined) {
        void prime(cwd).catch(() => {})
        return undefined
      }
      if (Date.now() - entry.at > staleAfterMs) void prime(cwd).catch(() => {})
      return entry.workspace
    },

    /**
     * 异步预热一个 cwd 的解析结果（不抛错）。
     * @param {unknown} cwd - 会话的工作目录。
     * @returns {Promise<{id: string, title: string, path: string}|undefined>} 工作区，未命中为 undefined。
     */
    prime,

    /** 清空解析缓存（工作区改名/删除后可立即生效）。 */
    invalidate() {
      cache.clear()
    },

    /**
     * 当前缓存条目数（诊断用）。
     * @returns {number} 条目数。
     */
    size() {
      return cache.size
    },
  }
}

/** 把任意错误转成可读的一行。 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
