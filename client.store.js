/**
 * The plugin's state that must outlive the React trees using it.
 *
 * Three things live here, because none of them can live inside a component:
 *
 * 1. **The edit target.** The settings page lists workspaces and hosts the
 *    editor; "which workspace is open" has to survive a re-render of either, so
 *    the click travels through this store rather than through local state.
 * 2. **The notice queue.** The injection watcher runs in the plugin's Cordis
 *    effect — outside any component — and pushes notices into it.
 * 3. **The injection ledger.** Which decision the notice has already reported,
 *    and which occurrence the user closed. Keeping the policy here makes it a
 *    pure function of `(record, now)`: no timer, no fetch, no Session — so the
 *    checks exercise it directly instead of only through a browser.
 *
 * Both snapshots are `useSyncExternalStore` sources, so every snapshot is frozen
 * and its identity only changes when the value does; a fresh object per read
 * would re-render forever.
 *
 * Self-contained chunk: plain JavaScript, nothing from the module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.store.js',
  factory() {
    /** No editor is open. */
    const CLOSED_TARGET = Object.freeze({ open: false, workspaceId: '', workspaceName: '' })

    /** The notice queue with nothing to show. */
    const EMPTY_NOTICE = Object.freeze({ seq: 0, notice: null })

    /**
     * How long an injection stays news.
     *
     * `injectedAt` is the Host's own timestamp for the moment the prompt reached
     * the agent, so this single comparison is what separates "the message I just
     * sent" from an injection that happened while the tab was closed.
     */
    const FRESH_MS = 3_000

    /** A string field of a Host answer, or `''`. */
    const text = (value) => (typeof value === 'string' ? value : '')

    /** A finite numeric field of a Host answer, or `0`. */
    const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

    /** One editor state value: open or closed, plus the workspace it edits. */
    function targetValue(target) {
      return target === null ? CLOSED_TARGET : Object.freeze({ open: true, ...target })
    }

    /** The edit target, the notice queue, and the injection ledger. */
    class WorkspacePromptStore {
      /** Current editor snapshot (stable identity until the target changes). */
      #target = CLOSED_TARGET

      /** The workspace the editor is open for right now, or null. */
      #open = null

      /**
       * The editor's leave guard, while the editor is mounted.
       *
       * The back control lives in the settings page's header (it has to sit above
       * the title), but only the editor knows whether leaving would drop unsaved
       * work. The editor registers its guard here and the header calls
       * {@link requestClose}, so the two-step "warn, then leave" behaviour stays
       * owned by the component that holds the draft.
       */
      #closeIntent = null

      /** Current notice snapshot (stable identity until the queue changes). */
      #notice = EMPTY_NOTICE

      /** Monotonic stamp so a repeated text still remounts its notice. */
      #noticeStamp = 0

      /** Subscribed readers of either snapshot. */
      #listeners = new Set()

      /** Highest injection `seq` the notice has already reported. */
      #lastSeq = 0

      /** Whether the baseline has been established. */
      #primed = false

      /** The occurrence the user closed, never raised again. */
      #dismissedSeq = 0

      /**
       * Read the editor snapshot (the `useSyncExternalStore` snapshot).
       * @returns `{ open, workspaceId, workspaceName }`.
       */
      getSnapshot = () => this.#target

      /**
       * Read the notice snapshot (the `useSyncExternalStore` snapshot).
       * @returns `{ seq, notice }`.
       */
      getNoticeSnapshot = () => this.#notice

      /**
       * Subscribe to both editor and notice changes. A reader pairs one
       * subscription with whichever `get*Snapshot` method it renders.
       * @param listener - called after every change.
       * @returns the unsubscribe function.
       */
      subscribe = (listener) => {
        this.#listeners.add(listener)
        return () => { this.#listeners.delete(listener) }
      }

      /**
       * Highest reported injection `seq` — the ledger's cursor (diagnostic).
       * @returns the sequence number.
       */
      get lastSeq() {
        return this.#lastSeq
      }

      /**
       * The occurrence the user closed, or 0 (diagnostic).
       * @returns the sequence number.
       */
      get dismissedSeq() {
        return this.#dismissedSeq
      }

      /**
       * Open the editor for one workspace.
       *
       * The settings page owns the list, so this is where the plugin learns
       * which workspace is being edited: the row's id and title are handed over
       * as they are, and the editor reads everything else from the Host. The
       * settings page subscribes to the same snapshot, which is how the click
       * swaps its list view for the editor.
       * @param target - `{ workspaceId, workspaceName }` from the list row.
       */
      open(target) {
        const workspaceId = String(target?.workspaceId ?? '')
        if (workspaceId === '') return
        this.#open = Object.freeze({ workspaceId, workspaceName: text(target?.workspaceName) })
        this.#publishTarget()
      }

      /** Close the editor. What it edited stays on the Host. */
      close() {
        if (this.#open === null) return
        this.#open = null
        this.#publishTarget()
      }

      /**
       * Ask to leave the editor, through whatever guard is installed.
       *
       * The settings page's back control calls this instead of {@link close}:
       * the guard may refuse once (unsaved work) and the caller never has to know.
       * With no editor mounted there is nothing to guard, so it closes directly.
       */
      requestClose() {
        if (this.#closeIntent !== null) {
          this.#closeIntent()
          return
        }
        this.close()
      }

      /**
       * Install the editor's leave guard for as long as it is mounted.
       * @param intent - called on every {@link requestClose}; it decides whether
       *   to leave now, to warn first, or to do nothing.
       * @returns the disposer that clears the guard (a later install wins).
       */
      onRequestClose(intent) {
        this.#closeIntent = typeof intent === 'function' ? intent : null
        return () => {
          if (this.#closeIntent === intent) this.#closeIntent = null
        }
      }

      /**
       * Replace the notice queue with one notice (or clear it).
       * @param notice - `{ tone, title, detail, injectionSeq }`, or null to clear.
       */
      showNotice(notice) {
        if (notice === null || notice === undefined) {
          if (this.#notice.notice === null) return
          this.#notice = EMPTY_NOTICE
        } else {
          this.#noticeStamp += 1
          this.#notice = Object.freeze({ seq: this.#noticeStamp, notice: Object.freeze({ ...notice }) })
        }
        this.#emit()
      }

      /**
       * Retire the notice on screen.
       *
       * Called both by the close button and by the notice's own hold: either way
       * that occurrence is over, so its injection `seq` is remembered and never
       * raised again — closing a notice is final for the event it reported.
       */
      dismissNotice() {
        const current = this.#notice.notice
        if (current === null) return
        const seq = count(current.injectionSeq)
        if (seq > 0) this.#dismissedSeq = seq
        this.showNotice(null)
      }

      /**
       * Fold one `GET /api/workspacePrompt/latest` answer into the ledger and
       * decide whether it is news.
       *
       * Order matters, and each step is deliberate:
       *
       * - the **first answer is only a baseline**: whatever the Host did before
       *   this watcher existed is history, not news. "No injection on record
       *   yet" (seq 0) is a baseline too — it leaves the cursor at zero, so the
       *   very first injection of this page's lifetime is still announced;
       * - a `seq` **below** the cursor means the Host restarted its counter, so
       *   the old high-water mark would silence every later injection — the
       *   cursor follows it down and the occurrence bookkeeping starts over;
       * - a record that is not `injected: true` is never announced **and never
       *   claims its `seq`**, so a step that injected nothing cannot eat the
       *   number of the successful injection that follows it;
       * - a fresh success claims its `seq` and is announced exactly once.
       *
       * @param record - the Host's newest injection record.
       * @param now - the current time; injectable so the policy is testable.
       * @returns `{ seq, workspaceName, characters }`, or null when there is
       *   nothing to announce.
       */
      observeInjection(record, now = Date.now()) {
        const seq = count(record?.seq)
        if (!this.#primed) {
          this.#primed = true
          this.#lastSeq = seq
          return null
        }
        if (seq < this.#lastSeq) {
          this.#lastSeq = seq
          this.#dismissedSeq = 0
          return null
        }
        if (seq <= this.#lastSeq) return null
        if (seq === this.#dismissedSeq) return null
        if (record.injected !== true) return null
        const injectedAt = count(record.injectedAt)
        if (!(injectedAt > 0 && injectedAt <= now && now - injectedAt < FRESH_MS)) return null
        this.#lastSeq = seq
        return Object.freeze({
          seq,
          workspaceName: text(record.workspaceName),
          characters: count(record.characters),
        })
      }

      /** Republish the editor snapshot, keeping identity stable when nothing moved. */
      #publishTarget() {
        const next = targetValue(this.#open)
        if (next === this.#target) return
        this.#target = next
        this.#emit()
      }

      /** Notify every reader. */
      #emit() {
        for (const listener of [...this.#listeners]) listener()
      }
    }

    return { WorkspacePromptStore, FRESH_MS }
  },
})
