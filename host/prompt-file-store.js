/**
 * Prompt body files: one Markdown file per workspace inside the prompt directory.
 *
 * Responsibilities:
 *   - sanitize workspace names into safe file name stems;
 *   - allocate a unique `<name>.md` file name (`-2`, `-3`, ... on conflicts);
 *   - synchronous reads with an `mtime + size` cache for the injection hot path;
 *   - atomic writes (temporary file + rename) serialized per file name.
 *
 * Reads are synchronous on purpose: the `systemPrompt.context()` text callback
 * must return a string synchronously and runs on every model step.
 */

import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { workspaceDisplayName } from './workspace-resolver.js'

/** Maximum allowed prompt body length in characters. */
export const MAX_PROMPT_CHARACTERS = 200000

/** Maximum length of the sanitized file name stem (without `.md`). */
const MAX_FILE_NAME_LENGTH = 80

/** Characters that must be removed: Windows forbidden characters plus C0 controls and DEL. */
const ILLEGAL_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f\\/:*?"<>|]/g

/** Whitespace and dots trimmed from both edges (Windows drops trailing dots). */
const EDGE_PADDING = /^[\s.]+|[\s.]+$/g

/**
 * Windows reserved device names. Writing `CON.md` would target a device instead
 * of a file, so a `_` prefix is added after sanitizing.
 */
const WINDOWS_RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i

/**
 * Sanitize a workspace title into a safe file name stem.
 * Illegal characters are removed, edges trimmed, the result truncated to 80
 * characters, and reserved Windows device names get a `_` prefix.
 * @param {unknown} title Raw workspace title.
 * @returns {string} Sanitized stem; may be empty when nothing usable is left.
 */
export function sanitizeWorkspaceName(title) {
  const cleaned = String(title ?? '')
    .replace(ILLEGAL_FILE_NAME_CHARACTERS, '')
    .replace(EDGE_PADDING, '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .replace(EDGE_PADDING, '')
  if (cleaned === '') return ''
  return WINDOWS_RESERVED_DEVICE_NAMES.test(cleaned) ? `_${cleaned}` : cleaned
}

/**
 * Whether a file name is safe to use inside the prompt directory.
 * @param {unknown} fileName Candidate file name.
 * @returns {boolean} True for non-empty, separator-free, control-free names ending in `.md`.
 */
export function isSafePromptFileName(fileName) {
  if (typeof fileName !== 'string') return false
  if (fileName === '' || fileName.trim() !== fileName) return false
  if (!fileName.endsWith('.md')) return false
  if (/[\\/]/.test(fileName)) return false
  if (/[\u0000-\u001f\u007f:*?"<>|]/.test(fileName)) return false
  const stem = fileName.slice(0, -3).trim()
  return stem !== '' && stem !== '.' && stem !== '..'
}

/**
 * Create a prompt file store for one prompt directory.
 * @param {object} options Store options.
 * @param {string} options.directory Absolute prompt directory path.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{
 *   directory: string,
 *   ensureDirectory: () => void,
 *   readSync: (fileName: string) => string,
 *   hasContent: (fileName: string) => boolean,
 *   write: (fileName: string, content: string) => Promise<void>,
 *   remove: (fileName: string) => Promise<void>,
 *   listFileNames: () => string[],
 *   allocateFileName: (workspace: object, takenFileNames?: string[]) => string,
 * }} Prompt file store.
 */
export function createPromptFileStore({ directory, onWarn } = {}) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new Error('createPromptFileStore requires a non-empty prompt directory')
  }
  const root = directory
  const warn = typeof onWarn === 'function' ? onWarn : () => {}

  /** @type {Map<string, { mtimeMs: number, size: number, content: string }>} */
  const cache = new Map()
  /** Serializes writes/removals per file name so concurrent operations cannot interleave. */
  const pending = new Map()
  let writeSequence = 0

  /** Create the prompt directory (`mkdir -p`). @returns {void} */
  function ensureDirectory() {
    try {
      mkdirSync(root, { recursive: true })
    } catch (error) {
      throw new Error(`failed to create the prompt directory "${root}": ${describeError(error)}`)
    }
  }

  /**
   * Synchronously read a prompt body, cached by `mtime + size`.
   * @param {string} fileName File name inside the prompt directory.
   * @returns {string} Body; missing, unsafe or unreadable files yield ''.
   */
  function readSync(fileName) {
    if (!isSafePromptFileName(fileName)) return ''
    const filePath = join(root, fileName)
    const cached = cache.get(fileName)
    try {
      const info = statSync(filePath)
      if (!info.isFile()) return ''
      if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return cached.content
      }
      const content = readFileSync(filePath, 'utf8')
      cache.set(fileName, { mtimeMs: info.mtimeMs, size: info.size, content })
      return content
    } catch (error) {
      if (error?.code === 'ENOENT') {
        cache.delete(fileName)
        return ''
      }
      warn(`failed to read the prompt file <${filePath}>: ${describeError(error)}`)
      return cached !== undefined ? cached.content : ''
    }
  }

  /**
   * Whether a prompt body contains non-whitespace content.
   * @param {string} fileName File name inside the prompt directory.
   * @returns {boolean} True when the trimmed body is not empty.
   */
  function hasContent(fileName) {
    return readSync(fileName).trim() !== ''
  }

  /**
   * Enqueue one operation for a file name after any previous one for the same name.
   * @param {string} fileName File name inside the prompt directory.
   * @param {() => Promise<void>} operation Operation to run.
   * @returns {Promise<void>} Resolves/rejects with the operation result.
   */
  function enqueue(fileName, operation) {
    const previous = pending.get(fileName) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    pending.set(fileName, next.then(() => {}, () => {}))
    return next
  }

  /**
   * Atomically write a prompt body: temporary file + rename, serialized per name.
   * @param {string} fileName File name inside the prompt directory.
   * @param {string} content Full Markdown body.
   * @returns {Promise<void>} Resolves after the rename; rejects on IO failure.
   */
  function write(fileName, content) {
    if (!isSafePromptFileName(fileName)) {
      return Promise.reject(new Error(`refusing to write an unsafe prompt file name: ${String(fileName)}`))
    }
    const text = String(content)
    return enqueue(fileName, async () => {
      ensureDirectory()
      writeSequence += 1
      const filePath = join(root, fileName)
      const temporary = `${filePath}.tmp-${process.pid}-${writeSequence}`
      try {
        await writeFile(temporary, text, 'utf8')
        await rename(temporary, filePath)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {})
        cache.delete(fileName)
        throw new Error(`failed to write the prompt file <${filePath}>: ${describeError(error)}`)
      }
      cache.delete(fileName)
    })
  }

  /**
   * Remove a prompt file; a missing file is not an error.
   * @param {string} fileName File name inside the prompt directory.
   * @returns {Promise<void>} Resolves after removal; rejects on IO failure.
   */
  function remove(fileName) {
    if (!isSafePromptFileName(fileName)) {
      warn(`ignoring a request to remove an unsafe prompt file name: ${String(fileName)}`)
      return Promise.resolve()
    }
    return enqueue(fileName, async () => {
      const filePath = join(root, fileName)
      try {
        await rm(filePath, { force: true })
      } catch (error) {
        throw new Error(`failed to remove the prompt file <${filePath}>: ${describeError(error)}`)
      }
      cache.delete(fileName)
    })
  }

  /**
   * List the `*.md` file names currently present in the prompt directory.
   * @returns {string[]} Sorted file names; unreadable directory yields [].
   */
  function listFileNames() {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        warn(`failed to list the prompt directory <${root}>: ${describeError(error)}`)
      }
      return []
    }
    return entries
      .filter((entry) => entry.isFile() && isSafePromptFileName(entry.name))
      .map((entry) => entry.name)
      .sort()
  }

  /**
   * Allocate a non-conflicting prompt file name without writing to disk.
   * Conflicts are compared case-insensitively on win32, where the filesystem is.
   * @param {object} workspace Workspace object (`title`/`path`/`id`).
   * @param {string[]} [takenFileNames] File names already reserved by the caller.
   * @returns {string} `<sanitized workspace name || 'workspace'>.md` with `-2`, `-3` ... suffixes.
   */
  function allocateFileName(workspace, takenFileNames) {
    const stem = sanitizeWorkspaceName(workspaceDisplayName(workspace)) || 'workspace'
    const taken = new Set()
    if (Array.isArray(takenFileNames)) {
      for (const name of takenFileNames) {
        if (typeof name === 'string' && name !== '') taken.add(comparisonKey(name))
      }
    }
    for (const name of listFileNames()) taken.add(comparisonKey(name))

    let candidate = `${stem}.md`
    for (let suffix = 2; taken.has(comparisonKey(candidate)); suffix += 1) {
      candidate = `${stem}-${suffix}.md`
    }
    return candidate
  }

  return { directory: root, ensureDirectory, readSync, hasContent, write, remove, listFileNames, allocateFileName }
}

/**
 * Comparison key for file names: win32 filesystems are case-insensitive.
 * @param {string} fileName File name.
 * @returns {string} Key used for conflict detection.
 */
function comparisonKey(fileName) {
  return process.platform === 'win32' ? fileName.toLowerCase() : fileName
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
