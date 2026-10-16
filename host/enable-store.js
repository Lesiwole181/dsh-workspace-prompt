/**
 * 启用开关存储：`<插件包根>/state/enabled.json`，结构 `{ "<workspaceId>": true }`。
 *
 * 模块职责（只做这些）：
 * 1. 插件启动时**同步**读入内存（注入回调必须在同步路径上判断开关）；
 * 2. `get(workspaceId)` 同步读取；
 * 3. `set(workspaceId, enabled)` 异步原子落盘（临时文件 + rename），只记录 `true` 的项；
 * 4. 只依赖 node: 内置模块，零第三方依赖。
 *
 * 一致性策略：内存状态在**落盘成功之后**才切换，落盘失败时抛错且内存保持原值，
 * 这样 `/api/workspacePrompt/enable` 返回 500 时不会出现“界面说失败、实际已生效”。
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件包根目录（本文件位于 `<包根>/host/` 下）。 */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 默认开关文件：`<插件包根>/state/enabled.json`。 */
export const DEFAULT_ENABLED_FILE = join(PACKAGE_ROOT, 'state', 'enabled.json')

/**
 * 创建一个启用开关存储。启动时同步读入 `enabled.json`。
 *
 * 默认路径在**调用时**求值（而不是写成参数默认值 `path = DEFAULT_ENABLED_FILE`）：
 * 参数默认值只在实参为 `undefined` 时生效，而这里真正想要的是
 * "调用方没给路径就用当前生效的默认值"，两者在将来接入配置覆盖时行为不同。
 * @param {object} [options] - 配置项。
 * @param {string} [options.path] - 开关文件路径，缺省为 `<插件包根>/state/enabled.json`。
 * @param {(message: string) => void} [options.onWarn] - 告警出口。
 * @returns {{ path: string, get: (workspaceId: string) => boolean, list: () => string[], set: (workspaceId: string, enabled: boolean) => Promise<boolean> }}
 *   开关存储对象：`get` 同步、`set` 异步落盘。
 */
export function createEnableStore({ path, onWarn } = {}) {
  const file = typeof path === 'string' && path.trim() !== '' ? path : DEFAULT_ENABLED_FILE
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  let snapshot = readEnabled(file, warn)
  let queue = Promise.resolve()

  /** 串行执行一次落盘，保证并发 set 不会交叉写同一个临时文件。 */
  const enqueue = (task) => {
    const next = queue.then(task, task)
    queue = next.then(() => {}, () => {})
    return next
  }

  return {
    /** 开关文件的绝对路径。 */
    get path() {
      return file
    },

    /**
     * 某个工作区是否已启用（同步，读内存快照）。
     * @param {string} workspaceId - 工作区 id。
     * @returns {boolean} 已启用为 true；未记录一律视为未启用。
     */
    get(workspaceId) {
      return snapshot.get(normalizeId(workspaceId)) === true
    },

    /**
     * 当前所有已启用的工作区 id。
     * @returns {string[]} 工作区 id 列表。
     */
    list() {
      return [...snapshot.keys()]
    },

    /**
     * 切换某个工作区的开关并异步落盘。
     * @param {string} workspaceId - 工作区 id。
     * @param {boolean} enabled - 是否启用。
     * @returns {Promise<boolean>} 落盘成功后的开关状态。
     * @throws {Error} 目录不可写等 IO 失败时抛出（调用方转成 500）。
     */
    async set(workspaceId, enabled) {
      const id = normalizeId(workspaceId)
      const next = new Map(snapshot)
      if (enabled === true) next.set(id, true)
      else next.delete(id)
      await enqueue(() => persist(file, next))
      snapshot = next
      return enabled === true
    },
  }
}

/** 统一 id 的字符串形态（内存 key 与 JSON key 必须一致）。 */
function normalizeId(workspaceId) {
  return String(workspaceId ?? '')
}

/**
 * 同步读取开关文件；缺失或损坏时返回空表（即“全部未启用”）。
 * 只有值为 `true` 的项才算启用。
 */
function readEnabled(path, warn) {
  const enabled = new Map()
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      warn(`dsh-workspace-prompt: 读取启用开关失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
    }
    return enabled
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return enabled
    for (const [id, value] of Object.entries(parsed)) {
      if (value === true) enabled.set(id, true)
    }
  } catch {
    warn(`dsh-workspace-prompt: 启用开关文件不是合法 JSON，已按“全部未启用”处理：${path}`)
  }
  return enabled
}

/** 原子写入开关文件：临时文件 + rename；只写值为 true 的项。 */
async function persist(path, enabled) {
  const payload = Object.fromEntries([...enabled.keys()].sort().map(id => [id, true]))
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
