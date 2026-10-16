/**
 * The injection notice.
 *
 * It reports what the Host recorded for the newest decision of the whole Host:
 * a prompt just reached an agent (`ok`), or a workspace prompt that is switched
 * on has no body to inject (`warn`). Detection lives in `client.js` (it polls
 * outside React) and the policy lives in `client.store.js`; this module only
 * renders whatever notice the store currently holds and owns the five-second
 * hold.
 *
 * Nothing here depends on the user having clicked anything: the notice is the
 * only feedback a "the prompt was injected on my last message" event gets, and
 * it must arrive for a user who has never opened the plugin's UI.
 *
 * A notice is replaced by the next one rather than stacked, so the layer never
 * grows a pile of stale confirmations. Closing it — by hand or by the hold — is
 * final for the occurrence it reports.
 *
 * Self-contained chunk: `react` is the platform seed, and the store, the bound
 * translate function, and the icons arrive as props from the entry.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.toast.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useSyncExternalStore } = React

    /** How long one notice stays before it closes itself, in milliseconds. */
    const HOLD_MS = 5_000

    /**
     * The toast view.
     * @param props - `{ store, t, icons }` from the entry.
     * @returns the notice, or null while the queue is empty.
     */
    function InjectionToast({ store, t, icons }) {
      const current = useSyncExternalStore(store.subscribe, store.getNoticeSnapshot, store.getNoticeSnapshot)
      const notice = current.notice
      const seq = current.seq

      // The five-second hold: cleared on unmount and restarted by the next
      // notice, so a notice never outlives the component that shows it.
      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => { store.dismissNotice() }, HOLD_MS)
        return () => { clearTimeout(timer) }
      }, [notice, seq, store])

      if (notice === null) return null
      const tone = typeof notice.tone === 'string' ? notice.tone : 'ok'
      return h('div', { className: 'dwp-toast-root' }, h('div', {
        key: seq,
        className: 'dwp-toast',
        'data-tone': tone,
        // An error is an interruption; a warning about a prompt that was not
        // injected is information, so it stays a polite status.
        role: tone === 'error' ? 'alert' : 'status',
      }, [
        h('span', { key: 'dot', className: 'dwp-toast-dot', 'aria-hidden': true }),
        h('div', { key: 'text', className: 'dwp-toast-text' }, [
          h('div', { key: 'title', className: 'dwp-toast-title' }, notice.title),
          notice.detail === undefined || notice.detail === ''
            ? null
            : h('div', { key: 'detail', className: 'dwp-toast-detail' }, notice.detail),
        ]),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'dwp-toast-close',
          'aria-label': t('toast.close'),
          title: t('toast.close'),
          onClick: () => { store.dismissNotice() },
        }, h(icons.IconCloseOutline, { size: 12 })),
      ]))
    }

    return { InjectionToast }
  },
})
