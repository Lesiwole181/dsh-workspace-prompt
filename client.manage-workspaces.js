/**
 * dsh-workspace-prompt — the settings page's second view: batch workspace
 * management.
 *
 * The catalog is every DSH workspace with an `added` flag. The view opens with
 * the added ones checked, tracks a native-checkbox selection, and can hand three
 * kinds of change to the page:
 *
 * - newly checked entries become `add`;
 * - entries unchecked relative to the initial set become `remove`, and removing
 *   deletes the saved prompt file on the Host — so the view warns first and
 *   requires a second press on the confirmation panel before any removal is
 *   submitted (`onApply` is only then called, once, for the whole diff).
 *
 * Failures are shown inline and keep the selection, so the user can retry
 * without redoing it. The component is presentational: the page owns the
 * catalog fetch and the apply request.
 *
 * Self-contained chunk: `react` comes from the platform seed table; every
 * callback and the translate function arrive as props.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.manage-workspaces.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /**
     * A string field, normalized.
     * @param {unknown} value - Raw value.
     * @returns {string} The string, or ''.
     */
    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    /**
     * The ids the catalog reports as already added (the initial selection).
     * @param {unknown} catalog - Raw catalog prop.
     * @returns {Array<string>} Added ids, in catalog order.
     */
    function addedIds(catalog) {
      const entries = Array.isArray(catalog) ? catalog : []
      const ids = []
      for (const workspace of entries) {
        if (workspace?.added === true) ids.push(textOf(workspace.id))
      }
      return ids
    }

    /**
     * A short display reason for a failed apply.
     *
     * The page localizes the error before rejecting (it owns the API module and
     * its `errorMessageKey`), so the rejection message is already user-facing.
     * @param {unknown} error - Caught rejection.
     * @returns {string} The reason text.
     */
    function reasonOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * One checkbox row: name, path, and the "added" badge.
     * @param {object} props - `{ t, workspace, checked, onToggle }`.
     * @returns {object} The list item element.
     */
    function WorkspaceChoice({ t, workspace, checked, onToggle }) {
      const id = textOf(workspace?.id)
      const name = textOf(workspace?.name) !== '' ? workspace.name : id
      const path = textOf(workspace?.path)
      return h('li', { className: 'dwp-manage-item' }, h('label', { className: 'dwp-manage-row' }, [
        h('input', {
          key: 'checkbox',
          type: 'checkbox',
          className: 'dwp-manage-checkbox',
          checked,
          onChange: () => onToggle(id),
        }),
        h('span', { key: 'main', className: 'dwp-manage-main' }, [
          h('span', { key: 'name', className: 'dwp-manage-name' }, name),
          path === '' ? null : h('span', { key: 'path', className: 'dwp-manage-path', title: path }, path),
        ]),
        workspace?.added === true
          ? h('span', { key: 'badge', className: 'dwp-badge', 'data-tone': 'success' }, t('manage.added'))
          : null,
      ]))
    }

    /**
     * The batch management view.
     * @param {object} props - `{ t, icons, catalog, loading, error, onCancel,
     *   onApply, onRetry }` from the page state machine.
     * @returns {object} The view element.
     */
    function ManageWorkspacesView({ t, icons, catalog, loading, error, onCancel, onApply, onRetry }) {
      const entries = Array.isArray(catalog) ? catalog : []
      const [initialIds, setInitialIds] = useState(() => addedIds(catalog))
      const [selected, setSelected] = useState(() => new Set(addedIds(catalog)))
      const [applying, setApplying] = useState(false)
      const [confirming, setConfirming] = useState(false)
      const [applyError, setApplyError] = useState('')
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      // A new catalog (the page's first load or a retry) re-seeds the selection:
      // edits are tracked against one fetched baseline, never a stale one.
      useEffect(() => {
        const baseline = addedIds(catalog)
        setInitialIds(baseline)
        setSelected(new Set(baseline))
        setConfirming(false)
        setApplyError('')
      }, [catalog])

      const initialSet = new Set(initialIds)
      const ids = entries.map((workspace) => textOf(workspace?.id))
      const add = ids.filter((id) => selected.has(id) && !initialSet.has(id))
      const remove = ids.filter((id) => initialSet.has(id) && !selected.has(id))
      const changeCount = add.length + remove.length

      /**
       * Toggle one selection, dropping any pending confirmation.
       * @param {string} id - Workspace id.
       * @returns {void}
       */
      function toggle(id) {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        setConfirming(false)
        setApplyError('')
      }

      /**
       * Submit the diff — or, when removals are part of it, ask first.
       * @returns {Promise<void>} Resolves once the page request settles.
       */
      async function submit() {
        if (applying || changeCount === 0) return
        if (remove.length > 0 && !confirming) {
          setConfirming(true)
          return
        }
        setApplying(true)
        setApplyError('')
        try {
          await onApply({ add, remove })
        } catch (caught) {
          if (mounted.current) {
            setApplyError(reasonOf(caught))
            setConfirming(false)
          }
        } finally {
          if (mounted.current) setApplying(false)
        }
      }

      const WarningIcon = icons?.IconWarning
      const warning = remove.length === 0 ? null : h('div', { key: 'warning', className: 'dwp-manage-warning' }, [
        WarningIcon === undefined
          ? null
          : h('span', { key: 'icon', className: 'dwp-warning-icon', 'aria-hidden': true }, h(WarningIcon, { size: 14 })),
        h('span', { key: 'text' }, t('manage.removeWarning', { count: remove.length })),
      ])

      let body
      if (loading === true) {
        body = h('p', { key: 'loading', className: 'dwp-loading', role: 'status' }, t('manage.loading'))
      } else if (error !== undefined && error !== null && String(error) !== '') {
        body = h('div', { key: 'error', className: 'dwp-error' }, [
          h('div', { key: 'row', className: 'dwp-error-row' }, [
            h('span', { key: 'reason', role: 'alert' }, t('manage.loadFailed', { reason: String(error) })),
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
        body = h('div', { key: 'empty', className: 'dwp-empty' }, [
          h('p', { key: 'title', className: 'dwp-empty-title' }, t('manage.emptyTitle')),
          h('p', { key: 'hint', className: 'dwp-empty-body' }, t('manage.emptyBody')),
        ])
      } else {
        body = h('ul', { key: 'list', className: 'dwp-manage-list' }, entries.map((workspace) => {
          const id = textOf(workspace?.id)
          return h(WorkspaceChoice, {
            key: id,
            t,
            workspace,
            checked: selected.has(id),
            onToggle: toggle,
          })
        }))
      }

      const confirmation = confirming === false ? null : h('div', { key: 'confirm', className: 'dwp-confirm' }, [
        h('p', { key: 'body', className: 'dwp-confirm-body' }, t('manage.confirmRemoveBody')),
        h('div', { key: 'actions', className: 'dwp-confirm-actions' }, [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dwp-btn dwp-btn-secondary',
            disabled: applying,
            onClick: () => { setConfirming(false) },
          }, t('manage.confirmCancel')),
          h('button', {
            key: 'confirm',
            type: 'button',
            className: 'dwp-btn dwp-btn-danger',
            disabled: applying,
            onClick: () => { void submit() },
          }, t('manage.confirmApply')),
        ]),
      ])

      return h('section', { className: 'dwp-root dwp-manage-view', 'data-view': 'manage' }, [
        h('div', { key: 'head', className: 'dwp-manage-head' }, [
          h('button', {
            key: 'back',
            type: 'button',
            className: 'dwp-btn dwp-btn-ghost',
            disabled: applying,
            onClick: () => {
              if (typeof onCancel === 'function') onCancel()
            },
          }, t('manage.back')),
          h('h2', { key: 'title', className: 'dwp-manage-title' }, t('manage.title')),
          h('button', {
            key: 'apply',
            type: 'button',
            className: 'dwp-btn dwp-btn-primary',
            disabled: applying || changeCount === 0
              || loading === true
              || (error !== undefined && error !== null && String(error) !== ''),
            onClick: () => { void submit() },
          }, [
            h('span', { key: 'label' }, applying ? t('manage.applying') : t('manage.apply')),
            applying || changeCount === 0
              ? null
              : h('span', { key: 'count', className: 'dwp-count-badge', 'aria-hidden': true }, String(changeCount)),
          ]),
        ]),
        h('p', { key: 'description', className: 'dwp-manage-desc' }, t('manage.description')),
        body,
        h('div', { key: 'foot', className: 'dwp-manage-foot' }, [
          h('span', { key: 'summary', className: 'dwp-manage-summary' }, t('manage.selected', { count: selected.size })),
          warning,
        ]),
        confirmation,
        applyError === ''
          ? null
          : h('p', { key: 'apply-error', className: 'dwp-error', role: 'alert' }, t('manage.applyFailed', { reason: applyError })),
      ])
    }

    return { ManageWorkspacesView }
  },
})
