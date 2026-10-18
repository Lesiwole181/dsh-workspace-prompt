/**
 * The plugin's own "added workspaces" set, persisted in `state/workspaces.json`.
 *
 * The Host `workspaceRegistry` owns every workspace known to DSH; this store keeps
 * the much smaller subset the user explicitly added to the plugin, together with
 * the prompt file name assigned at add time. The file name mapping is persisted so
 * renaming a workspace does not move (or lose) its prompt file.
 *
 * On-disk format (versioned for future migrations):
 *   { "version": 1, "workspaces": [{ "id": "ws_x", "fileName": "Project.md", "addedAt": 1760000000000 }] }
 *
 * Reads are tolerant: missing or corrupt files mean "nothing added", invalid
 * entries are dropped, bare arrays from older versions are still accepted and
 * duplicate ids keep their first occurrence.
 */

import { join } from 'node:path'

import { createJsonFile } from './json-file.js'

/** Current state file version. */
const STATE_VERSION = 1

/** State file name inside the state directory. */
const STATE_FILE_NAME = 'workspaces.json'

/**
 * Normalize arbitrary parsed JSON into the added-workspace state shape.
 * @param {unknown} raw Parsed JSON value (object, legacy array, or garbage).
 * @returns {{ version: 1, workspaces: Array<{ id: string, fileName: string | null, addedAt: number }> }}
 *   Tolerant normalized state.
 */
export function normalizeAddedState(raw) {
  const entries = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.workspaces)
      ? raw.workspaces
      : []
  const workspaces = []
  const seenIds = new Set()
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    const id = String(entry.id ?? '')
    if (id.trim() === '' || seenIds.has(id)) continue
    seenIds.add(id)
    const fileName = typeof entry.fileName === 'string' && entry.fileName.trim() !== ''
      ? entry.fileName
      : null
    const addedAt = typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt)
      ? entry.addedAt
      : Date.now()
    workspaces.push({ id, fileName, addedAt })
  }
  return { version: STATE_VERSION, workspaces }
}

/**
 * Create the added-workspaces store.
 * @param {object} options Store options.
 * @param {string} options.stateDirectory Absolute state directory path.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{
 *   list: () => Array<{ id: string, fileName: string | null, addedAt: number }>,
 *   has: (id: string) => boolean,
 *   get: (id: string) => ({ id: string, fileName: string | null, addedAt: number } | undefined),
 *   set: (entries: Array<{ id: string, fileName: string | null, addedAt: number }>) => void,
 *   assignFileName: (id: string, fileName: string) => void,
 * }} Added-workspaces store.
 */
export function createAddedWorkspacesStore({ stateDirectory, onWarn } = {}) {
  if (typeof stateDirectory !== 'string' || stateDirectory.trim() === '') {
    throw new Error('createAddedWorkspacesStore requires a non-empty state directory')
  }
  const file = createJsonFile({
    path: join(stateDirectory, STATE_FILE_NAME),
    normalize: normalizeAddedState,
    onWarn,
  })

  return {
    /** @returns {Array<{ id: string, fileName: string | null, addedAt: number }>} A copy of all entries. */
    list() {
      return file.read().workspaces.map((entry) => ({ ...entry }))
    },

    /** @param {string} id Workspace id. @returns {boolean} Whether the workspace was added. */
    has(id) {
      const key = String(id ?? '')
      return file.read().workspaces.some((entry) => entry.id === key)
    },

    /**
     * @param {string} id Workspace id.
     * @returns {{ id: string, fileName: string | null, addedAt: number } | undefined} A copy of the entry.
     */
    get(id) {
      const key = String(id ?? '')
      const entry = file.read().workspaces.find((candidate) => candidate.id === key)
      return entry === undefined ? undefined : { ...entry }
    },

    /**
     * Replace the whole set and persist it.
     * @param {Array<{ id: string, fileName: string | null, addedAt: number }>} entries New entries.
     * @returns {void}
     */
    set(entries) {
      if (!Array.isArray(entries)) throw new Error('set() requires an array of workspace entries')
      file.write(normalizeAddedState(entries))
    },

    /**
     * Persist the prompt file name assigned to an already added workspace.
     * @param {string} id Workspace id.
     * @param {string} fileName Prompt file name.
     * @returns {void}
     * @throws {Error} When the workspace is not in the added set or the name is empty.
     */
    assignFileName(id, fileName) {
      const key = String(id ?? '')
      const name = String(fileName ?? '')
      if (name === '') throw new Error(`cannot assign an empty prompt file name to workspace ${key}`)
      file.update((state) => {
        const index = state.workspaces.findIndex((entry) => entry.id === key)
        if (index === -1) throw new Error(`workspace ${key} is not in the added workspace set`)
        return {
          version: STATE_VERSION,
          workspaces: state.workspaces.map((entry, entryIndex) => (
            entryIndex === index ? { ...entry, fileName: name } : entry
          )),
        }
      })
    },
  }
}

/** @param {unknown} value @returns {boolean} Whether `value` is a plain object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
