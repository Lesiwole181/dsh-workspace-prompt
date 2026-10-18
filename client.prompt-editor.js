/**
 * dsh-workspace-prompt — the settings page's third view: one workspace's prompt.
 *
 * Layout mirrors the interaction contract:
 *
 * - header: the back control on the left (only way out), then name and path;
 * - prompt card: an Edit | Browse tablist on the left of its toolbar and the
 *   enable switch on the right; the body is a textarea in edit mode or safely
 *   rendered Markdown in browse mode; the footer carries the status line on the
 *   left and, in edit mode only, the Save button on the far right;
 * - default mode: content ⇒ browse, empty ⇒ edit.
 *
 * Unsaved work is never dropped silently: back or Browse with a dirty draft
 * first arms a warning (also shown in the status line), and a second press
 * within three seconds performs the action. Save and the switch are separate
 * operations: the switch takes effect immediately, only a save changes the file
 * that injection reads. Every failure is shown inline and the draft survives.
 *
 * Self-contained chunk: `react` comes from the platform seed table; the API
 * client, markdown renderer, icons, and callbacks arrive as props.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.prompt-editor.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** How long a first "discard" press stays armed. */
    const DISCARD_ARM_MS = 3000

    /** The error codes the Host can report; each has an `error.<code>` dictionary key. */
    const ERROR_CODES = new Set([
      'network',
      'bad-request',
      'workspace-not-found',
      'not-added',
      'content-too-long',
      'io-failed',
      'http',
      'unknown',
    ])

    /**
     * A string prop, normalized.
     * @param {unknown} value - Raw value.
     * @returns {string} The string, or ''.
     */
    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    /**
     * Localized reason text for a caught request failure.
     *
     * The editor only receives the API client (not the API module), so it maps
     * the stable `error.<code>` dictionary keys directly; an error without a
     * known code becomes `t('error.unknown')`.
     * @param {unknown} error - Caught value.
     * @param {Function} t - Bound translate function.
     * @returns {string} User-facing reason.
     */
    function reasonFor(error, t) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      const details = error !== null && typeof error === 'object' && error.details !== null && typeof error.details === 'object'
        ? error.details
        : {}
      return ERROR_CODES.has(code) ? t(`error.${code}`, details) : t('error.unknown')
    }

    /**
     * A short local clock time for a save timestamp.
     * @param {number} epochMs - The Host's `savedAt` (epoch milliseconds).
     * @returns {string} Localized short time, or '' when unparsable.
     */
    function formatClock(epochMs) {
      const date = new Date(epochMs)
      if (Number.isNaN(date.getTime())) return ''
      try {
        return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
      } catch {
        return ''
      }
    }

    /**
     * The prompt editor view.
     * @param {object} props - `{ t, icons, markdown, api, workspace, onBack,
     *   onChanged }` from the page state machine.
     * @returns {object} The view element.
     */
    function PromptEditorView({ t, icons, markdown, api, workspace, onBack, onChanged }) {
      const workspaceId = workspace?.id === undefined || workspace?.id === null ? '' : String(workspace.id)
      const workspaceName = textOf(workspace?.name) !== '' ? workspace.name : workspaceId
      const workspacePath = textOf(workspace?.path)
      const iconSet = icons !== null && typeof icons === 'object' ? icons : {}
      const renderMarkdown = markdown !== null && typeof markdown === 'object' && typeof markdown.renderMarkdown === 'function'
        ? markdown.renderMarkdown
        : () => []
      const call = api !== null && typeof api === 'object' ? api : {}

      const [content, setContent] = useState('')
      const [savedContent, setSavedContent] = useState('')
      const [mode, setMode] = useState('edit')
      const [enabled, setEnabled] = useState(false)
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState('')
      const [saving, setSaving] = useState(false)
      const [enabling, setEnabling] = useState(false)
      const [saveError, setSaveError] = useState('')
      const [enableError, setEnableError] = useState('')
      const [savedAt, setSavedAt] = useState(0)
      const [confirmLeave, setConfirmLeave] = useState(false)
      const [revision, setRevision] = useState(0)
      const mounted = useRef(true)
      const discardTimer = useRef(0)

      /** Cancel a pending "discard" warning timer. */
      function clearDiscardTimer() {
        if (discardTimer.current !== 0) {
          clearTimeout(discardTimer.current)
          discardTimer.current = 0
        }
      }

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
          clearDiscardTimer()
        }
      }, [])

      // One load per workspace (and per explicit retry). The flag stops an
      // answer from landing after the editor closed or switched workspaces.
      useEffect(() => {
        let active = true
        setLoading(true)
        setLoadError('')
        setSaveError('')
        setEnableError('')
        setSavedAt(0)
        setConfirmLeave(false)
        clearDiscardTimer()
        const load = async () => {
          try {
            const answer = await call.readContent(workspaceId)
            if (!active) return
            const body = textOf(answer?.content)
            setContent(body)
            setSavedContent(body)
            setEnabled(answer?.workspace?.enabled === true)
            // Default mode: existing content is read, an empty prompt is written.
            setMode(body.trim() === '' ? 'edit' : 'browse')
            setLoading(false)
          } catch (error) {
            if (!active) return
            setLoadError(reasonFor(error, t))
            setLoading(false)
          }
        }
        void load()
        return () => {
          active = false
        }
        // `call` and `t` are stable for the page's lifetime (bound once by the
        // client entry); reloading is keyed by the workspace and the retry knob.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [workspaceId, revision])

      const dirty = content !== savedContent
      const characters = content.length

      /** Enter edit mode (no draft can be lost on this direction). */
      function enterEdit() {
        setMode('edit')
      }

      /**
       * Switch to browse — discarding a dirty draft only after confirmation.
       * @returns {void}
       */
      function browserMode() {
        if (mode === 'browse') return
        if (dirty && !confirmLeave) {
          armDiscard()
          return
        }
        clearDiscardTimer()
        setConfirmLeave(false)
        setContent(savedContent)
        setMode('browse')
      }

      /** Arm (or re-arm) the two-press discard warning. */
      function armDiscard() {
        setConfirmLeave(true)
        clearDiscardTimer()
        discardTimer.current = setTimeout(() => {
          discardTimer.current = 0
          if (mounted.current) setConfirmLeave(false)
        }, DISCARD_ARM_MS)
      }

      /** Leave the editor; a dirty draft needs the second press. */
      function leave() {
        if (dirty && !confirmLeave) {
          armDiscard()
          return
        }
        clearDiscardTimer()
        if (typeof onBack === 'function') onBack()
      }

      /** Save the draft. */
      async function save() {
        if (!mounted.current || loading || saving) return
        setSaving(true)
        setSaveError('')
        try {
          const answer = await call.saveContent(workspaceId, content)
          if (!mounted.current) return
          setSavedContent(content)
          setSavedAt(typeof answer?.savedAt === 'number' && Number.isFinite(answer.savedAt) ? answer.savedAt : Date.now())
          if (answer?.workspace !== null && typeof answer?.workspace === 'object' && typeof answer.workspace.enabled === 'boolean') {
            setEnabled(answer.workspace.enabled)
          }
          setConfirmLeave(false)
          if (typeof onChanged === 'function') onChanged()
        } catch (error) {
          if (mounted.current) setSaveError(reasonFor(error, t))
        } finally {
          if (mounted.current) setSaving(false)
        }
      }

      /** Flip the enable switch; independent from saving. */
      async function toggleEnabled() {
        if (!mounted.current || loading || enabling) return
        const next = !enabled
        setEnabling(true)
        setEnableError('')
        try {
          const answer = await call.setEnabled(workspaceId, next)
          if (!mounted.current) return
          const confirmed = answer?.workspace !== null && typeof answer?.workspace === 'object' && typeof answer.workspace.enabled === 'boolean'
            ? answer.workspace.enabled
            : next
          setEnabled(confirmed)
          if (typeof onChanged === 'function') onChanged()
        } catch (error) {
          if (mounted.current) setEnableError(reasonFor(error, t))
        } finally {
          if (mounted.current) setEnabling(false)
        }
      }

      // One status line at the bottom left, in priority order.
      let status
      let tone = 'info'
      if (saving) {
        status = t('editor.saving')
      } else if (saveError !== '') {
        status = t('editor.saveFailed', { reason: saveError })
        tone = 'error'
      } else if (enableError !== '') {
        status = t('editor.enableFailed', { reason: enableError })
        tone = 'error'
      } else if (mode === 'browse') {
        status = t('editor.characters', { count: characters })
      } else if (dirty) {
        status = confirmLeave ? t('editor.discardHint') : t('editor.unsaved')
        tone = 'warn'
      } else if (savedAt !== 0) {
        status = t('editor.saved', { time: formatClock(savedAt) })
        tone = 'success'
      } else {
        status = t('editor.characters', { count: characters })
      }

      let body
      if (loading) {
        body = h('p', { key: 'loading', className: 'dwp-loading', role: 'status' }, t('editor.loading'))
      } else if (loadError !== '') {
        body = h('div', { key: 'error', className: 'dwp-error' }, [
          h('div', { key: 'row', className: 'dwp-error-row' }, [
            h('span', { key: 'reason', role: 'alert' }, t('editor.loadFailed', { reason: loadError })),
            h('button', {
              key: 'retry',
              type: 'button',
              className: 'dwp-btn dwp-btn-secondary',
              onClick: () => { setRevision((value) => value + 1) },
            }, t('editor.retry')),
          ]),
        ])
      } else if (mode === 'edit') {
        body = h('textarea', {
          key: 'textarea',
          className: 'dwp-textarea',
          value: content,
          placeholder: t('editor.placeholder'),
          spellCheck: false,
          'aria-label': t('editor.editLabel', { name: workspaceName }),
          onChange: (event) => {
            setContent(event.target.value)
            // A fresh keystroke is a fresh decision: leaving is again one
            // press away, and the warning goes with it.
            clearDiscardTimer()
            setConfirmLeave(false)
          },
        })
      } else if (content.trim() === '') {
        body = h('p', { key: 'empty', className: 'dwp-browse dwp-browse-empty' }, t('editor.browseEmpty'))
      } else {
        body = h('div', { key: 'rendered', className: 'dwp-browse' }, renderMarkdown(content))
      }

      const tab = (id, label) => h('button', {
        key: id,
        type: 'button',
        role: 'tab',
        id: `dwp-editor-tab-${id}`,
        className: 'dwp-tab',
        'aria-selected': mode === id,
        'aria-controls': 'dwp-editor-panel',
        onClick: () => {
          if (id === 'browse') browserMode()
          else enterEdit()
        },
      }, label)

      const BackIcon = iconSet.IconBack
      const footer = loading || loadError !== ''
        ? null
        : h('div', { key: 'foot', className: 'dwp-editor-foot' }, [
          h('span', {
            key: 'status',
            className: 'dwp-status',
            'data-tone': tone,
            role: tone === 'error' ? 'alert' : 'status',
          }, status),
          mode === 'edit'
            ? h('button', {
              key: 'save',
              type: 'button',
              className: 'dwp-btn dwp-btn-primary',
              disabled: saving,
              'aria-busy': saving,
              onClick: () => { void save() },
            }, saving ? t('editor.saving') : t('editor.save'))
            : null,
        ])

      return h('section', { className: 'dwp-root dwp-editor-view', 'data-view': 'edit' }, [
        h('div', { key: 'head', className: 'dwp-editor-head' }, [
          h('button', {
            key: 'back',
            type: 'button',
            className: 'dwp-back',
            'aria-label': t('editor.backAria'),
            title: t('editor.backAria'),
            onClick: leave,
          }, [
            BackIcon === undefined
              ? null
              : h('span', { key: 'icon', className: 'dwp-back-icon', 'aria-hidden': true }, h(BackIcon, { size: 14 })),
            h('span', { key: 'label' }, t('editor.back')),
          ]),
          h('div', { key: 'title', className: 'dwp-editor-title' }, [
            h('h3', { key: 'name', className: 'dwp-editor-name', title: workspaceName }, workspaceName),
            workspacePath === ''
              ? null
              : h('span', { key: 'path', className: 'dwp-editor-path', title: workspacePath }, workspacePath),
          ]),
        ]),
        h('div', { key: 'card', className: 'dwp-editor-card' }, [
          h('div', { key: 'bar', className: 'dwp-editor-bar' }, [
            h('div', {
              key: 'tabs',
              className: 'dwp-tabs',
              role: 'tablist',
              'aria-label': t('editor.mode'),
            }, [
              tab('edit', t('editor.edit')),
              tab('browse', t('editor.browse')),
            ]),
            h('button', {
              key: 'switch',
              type: 'button',
              role: 'switch',
              className: 'dwp-switch',
              'aria-checked': enabled,
              'aria-label': t('editor.enable'),
              disabled: loading || loadError !== '' || enabling,
              onClick: () => { void toggleEnabled() },
            }, [
              h('span', { key: 'track', className: 'dwp-switch-track', 'aria-hidden': true }, [
                h('span', { key: 'thumb', className: 'dwp-switch-thumb' }),
              ]),
              h('span', { key: 'state', className: 'dwp-switch-text' },
                enabled ? t('editor.enabled') : t('editor.disabled')),
            ]),
          ]),
          h('div', {
            key: 'body',
            id: 'dwp-editor-panel',
            className: 'dwp-editor-body',
            role: 'tabpanel',
            'aria-labelledby': `dwp-editor-tab-${mode}`,
          }, body),
          footer,
        ]),
      ])
    }

    return { PromptEditorView }
  },
})
