/**
 * dsh-workspace-prompt — Host entry.
 *
 * This file only assembles modules and registers effects; every business rule
 * lives in `host/*.js`:
 *
 *   - data directories / prompt files / added workspaces / enabled flags
 *   - the prompt service (the single implementation of every operation)
 *   - the `systemPrompt.context()` contribution injected at each model step
 *   - the `/api/workspacePrompt/*` routes consumed by the browser half
 *
 * Activation strategy: `ctx.inject` keeps the plugin loaded even when a service
 * is unavailable, and registers everything on a child context that is disposed
 * with the dependency. `connection` is treated as optional so that a headless /
 * TUI composition still gets prompt injection without browser routes.
 *
 * No third-party imports: only `node:` builtins and the plugin's own modules, so
 * a future DSH package upgrade cannot break module resolution here.
 */

import { resolveDataDirectories, ensureDirectories } from './host/data-directories.js'
import { createAddedWorkspacesStore } from './host/added-workspaces-store.js'
import { createEnabledFlagsStore } from './host/enabled-flags-store.js'
import { createPromptFileStore } from './host/prompt-file-store.js'
import { createPromptService } from './host/prompt-service.js'
import { createWorkspacePromptContext } from './host/injection.js'
import { createWorkspacePromptRoutes } from './host/api-routes.js'

/** Services that must exist before the plugin can do anything useful. */
const REQUIRED_SERVICES = ['systemPrompt', 'workspaceRegistry']

/** Plugin display name used in log lines. */
const LABEL = 'dsh-workspace-prompt'

/**
 * Activate the Host half.
 * @param {object} ctx Host Cordis context.
 * @param {object} [config] Row config from `cordis.patch.yml`:
 *   `{ promptDirectory?: string, stateDirectory?: string }`.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  ctx.inject(REQUIRED_SERVICES, (readyCtx) => {
    try {
      activate(readyCtx, config)
    } catch (error) {
      const message = `[${LABEL}] activation failed: ${describeError(error)}`
      if (typeof readyCtx.logger?.error === 'function') readyCtx.logger.error(message)
      else console.error(message, error)
    }
  })
}

/**
 * Build the stores/service and register the plugin's effects.
 * @param {object} ctx Context with `systemPrompt` and `workspaceRegistry`.
 * @param {object} config Row config.
 * @returns {void}
 */
function activate(ctx, config) {
  const warn = createWarner(ctx)
  const directories = resolveDataDirectories(isPlainObject(config) ? config : {})
  for (const warning of directories.warnings) warn(warning)

  try {
    ensureDirectories(directories)
  } catch (error) {
    warn(`could not create the data directories: ${describeError(error)}; saving prompts may fail`)
  }

  const promptFileStore = createPromptFileStore({
    directory: directories.promptDirectory,
    onWarn: warn,
  })
  const addedStore = createAddedWorkspacesStore({
    stateDirectory: directories.stateDirectory,
    onWarn: warn,
  })
  const enabledStore = createEnabledFlagsStore({
    stateDirectory: directories.stateDirectory,
    onWarn: warn,
  })
  const service = createPromptService({
    workspaceRegistry: ctx.workspaceRegistry,
    addedStore,
    enabledStore,
    promptFileStore,
    onWarn: warn,
  })

  // Workspace prompt injection: evaluated on every model step, synchronous.
  ctx.effect(
    () => ctx.systemPrompt.context(createWorkspacePromptContext({
      systemPrompt: ctx.systemPrompt,
      service,
      onWarn: warn,
    })),
    `${LABEL}: workspace prompt context`,
  )

  // Browser data plane. `connection` is optional: without it (headless/TUI
  // compositions) injection still works and only the settings page is inert.
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
  if (connection !== undefined && connection !== null && typeof connection.fetch?.register === 'function') {
    for (const route of createWorkspacePromptRoutes({ service, onWarn: warn })) {
      ctx.effect(
        () => connection.fetch.register(route),
        `${LABEL}: route ${route.path}`,
      )
    }
  } else {
    warn('connection service is unavailable; browser routes are disabled but prompt injection stays active')
  }

  ctx.logger?.info?.(
    `[${LABEL}] ready (prompt directory: ${directories.promptDirectory}, state directory: ${directories.stateDirectory})`,
  )
}

/**
 * Build a de-duplicating warning sink wired to the Host logger.
 * The injection callback runs on every model step, so repeated failures must
 * not flood the log.
 * @param {object} ctx Host context.
 * @returns {(message: string) => void} Warning sink.
 */
function createWarner(ctx) {
  const seen = new Set()
  return (message) => {
    const text = `[${LABEL}] ${message}`
    if (seen.has(text)) return
    if (seen.size >= 100) seen.clear()
    seen.add(text)
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(text)
    else console.warn(text)
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
