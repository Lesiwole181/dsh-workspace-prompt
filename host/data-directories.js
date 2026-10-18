/**
 * Data directory resolution for the Host half.
 *
 * The plugin keeps its runtime data inside the package by default:
 * `<package root>/prompt` holds one Markdown file per workspace prompt and
 * `<package root>/state` holds the JSON state files. A locally linked plugin is
 * therefore self-contained and survives restarts.
 *
 * Override precedence for the prompt directory:
 *   1. `DSH_WORKSPACE_PROMPT_DIR`, only when it is an absolute path;
 *   2. `config.promptDirectory` (relative paths resolve against the package root);
 *   3. `<package root>/prompt`.
 * The state directory can only be overridden through `config.stateDirectory`.
 *
 * `resolveDataDirectories()` is a pure function: it never touches the disk.
 * Only `ensureDirectories()` writes.
 */

import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the plugin package (the parent of `host/`). */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Default directory holding one Markdown file per workspace prompt. */
export const DEFAULT_PROMPT_DIRECTORY = join(PACKAGE_ROOT, 'prompt')

/** Default directory holding the plugin's JSON state files. */
export const DEFAULT_STATE_DIRECTORY = join(PACKAGE_ROOT, 'state')

/** Environment variable naming an absolute prompt directory override. */
export const PROMPT_DIRECTORY_ENV = 'DSH_WORKSPACE_PROMPT_DIR'

/**
 * Resolve the effective data directories.
 * @param {unknown} config Row config: `{ promptDirectory?: string, stateDirectory?: string }`.
 * @param {Record<string, string | undefined>} [env] Process environment (defaults to `process.env`).
 * @returns {{ promptDirectory: string, stateDirectory: string, warnings: string[] }}
 *   Absolute directories plus non-fatal warnings for ignored configuration.
 */
export function resolveDataDirectories(config, env = process.env) {
  const warnings = []
  const settings = isPlainObject(config) ? config : {}
  const environment = isPlainObject(env) ? env : {}

  // Environment override wins, but only when it is an absolute path: a relative
  // value would silently depend on the Host process working directory.
  let promptDirectory
  const fromEnvironment = environment[PROMPT_DIRECTORY_ENV]
  if (isNonEmptyString(fromEnvironment)) {
    const candidate = fromEnvironment.trim()
    if (isAbsolute(candidate)) {
      promptDirectory = candidate
    } else {
      warnings.push(`${PROMPT_DIRECTORY_ENV} must be an absolute path; ignored "${fromEnvironment}"`)
    }
  }
  if (promptDirectory === undefined) {
    promptDirectory = resolveDirectory(settings.promptDirectory) ?? DEFAULT_PROMPT_DIRECTORY
  }
  const stateDirectory = resolveDirectory(settings.stateDirectory) ?? DEFAULT_STATE_DIRECTORY

  return { promptDirectory, stateDirectory, warnings }
}

/**
 * Recursively create the prompt and state directories.
 * @param {{ promptDirectory?: string, stateDirectory?: string }} directories Resolved directories.
 * @returns {void}
 * @throws {Error} When a directory cannot be created.
 */
export function ensureDirectories({ promptDirectory, stateDirectory } = {}) {
  createDirectory(promptDirectory, 'prompt')
  createDirectory(stateDirectory, 'state')
}

/**
 * Resolve one configured directory.
 * @param {unknown} value Configured value.
 * @returns {string | undefined} Absolute directory, or undefined when not configured.
 */
function resolveDirectory(value) {
  if (!isNonEmptyString(value)) return undefined
  const candidate = value.trim()
  return isAbsolute(candidate) ? candidate : resolve(PACKAGE_ROOT, candidate)
}

/**
 * Create one directory, wrapping IO failures with the directory context.
 * @param {unknown} directory Absolute directory path.
 * @param {string} label Human readable role used in the error message.
 * @returns {void}
 */
function createDirectory(directory, label) {
  if (!isNonEmptyString(directory)) {
    throw new Error(`cannot create the ${label} directory: no path was resolved`)
  }
  const target = directory.trim()
  try {
    mkdirSync(target, { recursive: true })
  } catch (error) {
    throw new Error(`failed to create the ${label} directory "${target}": ${describeError(error)}`)
  }
}

/** @param {unknown} value @returns {boolean} Whether `value` is a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** @param {unknown} value @returns {boolean} Whether `value` is a plain object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
