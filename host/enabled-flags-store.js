/**
 * Enabled flags for workspace prompts, persisted in `state/enabled.json`.
 *
 * Only enabled workspaces are stored (`{ "<workspaceId>": true }`); a missing file,
 * a corrupt file, or a plain `false` value all mean "not enabled". The injection
 * hot path reads this store synchronously on every model step, so the JSON accessor
 * caches parsed state by `mtime + size`.
 *
 * On-disk format (versioned for future migrations):
 *   { "version": 1, "enabled": { "ws_x": true } }
 */

import { join } from 'node:path'

import { createJsonFile } from './json-file.js'

/** Current state file version. */
const STATE_VERSION = 1

/** State file name inside the state directory. */
const STATE_FILE_NAME = 'enabled.json'

/**
 * Normalize arbitrary parsed JSON into the enabled-flags state shape.
 * Accepts both the versioned object and the legacy bare `{ "<id>": true }` map.
 * @param {unknown} raw Parsed JSON value.
 * @returns {{ version: 1, enabled: Record<string, true> }} Tolerant normalized state.
 */
export function normalizeEnabledState(raw) {
  let source = {}
  if (isPlainObject(raw)) {
    source = isPlainObject(raw.enabled) ? raw.enabled : raw
  }
  const enabled = {}
  for (const [id, value] of Object.entries(source)) {
    if (id.trim() === '') continue
    if (value === true) enabled[id] = true
  }
  return { version: STATE_VERSION, enabled }
}

/**
 * Create the enabled-flags store.
 * @param {object} options Store options.
 * @param {string} options.stateDirectory Absolute state directory path.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{
 *   isEnabled: (id: string) => boolean,
 *   enabledIds: () => string[],
 *   set: (id: string, enabled: boolean) => void,
 *   remove: (ids: string[]) => void,
 * }} Enabled-flags store.
 */
export function createEnabledFlagsStore({ stateDirectory, onWarn } = {}) {
  if (typeof stateDirectory !== 'string' || stateDirectory.trim() === '') {
    throw new Error('createEnabledFlagsStore requires a non-empty state directory')
  }
  const file = createJsonFile({
    path: join(stateDirectory, STATE_FILE_NAME),
    normalize: normalizeEnabledState,
    onWarn,
  })

  return {
    /** @param {string} id Workspace id. @returns {boolean} Whether the prompt is enabled. */
    isEnabled(id) {
      const key = String(id ?? '')
      if (key === '') return false
      return file.read().enabled[key] === true
    },

    /** @returns {string[]} Ids of all enabled workspaces. */
    enabledIds() {
      return Object.keys(file.read().enabled)
    },

    /**
     * Persist one flag; `false` removes the key instead of storing `false`.
     * @param {string} id Workspace id.
     * @param {boolean} enabled Next state.
     * @returns {void}
     * @throws {Error} When the id is empty or the file cannot be written.
     */
    set(id, enabled) {
      const key = String(id ?? '')
      if (key === '') throw new Error('cannot record an enabled flag without a workspace id')
      file.update((state) => {
        const next = { ...state.enabled }
        if (enabled === true) next[key] = true
        else delete next[key]
        return { version: STATE_VERSION, enabled: next }
      })
    },

    /**
     * Remove several flags at once (used when workspaces are removed).
     * @param {string[]} ids Workspace ids.
     * @returns {void}
     */
    remove(ids) {
      const keys = Array.isArray(ids) ? ids.map((id) => String(id ?? '')) : []
      if (keys.length === 0) return
      file.update((state) => {
        const next = { ...state.enabled }
        let changed = false
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(next, key)) {
            delete next[key]
            changed = true
          }
        }
        return changed ? { version: STATE_VERSION, enabled: next } : undefined
      })
    },
  }
}

/** @param {unknown} value @returns {boolean} Whether `value` is a plain object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
