/**
 * dsh-workspace-prompt — the page state machine mounted at `settings.section`.
 *
 * Three views share one React tree, selected by `view.kind`:
 *
 * - `list`   — the added workspaces (`GET /list`), with "Manage workspaces";
 * - `manage` — the whole workspace catalog (`GET /catalog`) and the batch diff
 *              (`POST /apply`), after which the page returns to the list;
 * - `edit`   — one workspace's prompt (`GET /content`, `POST /save`,
 *              `POST /enable`).
 *
 * The page owns every request and every transition; the three view components
 * are presentational. Returning from the editor or changing anything inside it
 * refreshes the list in the background (no loading flash), while entering a
 * view that needs its own data shows that view's loading state.
 *
 * It also renders the plugin's single `<style>` element (the stylesheet string
 * from `client.styles.js`) and the transient notice bar, which auto-dismisses
 * after four seconds but can be closed by hand. Nothing is portalled and no
 * host DOM is touched.
 *
 * Self-contained chunk: `react` comes from the platform seed table; the bound
 * translate function, the API client, the locale subscription, and the loaded
 * sibling chunks (`modules`) arrive from `client.js`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.app.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** How long a notice stays on screen before it dismisses itself. */
    const NOTICE_AUTO_DISMISS_MS = 4000

    /** The list payload before the first successful read. */
    const EMPTY_LIST = { promptDirectory: '', workspaces: [] }

    /**
     * A string value, normalized.
     * @param {unknown} value - Raw value.
     * @returns {string} The string, or ''.
     */
    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    /**
     * An object value, normalized.
     * @param {unknown} value - Raw value.
     * @returns {Record<string, unknown>} The object, or a fresh empty object.
     */
    function objectOf(value) {
      return value !== null && typeof value === 'object' ? value : {}
    }

    /**
     * The root component of the settings section.
     * @param {object} props - `{ t, api, useLocaleVersion, modules, close }` from
     *   `client.js`. `close` (the shell's only affordance) is intentionally not
     *   used: the plugin's own back control is the way out of the editor.
     * @returns {object} The page element.
     */
    function WorkspacePromptApp({ t, api, useLocaleVersion, modules }) {
      const translate = typeof t === 'function' ? t : (key) => key
      // Re-render when the active locale changes: `t` reads the active locale at
      // call time, so a render is all that is needed. (The prop's identity is
      // stable for the page's lifetime, so this hook call is unconditional in
      // practice.)
      const localeVersion = typeof useLocaleVersion === 'function' ? useLocaleVersion() : ''
      const parts = objectOf(modules)
      const apiModule = objectOf(parts.api)
      const errorKeyOf = typeof apiModule.errorMessageKey === 'function'
        ? apiModule.errorMessageKey
        : () => 'error.unknown'
      const styleText = textOf(objectOf(parts.styles).STYLE_TEXT)
      const iconSet = objectOf(parts.icons)
      const markdownModule = objectOf(parts.markdown)
      const ListView = objectOf(parts.workspaceList).WorkspaceListView
      const ManageView = objectOf(parts.manageWorkspaces).ManageWorkspacesView
      const EditorView = objectOf(parts.promptEditor).PromptEditorView
      const client = objectOf(api)

      const [view, setView] = useState({ kind: 'list' })
      const [listState, setListState] = useState({ phase: 'loading', data: EMPTY_LIST, error: '' })
      const [manageState, setManageState] = useState({ phase: 'idle', catalog: [], error: '' })
      const [notice, setNotice] = useState(null)
      const mounted = useRef(true)

      /**
       * Localize a caught request failure with the API module's code mapping.
       * @param {unknown} error - Caught value, normally an ApiError.
       * @returns {string} User-facing reason.
       */
      function localize(error) {
        const details = objectOf(error).details
        return translate(errorKeyOf(error), objectOf(details))
      }

      /**
       * Read the added workspaces.
       * @param {'replace'|'silent'} [mode] - `silent` keeps the current view
       *   (background refresh); `replace` shows the loading state.
       * @returns {Promise<void>} Resolves when the read settles.
       */
      async function readList(mode = 'replace') {
        if (mode !== 'silent') {
          setListState((previous) => ({ phase: 'loading', data: previous.data, error: '' }))
        }
        try {
          const answer = await client.list()
          if (!mounted.current) return
          setListState({
            phase: 'ready',
            data: {
              promptDirectory: textOf(answer?.promptDirectory),
              workspaces: Array.isArray(answer?.workspaces) ? answer.workspaces : [],
            },
            error: '',
          })
        } catch (error) {
          if (!mounted.current || mode === 'silent') return
          setListState((previous) => ({ phase: 'error', data: previous.data, error: localize(error) }))
        }
      }

      /**
       * Read the whole catalog (every DSH workspace with its `added` flag).
       * @returns {Promise<void>} Resolves when the read settles.
       */
      async function readCatalog() {
        setManageState((previous) => ({ phase: 'loading', catalog: previous.catalog, error: '' }))
        try {
          const answer = await client.catalog()
          if (!mounted.current) return
          setManageState({
            phase: 'ready',
            catalog: Array.isArray(answer?.workspaces) ? answer.workspaces : [],
            error: '',
          })
        } catch (error) {
          if (!mounted.current) return
          setManageState((previous) => ({ phase: 'error', catalog: previous.catalog, error: localize(error) }))
        }
      }

      // First load. The flag keeps late answers from touching an unmounted page.
      useEffect(() => {
        mounted.current = true
        void readList()
        return () => {
          mounted.current = false
        }
        // `readList` closes over stable props (bound once by the client entry).
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // One notice, one timer: a newer notice replaces the timer through the
      // dependency, and leaving the page clears it.
      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => {
          if (mounted.current) setNotice(null)
        }, NOTICE_AUTO_DISMISS_MS)
        return () => {
          clearTimeout(timer)
        }
      }, [notice])

      /**
       * Show the notice bar.
       * @param {'ok'|'error'} tone - Visual tone.
       * @param {string} text - Localized text.
       * @returns {void}
       */
      function showNotice(tone, text) {
        setNotice({ tone, text })
      }

      /** Open one workspace's prompt editor. */
      function openWorkspace(workspace) {
        setView({ kind: 'edit', workspace })
      }

      /** Open the batch management view and load its catalog. */
      function openManage() {
        setView({ kind: 'manage' })
        void readCatalog()
      }

      /** Leave the batch management view without applying anything. */
      function cancelManage() {
        setView({ kind: 'list' })
      }

      /** Return from the editor and refresh the list it may have changed. */
      function backToList() {
        setView({ kind: 'list' })
        void readList('silent')
      }

      /** Refresh the list after a save or switch change, without leaving. */
      function handleChanged() {
        void readList('silent')
      }

      /**
       * Apply the batch diff, then return to the refreshed list.
       *
       * A failure is re-thrown as an `Error` carrying already-localized reason
       * text, which is what the manage view renders in its failure line.
       * @param {{ add: Array<string>, remove: Array<string> }} changes - Diff.
       * @returns {Promise<void>} Resolves after the page has returned to the list.
       */
      async function applyChanges(changes) {
        let result
        try {
          result = await client.apply(changes)
        } catch (error) {
          throw new Error(localize(error))
        }
        if (!mounted.current) return
        const added = Array.isArray(result?.added) ? result.added : []
        const removed = Array.isArray(result?.removed) ? result.removed : []
        if (added.length > 0 && removed.length === 0) {
          showNotice('ok', translate('manage.addedNotice', { count: added.length }))
        } else if (removed.length > 0 && added.length === 0) {
          showNotice('ok', translate('manage.removedNotice', { count: removed.length }))
        } else {
          showNotice('ok', translate('manage.changedNotice'))
        }
        if (Array.isArray(result?.workspaces)) {
          setListState((previous) => ({
            phase: 'ready',
            data: { promptDirectory: previous.data.promptDirectory, workspaces: result.workspaces },
            error: '',
          }))
        }
        setView({ kind: 'list' })
        void readList('silent')
      }

      let current
      if (view.kind === 'manage') {
        current = typeof ManageView === 'function' ? h(ManageView, {
          key: 'manage',
          t: translate,
          icons: iconSet,
          catalog: manageState.catalog,
          loading: manageState.phase === 'loading',
          error: manageState.phase === 'error' ? manageState.error : '',
          onCancel: cancelManage,
          onApply: applyChanges,
          onRetry: () => { void readCatalog() },
        }) : null
      } else if (view.kind === 'edit') {
        current = typeof EditorView === 'function' ? h(EditorView, {
          key: 'edit',
          t: translate,
          icons: iconSet,
          markdown: markdownModule,
          api: client,
          workspace: view.workspace,
          onBack: backToList,
          onChanged: handleChanged,
        }) : null
      } else {
        current = typeof ListView === 'function' ? h(ListView, {
          key: 'list',
          t: translate,
          icons: iconSet,
          workspaces: listState.data.workspaces,
          loading: listState.phase === 'loading',
          error: listState.phase === 'error' ? listState.error : '',
          onOpen: openWorkspace,
          onManage: openManage,
          onRetry: () => { void readList() },
        }) : null
      }

      const NoticeClose = iconSet.IconClose
      const noticeBar = notice === null ? null : h('div', {
        key: 'notice',
        className: 'dwp-notice',
        'data-tone': notice.tone,
        role: notice.tone === 'error' ? 'alert' : 'status',
      }, [
        h('span', { key: 'text', className: 'dwp-notice-text' }, notice.text),
        h('button', {
          key: 'dismiss',
          type: 'button',
          className: 'dwp-notice-dismiss',
          'aria-label': translate('notice.dismiss'),
          title: translate('notice.dismiss'),
          onClick: () => { setNotice(null) },
        }, NoticeClose === undefined ? null : h(NoticeClose, { size: 12 })),
      ])

      return h('div', {
        className: 'dwp-app',
        'data-view': view.kind,
        'data-locale': textOf(localeVersion),
      }, [
        h('style', { key: 'styles' }, styleText),
        noticeBar,
        h('div', { key: 'view', className: 'dwp-view' }, current),
      ])
    }

    return { WorkspacePromptApp }
  },
})
