/**
 * dsh-workspace-prompt — the browser half's only data face.
 *
 * Every route is served inside the Connection gate at the same origin, so a
 * plain `fetch` is the whole transport. A success body is `{ version: 1, ... }`
 * and a failure body is `{ error: { code, details? } }`; this module turns the
 * latter into an {@link ApiError} carrying the stable error code, and
 * {@link errorMessageKey} turns that code into the locale key the page renders.
 * Error text stays in the dictionaries, never on the wire.
 *
 * Self-contained chunk: nothing from the platform module table is needed (the
 * `fetch` used by default is the page global).
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.api.js',
  factory() {
    /** Host route prefix for this plugin. */
    const BASE_URL = '/api/workspacePrompt'

    /**
     * One failed request, described by the Host's stable error code.
     */
    class ApiError extends Error {
      /**
       * @param {string} code - Stable error code (`network`, `bad-request`, …).
       * @param {object} [details] - Extra Host details (e.g. `{ limit }`).
       * @param {number} [status] - HTTP status when a response was received.
       */
      constructor(code, details = {}, status = 0) {
        const normalizedCode = typeof code === 'string' && code !== '' ? code : 'unknown'
        super(normalizedCode)
        this.name = 'ApiError'
        this.code = normalizedCode
        this.details = details !== null && typeof details === 'object' ? details : {}
        this.status = typeof status === 'number' && Number.isFinite(status) ? status : 0
      }
    }

    /**
     * The locale key for an error's reason text.
     * @param {unknown} error - A caught value, normally an {@link ApiError}.
     * @returns {string} An i18n key.
     */
    function errorMessageKey(error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : ''
      switch (code) {
        case 'network':
          return 'error.network'
        case 'bad-request':
          return 'error.bad-request'
        case 'workspace-not-found':
          return 'error.workspace-not-found'
        case 'not-added':
          return 'error.not-added'
        case 'content-too-long':
          return 'error.content-too-long'
        case 'io-failed':
          return 'error.io-failed'
        case 'http':
          return 'error.http'
        default:
          return 'error.unknown'
      }
    }

    /**
     * A string field of a Host payload, with a fallback.
     * @param {unknown} value - Raw field.
     * @param {string} fallback - Value to use when the field is not a string.
     * @returns {string} The normalized string.
     */
    function stringField(value, fallback) {
      return typeof value === 'string' ? value : fallback
    }

    /**
     * An array field of a Host payload, or an empty array.
     * @param {unknown} value - Raw field.
     * @returns {Array<*>} The array.
     */
    function arrayField(value) {
      return Array.isArray(value) ? value : []
    }

    /**
     * An object field of a Host payload, or an empty object.
     * @param {unknown} value - Raw field.
     * @returns {Record<string, unknown>} The object.
     */
    function objectField(value) {
      return value !== null && typeof value === 'object' ? value : {}
    }

    /**
     * A short reason from a thrown non-Host value (a transport failure).
     * @param {unknown} error - Caught value.
     * @returns {string} The reason.
     */
    function reasonOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Build the API client bound to one Host route prefix.
     * @param {{ baseUrl?: string, fetchImpl?: Function }} [options] - Route
     *   prefix and transport override (tests inject a fake `fetch`).
     * @returns {object} The API methods documented in the contract.
     */
    function createWorkspacePromptApi(options = {}) {
      const configuration = options !== null && typeof options === 'object' ? options : {}
      const baseUrl = stringField(configuration.baseUrl, BASE_URL)
      let fetchImpl = typeof configuration.fetchImpl === 'function' ? configuration.fetchImpl : undefined
      // Resolved lazily so a page without a global fetch fails as a network
      // error inside its own call instead of at plugin registration time.
      if (fetchImpl === undefined && typeof fetch === 'function') fetchImpl = fetch

      /**
       * One request, normalized to its success payload.
       * @param {string} path - Path below the route prefix.
       * @param {{ method?: string, body?: object }} [init] - Request options.
       * @returns {Promise<Record<string, unknown>>} Parsed success payload.
       * @throws {ApiError} On transport, HTTP, or Host-reported failure.
       */
      async function request(path, init = {}) {
        if (fetchImpl === undefined) {
          throw new ApiError('network', { reason: 'fetch is unavailable' })
        }
        const requestInit = {
          method: typeof init.method === 'string' ? init.method : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        }
        if (init.body !== undefined) {
          requestInit.headers = { 'content-type': 'application/json' }
          requestInit.body = JSON.stringify(init.body)
        }
        let response
        try {
          response = await fetchImpl(`${baseUrl}${path}`, requestInit)
        } catch (error) {
          throw new ApiError('network', { reason: reasonOf(error) })
        }
        let payload
        try {
          payload = await response.json()
        } catch {
          const status = typeof response.status === 'number' ? response.status : 0
          throw new ApiError('http', { status }, status)
        }
        const status = typeof response.status === 'number' ? response.status : 0
        const payloadObject = payload !== null && typeof payload === 'object' ? payload : {}
        const hostError = payloadObject.error !== null && typeof payloadObject.error === 'object'
          ? payloadObject.error
          : undefined
        const responseFailed = response.ok === false || (status !== 0 && status >= 400) || hostError !== undefined
        if (responseFailed) {
          const code = hostError !== undefined ? stringField(hostError.code, 'http') : 'http'
          const details = hostError !== undefined ? objectField(hostError.details) : {}
          throw new ApiError(code, details, status)
        }
        return payloadObject
      }

      return {
        /**
         * List the added workspaces (the ones this page manages).
         * @returns {Promise<{ promptDirectory: string, workspaces: Array<object> }>} Added set.
         */
        async list() {
          const payload = await request('/list')
          return {
            promptDirectory: stringField(payload.promptDirectory, ''),
            workspaces: arrayField(payload.workspaces),
          }
        },

        /**
         * List every DSH workspace with its `added` flag.
         * @returns {Promise<{ workspaces: Array<object> }>} Catalog.
         */
        async catalog() {
          const payload = await request('/catalog')
          return { workspaces: arrayField(payload.workspaces) }
        },

        /**
         * Apply a batch add/remove diff.
         * @param {{ add?: Array<string>, remove?: Array<string> }} [changes] - Diff.
         * @returns {Promise<{ added: Array<string>, removed: Array<string>, ignored: Array<string>, workspaces: Array<object> }>} Result.
         */
        async apply(changes = {}) {
          const normalized = changes !== null && typeof changes === 'object' ? changes : {}
          const payload = await request('/apply', {
            method: 'POST',
            body: {
              add: arrayField(normalized.add),
              remove: arrayField(normalized.remove),
            },
          })
          return {
            added: arrayField(payload.added),
            removed: arrayField(payload.removed),
            ignored: arrayField(payload.ignored),
            workspaces: arrayField(payload.workspaces),
          }
        },

        /**
         * Read one workspace's prompt body and switch state.
         * @param {string} workspaceId - Workspace to read.
         * @returns {Promise<{ workspace: object, content: string }>} Workspace and body.
         */
        async readContent(workspaceId) {
          const payload = await request(`/content?workspaceId=${encodeURIComponent(String(workspaceId))}`)
          return {
            workspace: objectField(payload.workspace),
            content: stringField(payload.content, ''),
          }
        },

        /**
         * Write one workspace's prompt body.
         * @param {string} workspaceId - Workspace that owns the file.
         * @param {string} content - Complete new body.
         * @returns {Promise<{ workspace: object, savedAt: number }>} Updated facts.
         */
        async saveContent(workspaceId, content) {
          const payload = await request('/save', {
            method: 'POST',
            body: { workspaceId: String(workspaceId), content: typeof content === 'string' ? content : '' },
          })
          return {
            workspace: objectField(payload.workspace),
            savedAt: typeof payload.savedAt === 'number' && Number.isFinite(payload.savedAt)
              ? payload.savedAt
              : Date.now(),
          }
        },

        /**
         * Turn prompt injection on or off for one workspace.
         * @param {string} workspaceId - Workspace to toggle.
         * @param {boolean} enabled - Desired switch position.
         * @returns {Promise<{ workspace: object }>} Updated facts.
         */
        async setEnabled(workspaceId, enabled) {
          const payload = await request('/enable', {
            method: 'POST',
            body: { workspaceId: String(workspaceId), enabled: enabled === true },
          })
          return { workspace: objectField(payload.workspace) }
        },
      }
    }

    return { ApiError, errorMessageKey, createWorkspacePromptApi }
  },
})
