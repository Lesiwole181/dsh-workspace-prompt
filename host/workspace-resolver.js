/**
 * Workspace naming and session-to-workspace path matching.
 *
 * Everything here is pure and synchronous: the prompt-injection callback runs on
 * every model step and cannot await, so `findWorkspaceByCwd()` matches the
 * session `header.cwd` against the synchronous `workspaceRegistry.list()`
 * projection.
 *
 * Matching rules mirror the Host's own workspace grouping semantics:
 *   1. exact normalized path match first;
 *   2. otherwise the deepest workspace whose path is a prefix of the cwd
 *      (`<workspace path>/<sub directory>`), so `cd`-ing into a subdirectory
 *      keeps the session attributed to the workspace.
 */

/**
 * Human-readable workspace name: title, else the last path segment, else the id.
 * @param {object} [workspace] Workspace as returned by `workspaceRegistry.list()`.
 * @returns {string} Display name; may be an empty string when nothing is known.
 */
export function workspaceDisplayName(workspace) {
  const title = String(workspace?.title ?? '').trim()
  if (title !== '') return title
  // Keep the segment as-is (no lowercasing): this string is shown to the user
  // and used to name prompt files.
  const path = String(workspace?.path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (path !== '') {
    const segment = path.slice(path.lastIndexOf('/') + 1)
    if (segment !== '') return segment
  }
  return String(workspace?.id ?? '').trim()
}

/**
 * Normalize a path for comparisons: stringify, trim, backslashes to slashes,
 * drop trailing slashes, and lowercase on win32 (case-insensitive filesystem).
 * @param {unknown} value Raw path.
 * @returns {string} Normalized path; empty input yields an empty string.
 */
export function normalizePath(value) {
  const text = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? text.toLowerCase() : text
}

/**
 * Find the workspace owning a session cwd.
 * @param {unknown} workspaces Workspace list from `workspaceRegistry.list()`.
 * @param {unknown} cwd Session working directory.
 * @returns {object | undefined} The original workspace object, or undefined.
 */
export function findWorkspaceByCwd(workspaces, cwd) {
  const target = normalizePath(cwd)
  if (target === '' || !Array.isArray(workspaces)) return undefined

  let exact
  let deepest
  let deepestLength = -1
  for (const workspace of workspaces) {
    if (workspace === null || typeof workspace !== 'object') continue
    const path = normalizePath(workspace.path)
    if (path === '') continue
    if (path === target) {
      exact = workspace
      break
    }
    if (target.startsWith(`${path}/`) && path.length > deepestLength) {
      deepest = workspace
      deepestLength = path.length
    }
  }
  return exact !== undefined ? exact : deepest
}

/**
 * Build the stable workspace shape shared by the API responses.
 * @param {object} [workspace] Workspace as returned by `workspaceRegistry.list()`.
 * @returns {{ id: string, title: string, path: string, name: string }} Defensive summary.
 */
export function toWorkspaceSummary(workspace) {
  return {
    id: String(workspace?.id ?? ''),
    title: String(workspace?.title ?? ''),
    path: String(workspace?.path ?? ''),
    name: workspaceDisplayName(workspace),
  }
}
