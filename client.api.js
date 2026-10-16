/**
 * The Host routes this browser half talks to, wrapped in one place.
 *
 * Every route is served inside the Connection gate at the same origin, so a
 * plain `fetch` is the whole transport. A failure body is always
 * `{ error: { code, message } }` with a human-readable reason the Host already
 * localizes, so the wrapper turns any non-2xx response into an `Error` carrying
 * exactly that message — callers never parse a status code twice.
 *
 * Addresses are **workspace** ids: the settings page lists workspaces, and the
 * Session a row used to carry no longer exists in this plugin's UI. The one
 * exception is `/latest`, which is deliberately parameterless — it reports the
 * newest injection decision of the whole Host, which is what lets the notice
 * work without the user having clicked anything first.
 *
 * This file is a self-contained package-local chunk: the only top-level
 * statement is its registration, and everything it needs lives in the factory
 * closure (a chunk cannot synchronously require a sibling `client*.js`).
 */
window.__ModuleLoader__.load({
  // The registration key is the package name, for the entry and every chunk
  // alike; `chunk` is what tells the two apart (the loader itself builds
  // `<package>/<chunk>` as the module-table id).
  id: 'dsh-workspace-prompt',
  chunk: 'client.api.js',
  factory() {
    /** Host route prefix for this plugin. */
    const BASE = '/api/workspacePrompt'

    /**
     * One JSON request.
     * @param path - route path below {@link BASE}.
     * @param init - method, body, and abort signal.
     * @returns the parsed success body.
     * @throws {Error} with the Host's `error.message` on a non-2xx response, the
     * transport message on a network failure, or `AbortError` when cancelled.
     */
    async function requestJson(path, init) {
      const response = await fetch(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        // A body that is not JSON (a proxy error page, a truncated response) has
        // no Host reason to show; the status is the only fact left.
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) {
        const message = payload?.error?.message
        throw new Error(typeof message === 'string' && message !== '' ? message : `HTTP ${response.status}`)
      }
      return payload
    }

    /** Build the query string of a workspace-scoped read. */
    function workspaceQuery(workspaceId) {
      return `?workspaceId=${encodeURIComponent(String(workspaceId))}`
    }

    /**
     * Read the newest injection decision of the whole Host (the notice's poll).
     *
     * Deliberately parameterless: the notice must work for a user who has never
     * opened this plugin's UI, so it cannot depend on a Session id.
     * @param signal - optional abort signal.
     * @returns `{ seq, injected, reason, sessionId, workspaceName, characters, injectedAt }`.
     */
    function readLatest(signal) {
      return requestJson('/latest', { signal })
    }

    /**
     * List every workspace with the prompt facts a list row shows.
     * @param signal - optional abort signal.
     * @returns `{ workspaces: [{ workspaceId, workspaceName, fileName, enabled, characters, hasContent }] }`.
     */
    function listWorkspaces(signal) {
      return requestJson('/workspaces', { signal })
    }

    /**
     * Read one workspace's prompt: the switch, the file name, and the body.
     * @param workspaceId - the workspace to read.
     * @param signal - optional abort signal.
     * @returns `{ workspaceId, workspaceName, fileName, enabled, content, characters }`.
     */
    function readContent(workspaceId, signal) {
      return requestJson(`/content${workspaceQuery(workspaceId)}`, { signal })
    }

    /**
     * Write one workspace's prompt text.
     * @param workspaceId - the workspace that owns the file.
     * @param content - complete new text.
     * @param signal - optional abort signal.
     * @returns `{ fileName, characters, savedAt }`.
     */
    function savePrompt(workspaceId, content, signal) {
      return requestJson('/save', { method: 'POST', body: { workspaceId, content }, signal })
    }

    /**
     * Turn injection on or off for one workspace.
     * @param workspaceId - the workspace to toggle.
     * @param enabled - desired switch position.
     * @param signal - optional abort signal.
     * @returns `{ enabled }`.
     */
    function setEnabled(workspaceId, enabled, signal) {
      return requestJson('/enable', { method: 'POST', body: { workspaceId, enabled }, signal })
    }

    return { readLatest, listWorkspaces, readContent, savePrompt, setEnabled }
  },
})
