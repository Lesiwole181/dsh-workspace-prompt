/**
 * Business facade for the workspace-prompt feature.
 *
 * Every operation that reads or changes plugin state is implemented exactly once
 * here; `api-routes.js` only parses HTTP parameters and maps errors, and
 * `injection.js` only consumes the read-only lookup. That keeps the batch diff,
 * the validation rules and the error-code semantics in one place.
 *
 * Batch changes (`applyChanges`) are serialized through an internal promise queue,
 * so two windows clicking "Apply" at the same time cannot overwrite each other's
 * added/removed set.
 */

import { isSafePromptFileName, MAX_PROMPT_CHARACTERS } from './prompt-file-store.js'
import { findWorkspaceByCwd, toWorkspaceSummary, workspaceDisplayName } from './workspace-resolver.js'

/** Maximum number of distinct workspace ids accepted by one batch change. */
const MAX_BATCH_IDS = 1000

/** Error codes exposed through the HTTP API (stable identifiers, not localized text). */
export const ERROR_CODES = Object.freeze({
  badRequest: 'bad-request',
  workspaceNotFound: 'workspace-not-found',
  notAdded: 'not-added',
  contentTooLong: 'content-too-long',
  ioFailed: 'io-failed',
})

/** A business error carrying a stable code and optional structured details. */
export class WorkspacePromptError extends Error {
  /**
   * @param {string} code One of {@link ERROR_CODES}.
   * @param {Record<string, unknown>} [details] Structured details (e.g. `{ limit }`).
   */
  constructor(code, details = {}) {
    super(code)
    this.name = 'WorkspacePromptError'
    this.code = code
    this.details = isPlainObject(details) ? details : {}
  }
}

/**
 * Create the prompt service.
 * @param {object} options Service dependencies.
 * @param {object} options.workspaceRegistry `ctx.workspaceRegistry` (synchronous `list()`).
 * @param {object} options.addedStore Added-workspaces store.
 * @param {object} options.enabledStore Enabled-flags store.
 * @param {object} options.promptFileStore Prompt file store.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{
 *   listAddedWorkspaces: () => { promptDirectory: string, workspaces: object[] },
 *   listCatalog: () => { workspaces: object[] },
 *   applyChanges: (input?: { add?: string[], remove?: string[] }) => Promise<{ added: string[], removed: string[], ignored: string[], list: object[] }>,
 *   readWorkspace: (workspaceId: string) => { workspace: object, content: string },
 *   saveContent: (workspaceId: string, content: string) => Promise<{ workspace: object, savedAt: number }>,
 *   setEnabled: (workspaceId: string, enabled: boolean) => { workspace: object },
 *   resolvePromptForCwd: (cwd: unknown) => ({ workspace: object, fileName: string, body: string } | undefined),
 * }} Prompt service.
 */
export function createPromptService({
  workspaceRegistry,
  addedStore,
  enabledStore,
  promptFileStore,
  onWarn,
} = {}) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  /** Serializes batch changes; every task observes the previous task's result. */
  let applyQueue = Promise.resolve()

  /**
   * Run one batch change after the previous one, whether it succeeded or failed.
   * @param {() => Promise<any>} task Task to run.
   * @returns {Promise<any>} Task result.
   */
  function runExclusive(task) {
    const next = applyQueue.then(task, task)
    applyQueue = next.then(() => {}, () => {})
    return next
  }

  /**
   * Snapshot of `workspaceRegistry.list()` as plain objects.
   * @returns {object[]} Workspaces in the Host's persistent order.
   */
  function workspaceList() {
    const listed = typeof workspaceRegistry?.list === 'function' ? workspaceRegistry.list() : []
    return Array.isArray(listed)
      ? listed.filter((workspace) => workspace !== null && typeof workspace === 'object')
      : []
  }

  /**
   * @param {string} workspaceId Workspace id.
   * @returns {object | undefined} Matching workspace entry.
   */
  function findWorkspace(workspaceId) {
    const key = String(workspaceId ?? '')
    if (key === '') return undefined
    return workspaceList().find((workspace) => String(workspace.id ?? '') === key)
  }

  /**
   * Validate a workspace id passed through the API.
   * @param {unknown} workspaceId Raw id.
   * @returns {string} The id.
   * @throws {WorkspacePromptError} `bad-request` when it is not a non-empty string.
   */
  function requireWorkspaceId(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'workspaceId' })
    }
    return workspaceId
  }

  /**
   * Locate a workspace that is both registered and present in the added set.
   * @param {unknown} workspaceId Raw workspace id.
   * @returns {{ workspace: object, entry: { id: string, fileName: string | null, addedAt: number } }}
   *   Registered workspace and its added-set entry.
   * @throws {WorkspacePromptError} `workspace-not-found` or `not-added`.
   */
  function requireAddedWorkspace(workspaceId) {
    const key = requireWorkspaceId(workspaceId)
    const workspace = findWorkspace(key)
    if (workspace === undefined) {
      throw new WorkspacePromptError(ERROR_CODES.workspaceNotFound, { workspaceId: key })
    }
    const entry = addedStore.get(key)
    if (entry === undefined) {
      throw new WorkspacePromptError(ERROR_CODES.notAdded, { workspaceId: key })
    }
    return { workspace, entry }
  }

  /**
   * Make sure the added entry has a safe prompt file name, allocating and persisting
   * one on first use. Only user-action paths call this (the injection path never writes).
   * @param {object} workspace Registered workspace.
   * @param {{ id: string, fileName: string | null, addedAt: number }} entry Added-set entry.
   * @returns {{ id: string, fileName: string, addedAt: number }} Entry with a usable file name.
   */
  function ensureFileName(workspace, entry) {
    if (isSafePromptFileName(entry.fileName)) return entry
    const id = String(workspace.id ?? '')
    const takenNames = addedStore.list()
      .map((candidate) => candidate.fileName)
      .filter((fileName) => isSafePromptFileName(fileName))
    const fileName = promptFileStore.allocateFileName(workspace, takenNames)
    addedStore.assignFileName(id, fileName)
    return { ...entry, fileName }
  }

  /**
   * Build one `ListedWorkspace` payload.
   * @param {object} workspace Registered workspace.
   * @param {{ fileName: string | null }} entry Added-set entry.
   * @returns {{ id: string, title: string, path: string, name: string, fileName: string,
   *   enabled: boolean, hasContent: boolean, characters: number }} Listed workspace.
   */
  function describeListedWorkspace(workspace, entry) {
    const id = String(workspace?.id ?? '')
    const fileName = typeof entry?.fileName === 'string' ? entry.fileName : ''
    const content = fileName === '' ? '' : promptFileStore.readSync(fileName)
    return {
      id,
      title: String(workspace?.title ?? ''),
      path: String(workspace?.path ?? ''),
      name: workspaceDisplayName(workspace),
      fileName,
      enabled: enabledStore.isEnabled(id),
      hasContent: content.trim() !== '',
      characters: content.length,
    }
  }

  /**
   * List the added workspaces, in the Host's persistent registry order.
   * Missing file names are allocated on the fly (the user is looking at the list).
   * @returns {{ promptDirectory: string, workspaces: object[] }} Listed added workspaces.
   */
  function listAddedWorkspaces() {
    const workspaces = []
    for (const workspace of workspaceList()) {
      const id = String(workspace.id ?? '')
      if (id === '') continue
      const entry = addedStore.get(id)
      if (entry === undefined) continue
      workspaces.push(describeListedWorkspace(workspace, ensureFileName(workspace, entry)))
    }
    return { promptDirectory: promptFileStore.directory, workspaces }
  }

  /**
   * List every registered workspace with its added flag (for the manage view).
   * @returns {{ workspaces: Array<{ id: string, title: string, path: string, name: string, added: boolean }> }}
   *   Catalog.
   */
  function listCatalog() {
    return {
      workspaces: workspaceList().map((workspace) => ({
        ...toWorkspaceSummary(workspace),
        added: addedStore.has(String(workspace.id ?? '')),
      })),
    }
  }

  /**
   * Validate one `add`/`remove` array: string ids, de-duplicated, order preserved.
   * @param {unknown} value Raw request field.
   * @param {string} field Field name used in the error details.
   * @returns {string[]} Unique ids.
   * @throws {WorkspacePromptError} `bad-request` for a non-array or non-string item.
   */
  function parseChangeIds(value, field) {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new WorkspacePromptError(ERROR_CODES.badRequest, { field })
    const ids = []
    const seen = new Set()
    for (const item of value) {
      if (typeof item !== 'string') throw new WorkspacePromptError(ERROR_CODES.badRequest, { field })
      if (seen.has(item)) continue
      seen.add(item)
      ids.push(item)
    }
    return ids
  }

  /**
   * Apply one validated batch change (executed inside the serialization queue).
   * @param {string[]} addIds Unique ids to add.
   * @param {string[]} removeIds Unique ids to remove.
   * @returns {Promise<{ added: string[], removed: string[], ignored: string[], list: object[] }>}
   *   Applied ids, ignored ids and the resulting added workspace list.
   */
  async function applyChangeNow(addIds, removeIds) {
    const registeredById = new Map(workspaceList().map((workspace) => [String(workspace.id ?? ''), workspace]))
    const existingEntries = addedStore.list()
    const addedIds = new Set(existingEntries.map((entry) => entry.id))
    const added = []
    const removed = []
    const ignored = []
    for (const id of addIds) {
      if (!registeredById.has(id) || addedIds.has(id)) ignored.push(id)
      else added.push(id)
    }
    for (const id of removeIds) {
      if (!addedIds.has(id)) ignored.push(id)
      else removed.push(id)
    }

    if (added.length > 0 || removed.length > 0) {
      const removedIds = new Set(removed)
      const nextEntries = existingEntries.filter((entry) => !removedIds.has(entry.id))
      const takenNames = nextEntries
        .map((entry) => entry.fileName)
        .filter((fileName) => isSafePromptFileName(fileName))
      for (const id of added) {
        const fileName = promptFileStore.allocateFileName(registeredById.get(id), takenNames)
        takenNames.push(fileName)
        nextEntries.push({ id, fileName, addedAt: Date.now() })
      }
      addedStore.set(nextEntries)

      if (removed.length > 0) {
        // Membership is already persisted; cleanup is best effort so one unreadable
        // file cannot roll back a successful removal.
        try {
          enabledStore.remove(removed)
        } catch (error) {
          warn(`failed to clear enabled flags for removed workspaces: ${describeError(error)}`)
        }
        for (const id of removed) {
          const entry = existingEntries.find((candidate) => candidate.id === id)
          if (!isSafePromptFileName(entry?.fileName)) continue
          try {
            await promptFileStore.remove(entry.fileName)
          } catch (error) {
            warn(`failed to delete the prompt file for workspace ${id}: ${describeError(error)}`)
          }
        }
      }
    }

    return { added, removed, ignored, list: listAddedWorkspaces().workspaces }
  }

  /**
   * Add/remove workspaces in one serialized transaction.
   * @param {{ add?: string[], remove?: string[] }} [input] Batch request.
   * @returns {Promise<{ added: string[], removed: string[], ignored: string[], list: object[] }>}
   *   Applied/ignored ids and the resulting list.
   * @throws {WorkspacePromptError} `bad-request` for invalid input; IO errors propagate.
   */
  async function applyChanges(input = {}) {
    if (!isPlainObject(input)) throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'body' })
    const addIds = parseChangeIds(input.add, 'add')
    const removeIds = parseChangeIds(input.remove, 'remove')
    if (new Set([...addIds, ...removeIds]).size > MAX_BATCH_IDS) {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { limit: MAX_BATCH_IDS })
    }
    const removeSet = new Set(removeIds)
    const overlap = addIds.filter((id) => removeSet.has(id))
    if (overlap.length > 0) {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { ids: overlap })
    }
    return runExclusive(() => applyChangeNow(addIds, removeIds))
  }

  /**
   * Read one workspace prompt.
   * @param {string} workspaceId Workspace id.
   * @returns {{ workspace: object, content: string }} Listed workspace and body.
   * @throws {WorkspacePromptError} `workspace-not-found` or `not-added`.
   */
  function readWorkspace(workspaceId) {
    const { workspace, entry } = requireAddedWorkspace(workspaceId)
    const resolved = ensureFileName(workspace, entry)
    return {
      workspace: describeListedWorkspace(workspace, resolved),
      content: promptFileStore.readSync(resolved.fileName),
    }
  }

  /**
   * Persist one workspace prompt (atomic write).
   * @param {string} workspaceId Workspace id.
   * @param {string} content Full Markdown body.
   * @returns {Promise<{ workspace: object, savedAt: number }>} Updated workspace and timestamp.
   * @throws {WorkspacePromptError} `bad-request`, `content-too-long`, `workspace-not-found`,
   *   `not-added` or `io-failed`.
   */
  async function saveContent(workspaceId, content) {
    const key = requireWorkspaceId(workspaceId)
    if (typeof content !== 'string') {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'content' })
    }
    if (content.length > MAX_PROMPT_CHARACTERS) {
      throw new WorkspacePromptError(ERROR_CODES.contentTooLong, { limit: MAX_PROMPT_CHARACTERS })
    }
    const { workspace, entry } = requireAddedWorkspace(key)
    const resolved = ensureFileName(workspace, entry)
    try {
      await promptFileStore.write(resolved.fileName, content)
    } catch (error) {
      throw new WorkspacePromptError(ERROR_CODES.ioFailed, { reason: describeError(error) })
    }
    return { workspace: describeListedWorkspace(workspace, resolved), savedAt: Date.now() }
  }

  /**
   * Toggle the enabled flag (independent from saving content).
   * @param {string} workspaceId Workspace id.
   * @param {boolean} enabled Next state.
   * @returns {{ workspace: object }} Updated listed workspace.
   * @throws {WorkspacePromptError} `bad-request`, `workspace-not-found`, `not-added` or `io-failed`.
   */
  function setEnabled(workspaceId, enabled) {
    const key = requireWorkspaceId(workspaceId)
    if (typeof enabled !== 'boolean') {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'enabled' })
    }
    const { workspace, entry } = requireAddedWorkspace(key)
    const resolved = ensureFileName(workspace, entry)
    try {
      enabledStore.set(key, enabled)
    } catch (error) {
      throw new WorkspacePromptError(ERROR_CODES.ioFailed, { reason: describeError(error) })
    }
    return { workspace: describeListedWorkspace(workspace, resolved) }
  }

  /**
   * Read-only synchronous lookup used by the system-prompt injection callback.
   * Never throws and never writes: `undefined` means "nothing to inject".
   * @param {unknown} cwd Session working directory.
   * @returns {{ workspace: { id: string, title: string, path: string, name: string }, fileName: string, body: string } | undefined }}
   *   Matched workspace, prompt file name and body.
   */
  function resolvePromptForCwd(cwd) {
    try {
      const workspace = findWorkspaceByCwd(workspaceList(), cwd)
      if (workspace === undefined) return undefined
      const id = String(workspace.id ?? '')
      if (id === '') return undefined
      const entry = addedStore.get(id)
      if (entry === undefined) return undefined
      if (!isSafePromptFileName(entry.fileName)) return undefined
      if (!enabledStore.isEnabled(id)) return undefined
      const body = promptFileStore.readSync(entry.fileName)
      if (body.trim() === '') return undefined
      return { workspace: toWorkspaceSummary(workspace), fileName: entry.fileName, body }
    } catch (error) {
      warn(`failed to resolve the workspace prompt for injection: ${describeError(error)}`)
      return undefined
    }
  }

  return {
    listAddedWorkspaces,
    listCatalog,
    applyChanges,
    readWorkspace,
    saveContent,
    setEnabled,
    resolvePromptForCwd,
  }
}

/** @param {unknown} value @returns {boolean} Whether `value` is a plain object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
