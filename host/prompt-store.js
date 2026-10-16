/**
 * 提示词正文存储：`<提示词目录>/<workspace_name>.md`。
 *
 * 模块职责（只做这些）：
 * 1. 目录解析：`DSH_WORKSPACE_PROMPT_DIR`（绝对路径）> 插件配置目录 > `<插件包根>/prompt`；
 * 2. 文件名净化与去重：按 PLAN 第 4 节净化工作区标题，同名工作区依次追加 `-2`、`-3`…，
 *    映射持久化在 `<插件包根>/state/files.json`（结构 `{ "<workspaceId>": "<fileName>" }`），
 *    已有映射一律复用，改标题后文件不搬家；
 * 3. 正文读写：读走「mtime + size」缓存（同步 fs），写走「临时文件 + rename」保证原子；
 * 4. 只依赖 node: 内置模块，零第三方依赖。
 *
 * 为什么读是同步的：系统提示词注入回调 `text(context)` 必须同步返回（不能 await），
 * 因此对外提供 `readSync` / `hasContent` / `fileNameFor`；`read` 只是它的 Promise 包装，
 * 供 /api 路由使用（调用方写法统一）。
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件包根目录（本文件位于 `<包根>/host/` 下）。 */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 默认提示词目录：`<插件包根>/prompt`。 */
export const DEFAULT_PROMPT_DIRECTORY = join(PACKAGE_ROOT, 'prompt')

/** 默认状态目录：`<插件包根>/state`（`files.json` 存放处）。 */
export const DEFAULT_STATE_DIRECTORY = join(PACKAGE_ROOT, 'state')

/** 文件名主体（不含 `.md`）的最大长度。 */
const MAX_NAME_LENGTH = 80

/** 文件名中必须删除的字符：`\ / : * ? " < > |` 与 C0 控制字符。 */
const ILLEGAL_NAME_CHARS = /[\u0000-\u001f\\/:*?"<>|]/g

/** 首尾需要去掉的空白与点：Windows 会丢弃结尾的点，开头的点会让文件隐藏。 */
const EDGE_PADDING = /^[\s.]+|[\s.]+$/g

/**
 * Windows 保留设备名。
 * 这些名字（含 `CON.txt` 这种"带扩展名"的形态）在 Windows 上会被解释成设备而不是文件，
 * 创建/写入会失败或行为异常，因此必须改写。净化后命中时统一加下划线前缀。
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i

/** 进程内单例状态：一个进程只装一个插件实例。 */
let singleton

/** 由 `configurePromptStore()` 记录的可选配置。 */
let configuredDirectory
/** 由 `configurePromptStore()` 记录的可选状态目录。 */
let configuredStateDirectory
/** 告警出口，默认静默；index.js 会接上 ctx.logger.warn。 */
let warn = () => {}

/**
 * 净化工作区标题，得到安全的文件名主体。
 * 规则：删除 `\ / : * ? " < > |` 与控制字符 → 去首尾空白与点 → 截断 80 字符
 * → 再去首尾空白与点 → 命中 Windows 保留设备名时加下划线前缀。
 * @param {unknown} title - 工作区标题（可能为空或非字符串）。
 * @returns {string} 净化后的文件名主体；可能为空串（调用方需用工作区 id 兜底）。
 */
export function sanitizeWorkspaceName(title) {
  const cleaned = String(title ?? '')
    .replace(ILLEGAL_NAME_CHARS, '')
    .replace(EDGE_PADDING, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(EDGE_PADDING, '')
  if (cleaned === '') return ''
  // 保留设备名：加前缀后就不再是设备（`con.md` → `_con.md`）。
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned
}

/**
 * 提示词目录：环境变量优先，其次是插件配置，最后是 `<插件包根>/prompt`。
 * `DSH_WORKSPACE_PROMPT_DIR` 必须是绝对路径；写成相对路径时忽略并告警。
 * @returns {string} 提示词目录的绝对路径。
 */
export function promptDirectory() {
  return ensureState().directory
}

/**
 * 状态目录（`files.json` 所在目录）。
 * @returns {string} 状态目录的绝对路径。
 */
export function stateDirectory() {
  return ensureState().stateDirectory
}

/**
 * 可选配置：必须在首次使用前调用（`index.js` 在插件激活时调用一次）。
 * @param {object} [options] - 配置项。
 * @param {string} [options.directory] - `config.promptDirectory`，相对路径按插件包根解析。
 * @param {string} [options.stateDirectory] - 覆盖默认状态目录。
 * @param {(message: string) => void} [options.onWarn] - 告警出口。
 */
export function configurePromptStore({ directory, stateDirectory: stateDir, onWarn } = {}) {
  if (typeof onWarn === 'function') warn = onWarn
  const nextDirectory = typeof directory === 'string' && directory.trim() !== ''
    ? (isAbsolute(directory) ? directory : resolve(PACKAGE_ROOT, directory))
    : configuredDirectory
  const nextStateDirectory = typeof stateDir === 'string' && stateDir.trim() !== ''
    ? stateDir
    : configuredStateDirectory
  // 本次真正生效的目录；单例若建于不同的值之上，就必须拆掉重建。
  const effectiveDirectoryNow = (typeof nextDirectory === 'string' && nextDirectory.trim() !== '')
    ? nextDirectory
    : DEFAULT_PROMPT_DIRECTORY
  const effectiveStateDirectoryNow = (typeof nextStateDirectory === 'string' && nextStateDirectory.trim() !== '')
    ? nextStateDirectory
    : DEFAULT_STATE_DIRECTORY
  // 本函数是**部分更新**（省略的字段保持原值）。比较必须拿"合并后的生效值"去做，
  // 而不是拿"本次传入的值"：否则"先前配置过 stateDirectory、之后某次只传 directory"
  // 会把单例错误地拆掉，让调用方**已经拿到手的那份配置**失效。
  if (singleton !== undefined
    && (singleton.directory !== effectiveDirectoryNow || singleton.stateDirectory !== effectiveStateDirectoryNow)) {
    singleton = undefined
  }
  configuredDirectory = nextDirectory
  configuredStateDirectory = nextStateDirectory
}

/**
 * 某个工作区的提示词文件名（不含目录），**只读**：已有映射就返回，否则返回 undefined。
 *
 * 这是给注入热路径用的版本：注入回调每个模型步骤都会跑，**不允许有任何写盘**，
 * 所以它只查内存里的持久化映射，不做分配、不落 `files.json`。
 * 分配与持久化由用户在窗口里打开/保存时触发（{@link fileNameFor}）。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} [title] - 第一个参数是 id 字符串时，用它作为工作区标题。
 * @returns {string|undefined} 已分配的文件名，或 undefined。
 */
export function peekFileName(workspace, title) {
  const target = identify(workspace, title)
  const state = ensureState()
  const key = target.id === '' ? target.title : target.id
  const known = state.files[key]
  return typeof known === 'string' && known !== '' ? known : undefined
}

/**
 * 某个工作区的提示词文件名（不含目录），首次使用时分配并持久化映射。
 *
 * ⚠ 首次调用会**同步写** `state/files.json`。只允许在用户动作路径上调用
 * （打开窗口的 `GET /state`、`POST /save`），**禁止**在系统提示词注入回调里调用。
 * 同步函数是因为 `/state` 与保存都要在同一轮里拿到文件名。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} [title] - 第一个参数是 id 字符串时，用它作为工作区标题。
 * @returns {string} 形如 `<净化后的标题>.md` 的文件名。
 */
export function fileNameFor(workspace, title) {
  const target = identify(workspace, title)
  const state = ensureState()
  const key = target.id === '' ? target.title : target.id
  const known = state.files[key]
  if (typeof known === 'string' && known !== '') return known
  const fileName = allocate(state, target)
  state.files[key] = fileName
  persistFiles(state)
  return fileName
}

/**
 * 同步读取正文（注入路径使用）。带 mtime + size 缓存：
 * - 缓存命中且文件未变 → 直接返回缓存内容；
 * - 文件被改过（mtime/size 变了）或首次读取 → 同步读盘并刷新缓存；
 * - 文件不存在 → 返回空串（并缓存“空”，避免每步都读一个不存在的文件）。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} [title] - 第一个参数是 id 字符串时，用它作为工作区标题。
 * @returns {string} 正文；不存在或读失败时为空串。
 */
export function readSync(workspace, title) {
  const state = ensureState()
  // 只读查询：注入热路径上绝不允许写盘，因此这里不分配文件名。
  const fileName = peekFileName(workspace, title)
  if (fileName === undefined) return ''
  const path = join(state.directory, fileName)
  const cached = state.cache.get(fileName)
  try {
    const info = statSync(path)
    if (!info.isFile()) return ''
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.content
    }
    const content = readFileSync(path, 'utf8')
    state.cache.set(fileName, { mtimeMs: info.mtimeMs, size: info.size, content })
    return content
  } catch (error) {
    if (error?.code === 'ENOENT') {
      state.cache.set(fileName, { mtimeMs: 0, size: -1, content: '' })
      return ''
    }
    warn(`dsh-workspace-prompt: 读取提示词文件失败（${path}）：${describeError(error)}`)
    return cached?.content ?? ''
  }
}

/**
 * 异步读取正文（/api 路由使用），语义与 {@link readSync} 完全一致。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} [title] - 第一个参数是 id 字符串时，用它作为工作区标题。
 * @returns {Promise<string>} 正文；不存在或读失败时为空串。
 */
export async function read(workspace, title) {
  return readSync(workspace, title)
}

/**
 * 是否已有非空正文（去掉首尾空白后仍有内容）。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} [title] - 第一个参数是 id 字符串时，用它作为工作区标题。
 * @returns {boolean} 有正文为 true。
 */
export function hasContent(workspace, title) {
  try {
    return readSync(workspace, title).trim() !== ''
  } catch (error) {
    warn(`dsh-workspace-prompt: 判断提示词是否为空失败：${describeError(error)}`)
    return false
  }
}

/**
 * 写入正文：先写 `<file>.tmp-<pid>-<n>`，再 rename 覆盖，保证原子；写后失效缓存。
 * 同一文件名的写入按调用顺序串行，避免并发覆盖。
 * @param {object|string} workspace - 工作区对象 `{ id, title }`，或工作区 id 字符串。
 * @param {string} content - 完整的新正文。
 * @returns {Promise<string>} 写入的文件名。
 * @throws {Error} 目录不可写等 IO 失败时抛出（调用方转成 500）。
 */
export async function write(workspace, content) {
  const state = ensureState()
  const fileName = fileNameFor(workspace)
  const path = join(state.directory, fileName)
  const text = String(content)
  const previous = state.pending.get(fileName) ?? Promise.resolve()
  const operation = previous.then(async () => {
    mkdirSync(state.directory, { recursive: true })
    state.writes += 1
    const temporary = `${path}.tmp-${process.pid}-${state.writes}`
    try {
      await writeFile(temporary, text, 'utf8')
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    state.cache.delete(fileName)
  })
  state.pending.set(fileName, operation.then(() => {}, () => {}))
  await operation
  return fileName
}

/** 当前生效的提示词目录（不含建状态时的副作用）。 */
function effectiveDirectory() {
  const fromEnv = process.env.DSH_WORKSPACE_PROMPT_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    if (isAbsolute(fromEnv)) return fromEnv
    warn(`dsh-workspace-prompt: DSH_WORKSPACE_PROMPT_DIR 必须是绝对路径，已忽略：${fromEnv}`)
  }
  return configuredDirectory ?? DEFAULT_PROMPT_DIRECTORY
}

/** 当前生效的状态目录（`files.json` 所在目录）。 */
function effectiveStateDirectory() {
  return configuredStateDirectory ?? DEFAULT_STATE_DIRECTORY
}

/** 取值并（首次）创建模块状态。 */
function ensureState() {
  if (singleton !== undefined) return singleton
  const directory = effectiveDirectory()
  const stateDir = effectiveStateDirectory()
  singleton = {
    directory,
    stateDirectory: stateDir,
    mapPath: join(stateDir, 'files.json'),
    files: readFilesMap(join(stateDir, 'files.json')),
    cache: new Map(),
    pending: new Map(),
    writes: 0,
  }
  return singleton
}

/** 把 `(workspace, title)` 的两种调用写法归一成 `{ id, title }`。 */
function identify(workspace, title) {
  if (workspace !== null && typeof workspace === 'object') {
    return { id: String(workspace.id ?? ''), title: String(workspace.title ?? '') }
  }
  return { id: String(workspace ?? ''), title: String(title ?? '') }
}

/** 选一个没被占用的文件名：标题（为空则 id），重名依次 `-2`、`-3`… */
function allocate(state, target) {
  const base = sanitizeWorkspaceName(target.title)
    || sanitizeWorkspaceName(target.id)
    || 'workspace'
  const taken = new Set()
  for (const fileName of Object.values(state.files)) taken.add(comparisonKey(fileName))
  let entries = []
  try {
    entries = readdirSync(state.directory)
  } catch {
    entries = []
  }
  for (const entry of entries) taken.add(comparisonKey(entry))
  let candidate = `${base}.md`
  for (let suffix = 2; taken.has(comparisonKey(candidate)); suffix += 1) {
    candidate = `${base}-${suffix}.md`
  }
  return candidate
}

/** 重名比较用的键：Windows 文件系统不区分大小写。 */
function comparisonKey(fileName) {
  return process.platform === 'win32' ? fileName.toLowerCase() : fileName
}

/** 读取 `files.json`；文件缺失或格式损坏时按空映射处理。 */
function readFilesMap(mapPath) {
  try {
    const parsed = JSON.parse(readFileSync(mapPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const files = {}
    for (const [id, fileName] of Object.entries(parsed)) {
      if (typeof fileName === 'string' && fileName !== '') files[id] = fileName
    }
    return files
  } catch {
    return {}
  }
}

/** 原子持久化 `files.json`（临时文件 + rename）；失败只告警，不影响本次会话。 */
function persistFiles(state) {
  try {
    mkdirSync(state.stateDirectory, { recursive: true })
    const temporary = `${state.mapPath}.tmp-${process.pid}`
    writeFileSync(temporary, `${JSON.stringify(state.files, null, 2)}\n`, 'utf8')
    renameSync(temporary, state.mapPath)
  } catch (error) {
    warn(`dsh-workspace-prompt: 写入文件名映射失败（${state.mapPath}）：${describeError(error)}`)
    try {
      rmSync(`${state.mapPath}.tmp-${process.pid}`, { force: true })
    } catch {
      // 清理临时文件失败无需再报。
    }
  }
}

/** 把任意错误转成可读的一行。 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
