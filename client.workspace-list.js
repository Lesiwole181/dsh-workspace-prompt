/**
 * dsh-workspace-prompt — the settings page's first view: the added workspaces.
 *
 * One row per workspace the user added to this page (not every DSH workspace):
 * an enabled dot, the name, the path, and a meta line, with the whole row as a
 * button that opens the prompt editor. The only page-level action is
 * "Manage workspaces"; it sits in a header row directly above the list box,
 * right-aligned with the settings shell's own header action ("Open
 * configuration file"), so it reads as the list's top-right corner action
 * rather than a page-level toolbar action.
 *
 * The empty state deliberately carries no action button: the list header above
 * it already owns the one "Manage workspaces" entry point.
 *
 * The component is a pure function of its props (loading / error / empty /
 * rows); it owns no state and performs no requests, so it renders identically
 * on the server and in jsdom.
 *
 * Self-contained chunk: `react` comes from the platform seed table; the icon
 * set, the translate function, and every callback arrive as props.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.workspace-list.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * A string prop, normalized.
     * @param {unknown} value - Raw value.
     * @returns {string} The string, or ''.
     */
    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    /**
     * A finite numeric prop, normalized.
     * @param {unknown} value - Raw value.
     * @returns {number} The integer, or 0.
     */
    function countOf(value) {
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
    }

    /**
     * One workspace row.
     * @param {object} props - `{ t, icons, workspace, onOpen }`.
     * @returns {object} The list item element.
     */
    function WorkspaceRow({ t, icons, workspace, onOpen }) {
      const id = textOf(workspace?.id)
      const name = textOf(workspace?.name) !== '' ? workspace.name : id
      const path = textOf(workspace?.path)
      const enabled = workspace?.enabled === true
      const characters = countOf(workspace?.characters)
      const meta = enabled ? t('settings.enabled') : t('settings.disabled')
      const amount = characters > 0 ? t('settings.characters', { count: characters }) : t('settings.emptyPrompt')
      const Chevron = icons?.IconChevronRight
      return h('li', { className: 'dwp-list-item' }, h('button', {
        type: 'button',
        className: 'dwp-workspace-row',
        'aria-label': t('settings.open', { name }),
        title: t('settings.openAria', { name }),
        onClick: () => {
          if (typeof onOpen === 'function') onOpen(workspace)
        },
      }, [
        h('span', {
          key: 'status',
          className: 'dwp-status-dot',
          'data-enabled': enabled ? 'true' : 'false',
          'aria-hidden': true,
        }),
        h('span', { key: 'main', className: 'dwp-workspace-main' }, [
          h('span', { key: 'name', className: 'dwp-workspace-name' }, name),
          path === '' ? null : h('span', { key: 'path', className: 'dwp-workspace-path', title: path }, path),
        ]),
        h('span', { key: 'meta', className: 'dwp-workspace-meta' }, `${meta} · ${amount}`),
        Chevron === undefined
          ? null
          : h('span', { key: 'chevron', className: 'dwp-chevron', 'aria-hidden': true }, h(Chevron, { size: 14 })),
      ]))
    }

    /**
     * The workspace list view.
     * @param {object} props - `{ t, icons, workspaces, loading, error, onOpen,
     *   onManage, onRetry }` from the page state machine.
     * @returns {object} The view element.
     */
    function WorkspaceListView({ t, icons, workspaces, loading, error, onOpen, onManage, onRetry }) {
      const entries = Array.isArray(workspaces) ? workspaces : []
      const manageButton = h('button', {
        key: 'manage',
        type: 'button',
        className: 'dwp-btn dwp-btn-primary',
        onClick: () => {
          if (typeof onManage === 'function') onManage()
        },
      }, t('settings.manage'))

      let body
      if (loading === true) {
        body = h('p', { key: 'loading', className: 'dwp-loading', role: 'status' }, t('settings.loading'))
      } else if (error !== undefined && error !== null && String(error) !== '') {
        body = h('div', { key: 'error', className: 'dwp-error' }, [
          h('div', { key: 'row', className: 'dwp-error-row' }, [
            h('span', { key: 'reason', role: 'alert' }, t('settings.loadFailed', { reason: String(error) })),
            h('button', {
              key: 'retry',
              type: 'button',
              className: 'dwp-btn dwp-btn-secondary',
              onClick: () => {
                if (typeof onRetry === 'function') onRetry()
              },
            }, t('settings.retry')),
          ]),
        ])
      } else if (entries.length === 0) {
        // No action button inside the empty box: the list header above it is the
        // one place that owns "Manage workspaces".
        body = h('div', { key: 'empty', className: 'dwp-empty' }, [
          h('p', { key: 'title', className: 'dwp-empty-title' }, t('settings.emptyTitle')),
          h('p', { key: 'hint', className: 'dwp-empty-body' }, t('settings.emptyBody')),
        ])
      } else {
        body = h('ul', { key: 'list', className: 'dwp-list' }, entries.map((workspace) => h(WorkspaceRow, {
          key: textOf(workspace?.id),
          t,
          icons,
          workspace,
          onOpen,
        })))
      }

      return h('section', { className: 'dwp-root dwp-list-view', 'data-view': 'list' }, [
        h('p', { key: 'description', className: 'dwp-hint' }, t('settings.description')),
        // Header row of the list box: count on the left, the page's only action
        // on the right. Its right inset in CSS aligns the button with the
        // settings shell header action above it (see `.dwp-list-head`).
        h('div', { key: 'listHead', className: 'dwp-list-head' }, [
          h('span', { key: 'count', className: 'dwp-list-head-meta' }, t('settings.count', { count: entries.length })),
          h('div', { key: 'actions', className: 'dwp-list-head-actions' }, [manageButton]),
        ]),
        body,
      ])
    }

    return { WorkspaceListView }
  },
})
