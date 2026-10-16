/**
 * The workspace-prompt editor: the settings page's second view.
 *
 * It used to be a modal on `shell.overlay`. It is now rendered by
 * `client.settings.js` inside the settings content column, so the two live in
 * one React tree and the shared store is all that tells them apart: the editor
 * subscribes to the same snapshot the page reads, and it hands back the view
 * when the store holds no target.
 *
 * It is **always rendered**, never mounted on demand. Every hook below therefore
 * runs on every render of the settings page, and the effects guard on `open`
 * themselves — that is what arms and disarms the Ctrl/Cmd+S listener and what
 * aborts an in-flight request when the view closes, without leaning on a
 * mount/unmount cycle.
 *
 * Being inline, the modal machinery is gone on purpose: no backdrop, no
 * `role="dialog"` / `aria-modal`, no focus capture or restore, no Tab trap, and
 * no window-level Escape handler. There is no overlay to dismiss, and the panel
 * around this view is the panel the user is already working in.
 *
 * What it keeps from the accepted window:
 *
 * - the layout: switch top-left, back top-right, `编辑 / 浏览` tabs, a
 *   `textarea` or rendered markdown, and a foot with the status line and Save;
 * - Ctrl/Cmd+S, a Save button disabled while there is nothing to save, and an
 *   in-flight request aborted when the target changes;
 * - unsaved work is never dropped silently: the first "back" with unsaved
 *   changes stays in the editor and says so, the second one leaves.
 *
 * The target is a **workspace**, not a Session: the settings list supplies
 * `{ workspaceId, workspaceName }`, every route is addressed by that id, and
 * nothing here needs a Session id.
 *
 * Self-contained chunk: `react` is the platform seed, and the shared store, the
 * bound translate function, the Host API, the markdown renderer, and the icon
 * set all arrive as props from the entry — a chunk cannot synchronously require
 * a sibling `client*.js`, so nothing here reaches for one.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.dialog.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    /** Load lifecycle of the open editor. */
    const LOAD = { LOADING: 'loading', IDLE: 'idle', FAILED: 'failed' }

    /**
     * Local time of a save, as the status line's `{time}`.
     * @param savedAt - the Host's `savedAt` (epoch milliseconds), or nothing
     *   while the write has not answered; anything unparsable renders empty.
     * @returns `HH:MM`.
     */
    function clockTime(savedAt) {
      const date = savedAt === undefined || savedAt === null ? new Date() : new Date(savedAt)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** A short reason for a failed request. */
    function reasonOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * The editor view.
     * @param props - `{ store, t, api, markdown, icons }` from the entry (the
     *   settings page forwards them; the open target comes from the store).
     * @returns the inline editor, or null while the store holds no target.
     */
    function WorkspacePromptEditor({ store, t, api, markdown, icons }) {
      const target = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspaceId = target.workspaceId
      const open = target.open

      const [load, setLoad] = useState(LOAD.LOADING)
      const [loadError, setLoadError] = useState('')
      const [content, setContent] = useState('')
      const [savedContent, setSavedContent] = useState('')
      const [enabled, setEnabledState] = useState(false)
      const [workspaceName, setWorkspaceName] = useState('')
      const [saving, setSaving] = useState(false)
      const [saveError, setSaveError] = useState('')
      const [savedAt, setSavedAt] = useState('')
      const [tab, setTab] = useState('edit')
      // Which workspace the state above belongs to. This component stays
      // mounted while no workspace is open (that is what keeps its effects
      // armed), so its state survives a close; without this marker a re-open
      // would commit the previous workspace's body for a frame, before the new
      // read answers.
      const [stateFor, setStateFor] = useState('')
      // Armed by the first "back" that would drop unsaved work; the second one
      // goes through, and any later keystroke disarms it again.
      const [discardArmed, setDiscardArmed] = useState(false)

      // Requests the user started (save, toggle) live in a ref: leaving the
      // editor aborts whichever is in flight, so no answer lands on a view that
      // no longer shows that workspace.
      const writeRef = useRef(null)

      const pending = stateFor !== workspaceId
      const busy = pending || load === LOAD.LOADING
      const dirty = content !== savedContent
      const name = workspaceName !== '' ? workspaceName : workspaceId

      // One open = one load. The controller is aborted by the cleanup, so
      // leaving the editor (or switching workspaces) cancels the request instead
      // of leaking its answer into the next view.
      useEffect(() => {
        if (!open) return undefined
        const controller = new AbortController()
        const { signal } = controller
        setStateFor('')
        setLoad(LOAD.LOADING)
        setLoadError('')
        setSaveError('')
        setSavedAt('')
        setSaving(false)
        setTab('edit')
        setDiscardArmed(false)
        ;(async () => {
          try {
            const state = await api.readContent(workspaceId, signal)
            if (signal.aborted) return
            const text = typeof state.content === 'string' ? state.content : ''
            setContent(text)
            setSavedContent(text)
            setEnabledState(state.enabled === true)
            setWorkspaceName(typeof state.workspaceName === 'string' && state.workspaceName !== ''
              ? state.workspaceName
              : target.workspaceName)
            setStateFor(workspaceId)
            setLoad(LOAD.IDLE)
          } catch (error) {
            if (signal.aborted) return
            setLoadError(reasonOf(error))
            // The state is settled — as a failure — for this workspace: the
            // status line must show the reason, not an endless "loading".
            setStateFor(workspaceId)
            setLoad(LOAD.FAILED)
          }
        })()
        return () => { controller.abort() }
      }, [api, open, workspaceId, target.workspaceName])

      // Leaving the editor, or switching workspaces, cancels a save or toggle
      // still in flight: its answer must not touch a view that is no longer
      // showing that workspace. (A read is cancelled by the effect above.)
      useEffect(() => () => { writeRef.current?.abort() }, [open, workspaceId])

      /**
       * Leave the editor. Unsaved work is never dropped silently: the first
       * click stays in the editor and says so in the status line, the second one
       * leaves it behind.
       */
      const back = useCallback(() => {
        if (dirty && !discardArmed) {
          setDiscardArmed(true)
          return
        }
        store.close()
      }, [discardArmed, dirty, store])

      // The back control is rendered by the settings page's header, above the
      // title, so the page reaches this decision through the store.
      useEffect(() => {
        if (!open) return undefined
        return store.onRequestClose(back)
      }, [back, open, store])

      /** Start one write request, cancelling whatever it replaces. */
      const beginWrite = useCallback(() => {
        writeRef.current?.abort()
        const controller = new AbortController()
        writeRef.current = controller
        return controller
      }, [])

      const save = useCallback(async () => {
        // Nothing to write: the button is disabled in that state and Ctrl/Cmd+S
        // takes the same exit, so neither reaches the Host.
        if (busy || saving || !dirty) return
        setSaving(true)
        setSaveError('')
        const controller = beginWrite()
        try {
          const result = await api.savePrompt(workspaceId, content, controller.signal)
          if (controller.signal.aborted) return
          setSavedContent(content)
          setSavedAt(clockTime(result?.savedAt))
        } catch (error) {
          if (controller.signal.aborted) return
          setSaveError(reasonOf(error))
        } finally {
          if (!controller.signal.aborted) setSaving(false)
        }
      }, [api, beginWrite, busy, content, dirty, saving, workspaceId])

      const toggle = useCallback(async () => {
        const next = !enabled
        setEnabledState(next)
        setSaveError('')
        const controller = beginWrite()
        try {
          const result = await api.setEnabled(workspaceId, next, controller.signal)
          if (controller.signal.aborted) return
          setEnabledState(result?.enabled === true)
        } catch (error) {
          if (controller.signal.aborted) return
          setEnabledState(!next)
          setSaveError(reasonOf(error))
        }
      }, [api, beginWrite, enabled, workspaceId])

      // Ctrl/Cmd+S saves while the editor is open. This is the only window-level
      // listener the plugin keeps: an inline view owns no overlay, so it takes
      // no Escape and traps no Tab.
      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            void save()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => { window.removeEventListener('keydown', onKeyDown) }
      }, [open, save])

      if (!open) return null

      let status
      let tone = 'info'
      if (busy) {
        status = t('status.loading')
      } else if (saving) {
        status = t('status.saving')
      } else if (saveError !== '') {
        status = t('status.failed', { reason: saveError })
        tone = 'error'
      } else if (loadError !== '') {
        status = t('status.failed', { reason: loadError })
        tone = 'error'
      } else if (dirty) {
        status = discardArmed ? t('status.unsavedBack') : t('status.unsaved')
        tone = 'warn'
      } else if (savedAt !== '') {
        status = t('status.savedAt', { time: savedAt })
      } else {
        // The enabled/disabled statement now lives beside the switch, so the
        // footer stays silent while nothing has happened yet.
        status = ''
      }

      const body = busy
        ? h('div', { className: 'dwp-browse dwp-browse-empty' }, t('status.loading'))
        : load === LOAD.FAILED
          ? h('div', { className: 'dwp-browse dwp-browse-empty', role: 'alert' }, loadError)
          : tab === 'edit'
            ? h('textarea', {
              id: 'dwp-editor',
              className: 'dwp-editor',
              value: content,
              placeholder: t('editor.placeholder'),
              spellCheck: false,
              'aria-label': t('editor.label', { workspace: name }),
              onChange: (event) => {
                setContent(event.target.value)
                // A fresh keystroke is a fresh decision: leaving is one click
                // away again, and the warning goes with it.
                setDiscardArmed(false)
              },
            })
            : content.trim() === ''
              ? h('div', { className: 'dwp-browse dwp-browse-empty' }, t('browse.empty'))
              : h('div', { className: 'dwp-browse' }, markdown.renderMarkdown(content))

      const tabButton = (id, label) => h('button', {
        key: id,
        type: 'button',
        role: 'tab',
        id: `dwp-tab-${id}`,
        className: 'dwp-tab',
        'aria-selected': tab === id,
        'aria-controls': 'dwp-panel',
        onClick: () => { setTab(id) },
      }, label)

      return h('div', {
        className: 'dwp-editor-view',
        role: 'group',
        'aria-label': t('editor.workspace', { workspace: name }),
      }, [
        h('div', { key: 'head', className: 'dwp-editor-head' }, [
          h('button', {
            key: 'switch',
            type: 'button',
            role: 'switch',
            className: 'dwp-switch',
            'aria-checked': enabled,
            'aria-label': t('switch.label'),
            disabled: busy,
            onClick: () => { void toggle() },
          }, [
            h('span', { key: 'track', className: 'dwp-switch-track', 'aria-hidden': true }),
          ]),
          // What the switch means, stated beside it rather than inside the
          // control: the button keeps one accessible name, and this text is the
          // position's only explanation, so it stays visible at the same level.
          h('span', { key: 'state', className: 'dwp-switch-state' },
            enabled ? t('status.enabled') : t('status.disabled')),
        ]),
        h('p', { key: 'target', className: 'dwp-editor-target' },
          t('editor.workspace', { workspace: name })),
        h('div', { key: 'tabs', className: 'dwp-tabs', role: 'tablist', 'aria-label': t('tabs.label') }, [
          tabButton('edit', t('tab.edit')),
          tabButton('browse', t('tab.browse')),
        ]),
        h('div', {
          key: 'body',
          id: 'dwp-panel',
          className: 'dwp-body',
          role: 'tabpanel',
          'aria-labelledby': `dwp-tab-${tab}`,
        }, body),
        h('div', { key: 'foot', className: 'dwp-editor-foot' }, [
          h('div', {
            key: 'status',
            className: 'dwp-status',
            'data-tone': tone,
            role: tone === 'error' ? 'alert' : 'status',
          }, status),
          h('button', {
            key: 'save',
            type: 'button',
            className: 'dwp-save',
            disabled: busy || saving || !dirty,
            onClick: () => { void save() },
          }, saving ? t('action.saving') : t('action.save')),
        ]),
      ])
    }

    return { WorkspacePromptEditor }
  },
})
