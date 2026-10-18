/**
 * `systemPrompt.context()` contribution that injects the workspace prompt.
 *
 * Why a runtime context instead of a system-prompt section or an inbox message:
 * `systemPrompt.context` is evaluated on every model step and materialized as a
 * context snapshot, and the Chat view explicitly hides ordinary context rows, so
 * the prompt reaches the model without appearing as a conversation bubble.
 *
 * The text callback is synchronous and must never throw into the model loop:
 * every failure is caught, reported through the warning sink (de-duplicated) and
 * degrades to an empty string, which means "no contribution".
 */

/** Fixed context name; never collides with a built-in context. */
export const CONTEXT_NAME = 'workspace-prompt:current'

/** Offset after the working-directory context. */
const CONTEXT_ORDER_OFFSET = 10

/** Order value used when `getContextOrder('WORKING_DIRECTORY')` is unavailable. */
const CONTEXT_ORDER_FALLBACK = 100 + CONTEXT_ORDER_OFFSET

/**
 * Compute the injection context order: right after the working-directory context.
 * @param {object} systemPrompt `ctx.systemPrompt`.
 * @param {(message: string) => void} [onWarn] Warning sink.
 * @returns {number} Sort order; falls back to 110 when the base order is unknown.
 */
export function injectionContextOrder(systemPrompt, onWarn) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  try {
    const base = systemPrompt?.getContextOrder?.('WORKING_DIRECTORY')
    if (typeof base === 'number' && Number.isFinite(base)) return base + CONTEXT_ORDER_OFFSET
    warn(`could not read the WORKING_DIRECTORY context order (got ${String(base)}); using ${CONTEXT_ORDER_FALLBACK}`)
  } catch (error) {
    warn(`could not read the WORKING_DIRECTORY context order; using ${CONTEXT_ORDER_FALLBACK}: ${describeError(error)}`)
  }
  return CONTEXT_ORDER_FALLBACK
}

/**
 * Build the model-readable injection text: one English attribution line, a blank
 * line, then the prompt body as written (only trailing whitespace is dropped).
 * @param {unknown} workspaceName Workspace display name.
 * @param {unknown} body Prompt body.
 * @returns {string} Text contributed to the system prompt.
 */
export function buildInjectionText(workspaceName, body) {
  const name = String(workspaceName ?? '')
  const header = `Workspace prompt for workspace "${name}". The user configured this prompt for the whole workspace; apply it in addition to the system instructions.`
  return `${header}\n\n${String(body ?? '').trimEnd()}`
}

/**
 * Create the definition object to pass to `ctx.systemPrompt.context()`.
 * @param {object} options Dependencies.
 * @param {object} options.systemPrompt `ctx.systemPrompt`.
 * @param {object} options.service Prompt service (`resolvePromptForCwd`).
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {{ name: string, order: number, required: true, interpolate: false,
 *   text: (assembleContext: object) => string }} Context definition.
 */
export function createWorkspacePromptContext({ systemPrompt, service, onWarn } = {}) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}
  const reported = new Set()

  /**
   * Report a warning once per distinct message; the callback runs on every step.
   * @param {string} message Warning text.
   * @returns {void}
   */
  const reportOnce = (message) => {
    if (reported.has(message)) return
    if (reported.size >= 100) reported.clear()
    reported.add(message)
    warn(message)
  }

  return {
    name: CONTEXT_NAME,
    order: injectionContextOrder(systemPrompt, warn),
    required: true,
    interpolate: false,

    /**
     * Evaluate the contribution for one model step.
     * @param {object} assembleContext `AssembleContext`; `agent` is a runtime field.
     * @returns {string} Prompt text, or '' when nothing should be injected.
     */
    text(assembleContext) {
      try {
        const cwd = assembleContext?.agent?.session?.header?.cwd
        if (typeof cwd !== 'string' || cwd.trim() === '') return ''
        const resolved = service?.resolvePromptForCwd?.(cwd)
        if (resolved === undefined || resolved === null) return ''
        const body = String(resolved.body ?? '')
        if (body.trim() === '') return ''
        return buildInjectionText(resolved.workspace?.name ?? '', body)
      } catch (error) {
        reportOnce(`failed to inject the workspace prompt: ${describeError(error)}`)
        return ''
      }
    },
  }
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
