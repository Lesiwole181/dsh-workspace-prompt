/**
 * `/api/workspacePrompt/*` routes registered on the Host `connection.fetch`
 * service (authenticated same-origin `/api` data plane).
 *
 * This module is a thin HTTP layer: it parses parameters, calls the prompt
 * service and serializes the result. All business rules and error codes live in
 * `prompt-service.js`.
 *
 * Response conventions:
 *   - success: HTTP 200 + `{ version: 1, ...value }`;
 *   - failure: `{ error: { code, details? } }` with a stable HTTP status;
 *   - every response carries `cache-control: no-store`.
 */

import { ERROR_CODES, WorkspacePromptError } from './prompt-service.js'

/** Common prefix of all browser-facing routes. */
export const ROUTE_BASE = '/api/workspacePrompt'

/** Route paths consumed by the browser half. */
export const ROUTES = {
  /** GET  → `{ promptDirectory, workspaces }` (only the added workspaces). */
  list: `${ROUTE_BASE}/list`,
  /** GET  → `{ workspaces }` (every DSH workspace with an `added` flag). */
  catalog: `${ROUTE_BASE}/catalog`,
  /** POST `{ add?, remove? }` → `{ added, removed, ignored, workspaces }`. */
  apply: `${ROUTE_BASE}/apply`,
  /** GET  `?workspaceId=` → `{ workspace, content }`. */
  content: `${ROUTE_BASE}/content`,
  /** POST `{ workspaceId, content }` → `{ workspace, savedAt }`. */
  save: `${ROUTE_BASE}/save`,
  /** POST `{ workspaceId, enabled }` → `{ workspace }`. */
  enable: `${ROUTE_BASE}/enable`,
}

/** HTTP status for each business error code. */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.badRequest]: 400,
  [ERROR_CODES.workspaceNotFound]: 404,
  [ERROR_CODES.notAdded]: 409,
  [ERROR_CODES.contentTooLong]: 413,
  [ERROR_CODES.ioFailed]: 500,
})

/**
 * Create the route definitions for `connection.fetch.register()`.
 * @param {object} options Route dependencies.
 * @param {object} options.service Prompt service from `createPromptService()`.
 * @param {(message: string) => void} [options.onWarn] Warning sink.
 * @returns {Array<{ path: string, methods: string[], requestBody: 'buffered',
 *   fetch: (request: Request) => Promise<Response> }>} Route definitions.
 */
export function createWorkspacePromptRoutes({ service, onWarn } = {}) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {}

  /**
   * Map a thrown value to an error response; unexpected errors are reported.
   * @param {string} routePath Route path, used in diagnostics.
   * @param {unknown} error Thrown value.
   * @returns {Response} HTTP response.
   */
  function failureFor(routePath, error) {
    if (error instanceof WorkspacePromptError) {
      return failure(STATUS_BY_CODE[error.code] ?? 500, error.code, error.details)
    }
    warn(`unexpected error while handling ${routePath}: ${describeError(error)}`)
    return failure(500, ERROR_CODES.ioFailed, { reason: describeError(error) })
  }

  /**
   * Wrap one route implementation with JSON success/error handling.
   * @param {string} routePath Route path, used in diagnostics.
   * @param {(request: Request) => Promise<object>} implementation Route logic.
   * @returns {(request: Request) => Promise<Response>} Connection fetch handler.
   */
  function handle(routePath, implementation) {
    return async (request) => {
      try {
        return success(await implementation(request))
      } catch (error) {
        return failureFor(routePath, error)
      }
    }
  }

  /**
   * Read a required query parameter.
   * @param {Request} request Incoming request.
   * @param {string} name Parameter name.
   * @returns {string} Parameter value.
   * @throws {WorkspacePromptError} `bad-request` when missing or empty.
   */
  function requireQueryParameter(request, name) {
    let value
    try {
      value = new URL(request.url).searchParams.get(name)
    } catch (error) {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: name, reason: describeError(error) })
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: name })
    }
    return value
  }

  /**
   * Parse a request body that must be a JSON object.
   * @param {Request} request Incoming request.
   * @returns {Promise<object>} Parsed body.
   * @throws {WorkspacePromptError} `bad-request` when the body is not a JSON object.
   */
  async function requireJsonObject(request) {
    let parsed
    try {
      parsed = await request.json()
    } catch (error) {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'body', reason: describeError(error) })
    }
    if (!isPlainObject(parsed)) {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'body' })
    }
    return parsed
  }

  /**
   * Read the required `workspaceId` field of a JSON body.
   * @param {object} body Parsed body.
   * @returns {string} Workspace id.
   * @throws {WorkspacePromptError} `bad-request` when it is not a non-empty string.
   */
  function requireBodyWorkspaceId(body) {
    if (typeof body.workspaceId !== 'string' || body.workspaceId.trim() === '') {
      throw new WorkspacePromptError(ERROR_CODES.badRequest, { field: 'workspaceId' })
    }
    return body.workspaceId
  }

  const routes = [
    {
      path: ROUTES.list,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.list, async () => service.listAddedWorkspaces()),
    },
    {
      path: ROUTES.catalog,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.catalog, async () => service.listCatalog()),
    },
    {
      path: ROUTES.apply,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.apply, async (request) => {
        const body = await requireJsonObject(request)
        const result = await service.applyChanges({ add: body.add, remove: body.remove })
        return {
          added: Array.isArray(result?.added) ? result.added : [],
          removed: Array.isArray(result?.removed) ? result.removed : [],
          ignored: Array.isArray(result?.ignored) ? result.ignored : [],
          workspaces: Array.isArray(result?.list) ? result.list : [],
        }
      }),
    },
    {
      path: ROUTES.content,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.content, async (request) => (
        service.readWorkspace(requireQueryParameter(request, 'workspaceId'))
      )),
    },
    {
      path: ROUTES.save,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.save, async (request) => {
        const body = await requireJsonObject(request)
        return service.saveContent(requireBodyWorkspaceId(body), body.content)
      }),
    },
    {
      path: ROUTES.enable,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handle(ROUTES.enable, async (request) => {
        const body = await requireJsonObject(request)
        return service.setEnabled(requireBodyWorkspaceId(body), body.enabled)
      }),
    },
  ]

  return routes
}

/**
 * Build a success response: `{ version: 1, ...value }` with `cache-control: no-store`.
 * @param {object} value Response fields.
 * @returns {Response} HTTP response.
 */
function success(value) {
  return Response.json(
    { version: 1, ...value },
    { headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Build an error response.
 * @param {number} status HTTP status.
 * @param {string} code Stable error code.
 * @param {Record<string, unknown>} [details] Structured details, omitted when empty.
 * @returns {Response} HTTP response.
 */
function failure(status, code, details) {
  const error = { code }
  if (isPlainObject(details) && Object.keys(details).length > 0) {
    error.details = details
  }
  return Response.json(
    { error },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

/** @param {unknown} value @returns {boolean} Whether `value` is a plain object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} error @returns {string} One readable line. */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
