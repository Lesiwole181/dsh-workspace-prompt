/**
 * 注入记录表：内存 `Map<sessionId, record>`，供浏览器半的注入反馈（Toast）查询。
 *
 * 模块职责（只做这些）：
 * 1. `report(...)` 记下**每一次模型步骤的注入判定结果**——成功注入，或未注入的原因
 *    （`disabled` / `empty` / `no-workspace`）。全局自增 `seq` 让客户端判断"是否有新的判定"；
 * 2. `latest(sessionId)` 取某个会话最近一次判定记录；
 * 3. `list()` / `latestOverall()` 取**全局**视角：入口迁到设置页后，客户端手上不再有 sessionId
 *    （它原本只来自被点击的会话行按钮），提示条只能问"最近一次注入是什么"；
 * 4. 不判断该不该注入（那是 index.js 的注入回调的职责），也不做工作区解析。
 *
 * 为什么连"未注入"也记：注入回调每个模型步骤都会跑一次，它比 `GET /injection` 轮询更早知道
 * 真实原因；把原因记在这里，`/injection` 就**不必**再现场解析会话（那会带来 realpath 磁盘 IO），
 * 而且报的是"当时真正发生了什么"，而不是"现在如果跑一次会怎样"。
 *
 * 为什么 `latestOverall()` 只认**成功注入**的记录：提示条要报的是"已经注入了什么"。
 * 未注入的记录没有 `injectedAt`，也没有可展示的正文规模，拿去播报只会变成误报。
 */

/** 默认最多保留多少个会话的记录（长时间运行不会无限增长）。 */
const DEFAULT_LIMIT = 500

/** 未注入原因的取值；与 api-routes.js 的 `INJECTION_REASONS` 保持一致。 */
export const REASONS = {
  injected: 'injected',
  disabled: 'disabled',
  empty: 'empty',
  noWorkspace: 'no-workspace',
}

/**
 * 创建一个注入记录表。
 * @param {object} [options] - 配置项。
 * @param {number} [options.limit] - 最多保留的会话数，默认 500，超出的按最久未更新淘汰。
 * @returns {{ seq: number, report: (input: object) => object, record: (input: object) => object, latest: (sessionId: string) => object|undefined, list: () => object[], latestOverall: () => object|undefined, size: () => number }}
 *   记录表：`seq` 为全局序号（getter），`report`/`record` 写，`latest`/`list`/`latestOverall` 读。
 */
export function createInjectionRegistry({ limit = DEFAULT_LIMIT } = {}) {
  /** 全局自增序号：每一次判定 +1。 */
  let counter = 0
  /** sessionId → 最近一次判定记录。 */
  const bySession = new Map()

  /**
   * 记录一次判定结果。
   * @param {object} input - 判定信息。
   * @param {string} input.sessionId - 会话 id。
   * @param {string} [input.workspaceId] - 工作区 id；未解析到工作区时为空串。
   * @param {string} [input.workspaceName] - 工作区标题（用于展示）。
   * @param {number} [input.characters] - 注入正文的字符数；未注入时为 0。
   * @param {string} [input.reason] - 未注入原因；省略时按"已注入"处理（见下）。
   * @returns {object} 写入的记录。
   */
  function report({ sessionId, workspaceId, workspaceName, characters, reason }) {
    counter += 1
    // 未给 reason 即视为成功注入：`characters > 0` 是成功注入的必要条件。
    const resolvedReason = typeof reason === 'string' && reason !== ''
      ? reason
      : (Number(characters) > 0 ? REASONS.injected : REASONS.empty)
    const injected = resolvedReason === REASONS.injected
    const record = {
      seq: counter,
      sessionId: String(sessionId),
      workspaceId: String(workspaceId ?? ''),
      workspaceName: String(workspaceName ?? ''),
      characters: injected ? (Number(characters) || 0) : 0,
      reason: resolvedReason,
      injectedAt: injected ? Date.now() : 0,
      injected,
    }
    // 先删后插：Map 的插入顺序即淘汰顺序，最近判定的会话排到最后。
    bySession.delete(record.sessionId)
    bySession.set(record.sessionId, record)
    while (bySession.size > limit) {
      const oldest = bySession.keys().next()
      if (oldest.done === true) break
      bySession.delete(oldest.value)
    }
    return record
  }

  return {
    /** 当前全局序号（尚无判定时为 0）。 */
    get seq() {
      return counter
    },

    /** {@link report} 的别名，保留旧调用点。 */
    record: report,

    /** 记录一次判定结果（成功注入或未注入原因）。 */
    report,

    /**
     * 某个会话最近一次判定记录。
     * @param {string} sessionId - 会话 id。
     * @returns {object|undefined} 记录；从未判定过时为 undefined。
     */
    latest(sessionId) {
      return bySession.get(String(sessionId))
    },

    /**
     * 全部记录的快照，按判定序号倒序（新 → 旧）。
     * `seq` 每次判定自增，因此"最新的判定"一定排在最前；未注入的记录 `injectedAt` 为 0，
     * 只有 `seq` 能给出确定顺序，所以排序键用它而不是 `injectedAt`。
     * @returns {object[]} 记录数组（新 → 旧）；没有任何记录时为空数组。
     */
    list() {
      return [...bySession.values()].sort((left, right) => right.seq - left.seq)
    },

    /**
     * 全局最近一次**成功注入**的记录（提示条的数据源，不需要 sessionId）。
     * 未注入的判定记录不参与：它们没有 `injectedAt`，播报它们只会误报。
     * @returns {object|undefined} 记录；从未成功注入过时为 undefined。
     */
    latestOverall() {
      let newest
      for (const record of bySession.values()) {
        if (record.injected !== true) continue
        if (newest === undefined || record.seq > newest.seq) newest = record
      }
      return newest
    },

    /**
     * 当前缓存了多少个会话的记录（诊断用）。
     * @returns {number} 记录条数。
     */
    size() {
      return bySession.size
    },
  }
}
