/**
 * Small JSON file accessor with a `mtime + size` read cache and atomic writes.
 *
 * Every state store of the plugin (`state/workspaces.json`, `state/enabled.json`)
 * is a tiny JSON document that another process (Web + Desktop running at the same
 * time) may replace at any moment. This module centralizes the consistency rules:
 *
 * - reads stat the file first and re-parse only when `mtimeMs` or `size` changed,
 *   so the synchronous prompt-injection path does not hit the disk repeatedly;
 * - a missing or corrupt file never throws: `normalize(undefined)` supplies the
 *   default state instead;
 * - writes go to a temporary file in the same directory followed by `rename`,
 *   which is atomic on NTFS/ext4, so a reader never observes a half-written file.
 *
 * Only `node:` builtins are used.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Monotonic counter keeping temporary file names unique inside one process. */
let writeSequence = 0

/**
 * Create an accessor for one JSON file.
 * @param {object} options Accessor options.
 * @param {string} options.path Absolute path of the JSON file.
 * @param {(raw: unknown) => unknown} options.normalize Tolerant normalizer; must never throw.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{ path: string, read: () => any, write: (value: any) => void,
 *   update: (mutator: (current: any) => any) => any, invalidate: () => void }}
 *   Accessor object; `read`/`write`/`update` are synchronous.
 */
export function createJsonFile({ path, normalize, onWarn } = {}) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('createJsonFile requires a non-empty file path')
  }
  const filePath = path
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  const normalizer = typeof normalize === 'function' ? normalize : (raw) => raw

  /** @type {{ mtimeMs: number, size: number, value: any } | undefined} */
  let cache

  /**
   * Apply the caller's normalizer without ever letting it break a read.
   * @param {unknown} raw Parsed JSON value or undefined.
   * @returns {any} Normalized value.
   */
  function safeNormalize(raw) {
    try {
      return normalizer(raw)
    } catch (error) {
      warn(`normalize() failed for JSON file <${filePath}>: ${describeError(error)}; using defaults`)
      try {
        return normalizer(undefined)
      } catch {
        return undefined
      }
    }
  }

  /**
   * Read the file, reusing the cached value while `mtimeMs` and `size` match.
   * @returns {any} Normalized state; missing or corrupt files yield `normalize(undefined)`.
   */
  function read() {
    try {
      const info = statSync(filePath)
      if (!info.isFile()) {
        warn(`JSON file path <${filePath}> is not a regular file; using defaults`)
        cache = undefined
        return safeNormalize(undefined)
      }
      if (cache !== undefined && cache.mtimeMs === info.mtimeMs && cache.size === info.size) {
        return cache.value
      }
      const raw = readFileSync(filePath, 'utf8')
      let value
      try {
        value = safeNormalize(JSON.parse(raw))
      } catch (error) {
        warn(`JSON file <${filePath}> is corrupt (${describeError(error)}); using defaults`)
        value = safeNormalize(undefined)
      }
      cache = { mtimeMs: info.mtimeMs, size: info.size, value }
      return value
    } catch (error) {
      if (error?.code === 'ENOENT') {
        cache = undefined
        return safeNormalize(undefined)
      }
      warn(`failed to read JSON file <${filePath}>: ${describeError(error)}`)
      return cache !== undefined ? cache.value : safeNormalize(undefined)
    }
  }

  /**
   * Atomically replace the file content: temporary file in the same directory + rename.
   * @param {any} value Value to serialize.
   * @returns {void}
   * @throws {Error} When the directory or file cannot be written.
   */
  function write(value) {
    let temporary
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeSequence += 1
      temporary = `${filePath}.tmp-${process.pid}-${writeSequence}`
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      renameSync(temporary, filePath)
    } catch (error) {
      if (temporary !== undefined) {
        try {
          rmSync(temporary, { force: true })
        } catch {
          // Best-effort cleanup; the original error is what matters.
        }
      }
      cache = undefined
      throw new Error(`failed to write JSON file <${filePath}>: ${describeError(error)}`)
    }
    cache = undefined
  }

  /**
   * Read, mutate and (when the mutator returns a value) persist.
   * @param {(current: any) => any} mutator Mutator; returning `undefined` keeps unchanged.
   * @returns {any} Final value.
   */
  function update(mutator) {
    if (typeof mutator !== 'function') throw new Error('update() requires a mutator function')
    const current = read()
    const next = mutator(current)
    if (next === undefined) return current
    write(next)
    return next
  }

  /** Drop the cached parsed value; the next `read()` stats and re-parses. */
  function invalidate() {
    cache = undefined
  }

  return { path: filePath, read, write, update, invalidate }
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
