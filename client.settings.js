/**
 * The plugin's entry point: the settings page that owns the workspace list and
 * hosts the editor.
 *
 * This section is what replaced the Session-row button — the settings shell
 * mounts it as one `settings.section` contribution, and every row is a
 * workspace, not a Session:
 *
 * - the list comes from `GET /api/workspacePrompt/workspaces` (facts only, no
 *   bodies: the list must stay cheap on a Host that has many workspaces);
 * - a row shows the title, the switch state, and the body length, and its
 *   button hands `{ workspaceId, workspaceName }` to the shared store;
 * - the page and the editor share one React tree, so "the store holds a target"
 *   is simply the page's second view: the editor is rendered in place of the
 *   list, inside the settings content column. No overlay, no backdrop, nothing
 *   covering the rest of the panel;
 * - the list re-reads itself when the editor closes, because saving or toggling
 *   inside it is exactly what makes a row stale.
 *
 * The editor element is handed to React on **every** render, including while no
 * workspace is open; the editor itself returns null then. Keeping it mounted is
 * deliberate: its effects guard on the open target, and a component that is only
 * mounted on demand would move those listeners and aborts into a mount/unmount
 * cycle the entry cannot see. The committed tree still holds nothing while the
 * page shows the list.
 *
 * The page owns its own CSS and exports it, because the plugin ships one
 * stylesheet: the entry appends this string to `client.styles.js`'s string and
 * inserts both through the same `<style>` node. The editor's own rules live in
 * `client.styles.js`.
 *
 * The owner passes `{ close }` (the shell's only affordance to a section). It is
 * intentionally not used: the plugin's own back button is the way out of the
 * editor, and closing settings while editing would lose the user's place in the
 * panel.
 *
 * Self-contained chunk: `react` is the platform seed, and the shared store, the
 * bound translate function, the Host API, the icon set, the markdown renderer,
 * and the editor component arrive as props from the entry — a chunk cannot
 * synchronously require a sibling `client*.js`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.settings.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    /** Load lifecycle of the workspace list. */
    const LOAD = { LOADING: 'loading', IDLE: 'idle', FAILED: 'failed' }

    /**
     * Rules for the settings page. Every colour is a theme token — a literal
     * would stay light while the shell went dark.
     */
    const SETTINGS_STYLES = `
/* ---- settings section (settings.section) ---- */
.dwp-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.dwp-settings-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

/* The back control sits ABOVE the title while a workspace is open. */
.dwp-settings-back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 10px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.dwp-settings-back:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.dwp-settings-back:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-settings-back-label {
  white-space: nowrap;
}

.dwp-settings-intro {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  line-height: 1.6;
}

.dwp-settings-empty {
  margin: 0;
  padding: 16px 0;
  color: var(--dsw-alias-label-secondary);
}

.dwp-settings-error {
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
}

.dwp-ws-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  overflow: hidden;
}

.dwp-ws-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-ws-row:first-child {
  border-top: none;
}

.dwp-ws-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-ws-state {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
}

.dwp-ws-state[data-enabled='true'] {
  color: var(--dsw-alias-state-success-primary);
}

.dwp-ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}

.dwp-ws-state[data-enabled='true'] .dwp-ws-dot {
  background: var(--dsw-alias-state-success-primary);
}

.dwp-ws-count {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dwp-ws-edit,
.dwp-ws-retry {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}

.dwp-ws-edit:hover,
.dwp-ws-retry:hover {
  background: var(--dsw-alias-bg-layer-2);
}

.dwp-ws-edit:focus-visible,
.dwp-ws-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-ws-retry {
  margin-top: 10px;
}
`

    /** A short reason for a failed request. */
    function reasonOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** A finite numeric field of a Host answer, or `0`. */
    function count(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /**
     * One list row: the workspace, its switch state, its length, and the button
     * that opens the editor on it.
     * @param props - `{ workspace, t, icons, onEdit }`.
     * @returns the list item.
     */
    function WorkspaceRow({ workspace, t, icons, onEdit }) {
      const workspaceId = String(workspace?.workspaceId ?? '')
      const listed = typeof workspace?.workspaceName === 'string' ? workspace.workspaceName : ''
      const name = listed !== '' ? listed : workspaceId
      const enabled = workspace?.enabled === true
      // A workspace whose prompt was never opened has no file name yet — the Host
      // deliberately reports `''` instead of allocating one — so the tooltip is
      // simply absent until there is a file to name.
      const fileName = typeof workspace?.fileName === 'string' ? workspace.fileName : ''
      return h('li', { className: 'dwp-ws-row' }, [
        h('span', {
          key: 'name',
          className: 'dwp-ws-name',
          title: fileName !== '' ? fileName : undefined,
        }, name),
        h('span', {
          key: 'state',
          className: 'dwp-ws-state',
          'data-enabled': enabled ? 'true' : 'false',
        }, [
          h('span', { key: 'dot', className: 'dwp-ws-dot', 'aria-hidden': true }),
          enabled ? t('settings.enabled') : t('settings.disabled'),
        ]),
        h('span', { key: 'count', className: 'dwp-ws-count' },
          t('settings.characters', { characters: count(workspace?.characters) })),
        h('button', {
          key: 'edit',
          type: 'button',
          className: 'dwp-ws-edit',
          'aria-label': t('settings.editAria', { workspace: name }),
          onClick: () => { onEdit({ workspaceId, workspaceName: name }) },
        }, [
          h(icons.IconPromptOutline, { key: 'icon', size: 14 }),
          h('span', { key: 'text' }, t('action.edit')),
        ]),
      ])
    }

    /**
     * The settings page: the workspace list, or the editor in its place.
     * @param props - `{ store, t, api, icons, markdown, editor }` from the entry.
     *   The shell's own `{ close }` rides along in the wrapper's props and is
     *   deliberately not used (see the module header).
     * @returns the section element.
     */
    function WorkspacePromptSettings({ store, t, api, icons, markdown, editor }) {
      const target = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const editorOpen = target.open
      const Editor = typeof editor === 'function' ? editor : null

      const [phase, setPhase] = useState(LOAD.LOADING)
      const [error, setError] = useState('')
      const [workspaces, setWorkspaces] = useState([])
      const [revision, setRevision] = useState(0)
      const wasOpen = useRef(false)

      // One read per revision. The controller is aborted by the cleanup, so a
      // section that unmounts (or a retry that replaces the read) cancels the
      // request instead of leaking its answer.
      useEffect(() => {
        const controller = new AbortController()
        setPhase(LOAD.LOADING)
        setError('')
        ;(async () => {
          try {
            const answer = await api.listWorkspaces(controller.signal)
            if (controller.signal.aborted) return
            setWorkspaces(Array.isArray(answer?.workspaces) ? answer.workspaces : [])
            setPhase(LOAD.IDLE)
          } catch (caught) {
            if (controller.signal.aborted) return
            setError(reasonOf(caught))
            setPhase(LOAD.FAILED)
          }
        })()
        return () => { controller.abort() }
      }, [api, revision])

      // Leaving the editor is the one moment this list can be stale: the editor
      // saves bodies and flips switches through its own routes.
      useEffect(() => {
        const was = wasOpen.current
        wasOpen.current = editorOpen
        if (was && !editorOpen) setRevision((value) => value + 1)
      }, [editorOpen])

      const reload = () => { setRevision((value) => value + 1) }
      const openEditor = (next) => { store.open(next) }

      let body
      if (phase === LOAD.LOADING) {
        body = h('p', { key: 'loading', className: 'dwp-settings-empty' }, t('settings.loading'))
      } else if (phase === LOAD.FAILED) {
        body = h('div', { key: 'error', className: 'dwp-settings-error' }, [
          h('div', { key: 'reason', role: 'alert' }, t('settings.failed', { reason: error })),
          h('button', {
            key: 'retry',
            type: 'button',
            className: 'dwp-ws-retry',
            onClick: reload,
          }, t('action.retry')),
        ])
      } else if (workspaces.length === 0) {
        body = h('p', { key: 'empty', className: 'dwp-settings-empty' }, t('settings.empty'))
      } else {
        body = h('ul', { key: 'list', className: 'dwp-ws-list' }, workspaces.map((workspace) =>
          h(WorkspaceRow, {
            key: String(workspace?.workspaceId ?? ''),
            workspace,
            t,
            icons,
            onEdit: openEditor,
          })))
      }

      // The back control belongs to the page, not to the editor: it must sit
      // ABOVE the title, and it only exists while a workspace is open. The
      // editor stays a plain block in the column below the header.
      const back = editorOpen
        ? h('button', {
          key: 'back',
          type: 'button',
          className: 'dwp-settings-back',
          'aria-label': t('editor.backAria'),
          title: t('editor.backAria'),
          onClick: () => { store.requestClose() },
        }, [
          h('svg', {
            key: 'icon',
            width: 14,
            height: 14,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            focusable: false,
          }, [
            h('path', { key: 'shaft', d: 'M12.5 8H3.5' }),
            h('path', { key: 'head', d: 'M7 4.5L3.5 8 7 11.5' }),
          ]),
          h('span', { key: 'text', className: 'dwp-settings-back-label' }, t('action.back')),
        ])
        : null

      return h('section', {
        className: 'dwp-settings',
        'data-view': editorOpen ? 'editor' : 'list',
      }, [
        h('header', { key: 'head', className: 'dwp-settings-head' }, [
          back,
          h('h2', { key: 'title', className: 'dwp-settings-title' }, t('settings.title')),
          h('p', { key: 'intro', className: 'dwp-settings-intro' }, t('settings.intro')),
        ]),
        // The list is the committed body while no workspace is open; the editor
        // element is handed over either way and renders null until one is.
        editorOpen ? null : body,
        Editor === null ? null : h(Editor, { key: 'editor', store, t, api, icons, markdown }),
      ])
    }

    return { WorkspacePromptSettings, SETTINGS_STYLES }
  },
})
