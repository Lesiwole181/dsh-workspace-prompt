/**
 * dsh-workspace-prompt — the browser half.
 *
 * Zero build: this file is a classic script whose only statement registers a
 * bundle factory through `window.__ModuleLoader__.load({ id, factory })`. The
 * registration key is the **package name** — the loader derives the module-table
 * id from it (`<id>` for the entry, `<id>/<chunk>` for a chunk), so `chunk` is
 * what distinguishes this entry from its siblings.
 *
 * Everything the plugin needs lives in the factory closure, including the
 * `require` the loader hands in: sibling chunks are fetched with
 * `require.async('./client.<name>.js')` from inside that closure, because
 * `require` exists nowhere else. Each sibling is a self-contained chunk (a chunk
 * cannot synchronously require another relative `client*.js`), so the shared
 * store, the bound translate function, the Host API, the markdown renderer, the
 * editor component, and the icons are passed to the components as props by the
 * registration wrapper below.
 *
 * What this half assembles:
 *
 * 1. the `dwp-` stylesheet — this file's `client.styles.js` plus the rules the
 *    settings page owns — inserted once and removed with the plugin;
 * 2. the shared store: the settings page opens a workspace in it, and the editor
 *    it hosts reads it back;
 * 3. the settings page on `settings.section` (the entry point: there is no
 *    Session-row button any more). It owns both views — the workspace list and
 *    the editor it opens in place — so the editor is *not* an overlay entry;
 * 4. the injection notice on `shell.overlay`: the one frame-wide surface left,
 *    because a notice about a conversation may have to appear over anything;
 * 5. the injection watcher: a parameterless poll of the Host's newest injection
 *    record. It deliberately **does not depend on any click** — the notice is
 *    the only feedback a successful injection gets, and the user who never
 *    opens settings must still see it.
 *
 * All visible copy lives in the `dsh-workspace-prompt` locale namespace; no
 * component hard-codes a string.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  factory(require) {
    const h = require('react').createElement

    /** Locale namespace this plugin owns. */
    const NS = 'dsh-workspace-prompt'

    /** How often the Host's newest injection record is polled, in milliseconds. */
    const POLL_MS = 1_500

    /** Slot orders: the settings page, then the notice above everything. */
    const SETTINGS_ORDER = 25
    const TOAST_ORDER = 260

    /** Chinese dictionary. */
    const zh = {
      'settings.title': '工作区提示词',
      'settings.intro': '为每个工作区编写提示词。启用后，该工作区内每一次对话开始都会把它注入 Agent（不新增对话气泡；正文随上下文快照可在折叠行中展开查看）。',
      'settings.loading': '正在读取工作区…',
      'settings.empty': '还没有工作区。先创建或打开一个工作区，再回到这里编辑它的提示词。',
      'settings.failed': '读取工作区列表失败：{reason}',
      'settings.enabled': '已启用',
      'settings.disabled': '未启用',
      'settings.characters': '{characters} 字',
      'settings.editAria': '编辑「{workspace}」的提示词',
      'action.edit': '编辑提示词',
      'action.retry': '重试',
      'action.back': '返回',
      'action.save': '保存',
      'action.saving': '保存中…',
      'editor.title': '工作区提示词',
      'editor.workspace': '工作区：{workspace}',
      'editor.backAria': '返回工作区列表',
      'editor.label': '工作区提示词正文（{workspace}）',
      'editor.placeholder': '在这里编写该工作区的提示词（Markdown）。启用后，该工作区内每次对话开始都会把它注入 Agent，但不会出现在对话中。',
      'switch.label': '启用工作区提示词',
      'switch.on': '已启用',
      'switch.off': '未启用',
      'tabs.label': '编辑器模式',
      'tab.edit': '编辑',
      'tab.browse': '浏览',
      'browse.empty': '还没有提示词。切到「编辑」写下内容并保存。',
      'status.loading': '正在读取…',
      'status.saving': '正在保存…',
      'status.savedAt': '已保存 · {time}',
      'status.unsaved': '有未保存的修改',
      'status.unsavedBack': '有未保存的修改，再次点击「返回」将放弃它们',
      'status.enabled': '已启用，将在每次对话开始时注入',
      'status.disabled': '未启用，不会注入',
      'status.failed': '失败：{reason}',
      'toast.injected': '已注入工作区提示词',
      'toast.detail': '{workspace} · {characters} 字',
      'toast.close': '关闭提示',
    }

    /** English dictionary. */
    const en = {
      'settings.title': 'Workspace prompt',
      'settings.intro': 'Write a prompt for each workspace. Once enabled, it is injected into the agent at the start of every conversation in that workspace. It adds no chat bubble; the text rides the context snapshot and can be seen by expanding that row.',
      'settings.loading': 'Loading workspaces…',
      'settings.empty': 'No workspaces yet. Create or open one, then come back here to write its prompt.',
      'settings.failed': 'Could not read the workspace list: {reason}',
      'settings.enabled': 'Enabled',
      'settings.disabled': 'Disabled',
      'settings.characters': '{characters} characters',
      'settings.editAria': 'Edit the prompt for {workspace}',
      'action.edit': 'Edit prompt',
      'action.retry': 'Retry',
      'action.back': 'Back',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'editor.title': 'Workspace prompt',
      'editor.workspace': 'Workspace: {workspace}',
      'editor.backAria': 'Back to the workspace list',
      'editor.label': 'Workspace prompt body ({workspace})',
      'editor.placeholder': 'Write this workspace\'s prompt (Markdown) here. Once enabled, it is injected into the agent at the start of every conversation in this workspace, and never appears in the conversation itself.',
      'switch.label': 'Enable workspace prompt',
      'switch.on': 'Enabled',
      'switch.off': 'Disabled',
      'tabs.label': 'Editor mode',
      'tab.edit': 'Edit',
      'tab.browse': 'Browse',
      'browse.empty': 'No prompt yet. Switch to Edit, write it, and save.',
      'status.loading': 'Loading…',
      'status.saving': 'Saving…',
      'status.savedAt': 'Saved · {time}',
      'status.unsaved': 'Unsaved changes',
      'status.unsavedBack': 'Unsaved changes — click Back again to discard them',
      'status.enabled': 'Enabled — injected at the start of every conversation',
      'status.disabled': 'Disabled — nothing is injected',
      'status.failed': 'Failed: {reason}',
      'toast.injected': 'Workspace prompt injected',
      'toast.detail': '{workspace} · {characters} characters',
      'toast.close': 'Dismiss',
    }

    /**
     * Watch the Host's newest injection record and announce it once.
     *
     * The poll is parameterless on purpose. The previous design watched a
     * Session the user had clicked, which made the notice silently dependent on
     * a button that no longer exists; `GET /api/workspacePrompt/latest` reports
     * the newest successful injection of the whole Host instead, so the notice
     * works for a user who never opens this plugin's UI.
     *
     * The record provides its own freshness: `injectedAt` is the Host's
     * timestamp for the moment the prompt reached the agent, and the ledger
     * refuses anything older than a couple of seconds. That is the whole answer
     * to "did a conversation just start?" — no Session, no click, no guesswork —
     * and why a step that injected nothing needs no branch here: the Host does
     * not expose those records at all.
     *
     * A failed poll is silent: a transport hiccup must not interrupt the user
     * with a notice, and the next poll is 1.5s away.
     */
    class InjectionWatcher {
      /** The poll timer, while one is armed. */
      #timer

      /** Set once the owning effect is disposed. */
      #stopped = false

      /**
       * @param options - `{ store, poll, t }`; `poll` reads the newest record.
       */
      constructor({ store, poll, t }) {
        this.store = store
        this.poll = poll
        this.t = t
      }

      /** Start polling immediately and then every {@link POLL_MS}. */
      start() {
        if (this.#stopped || this.#timer !== undefined) return
        this.#timer = setInterval(() => { void this.check() }, POLL_MS)
        // The first pass primes the ledger instead of announcing: an injection
        // that happened before this window existed is history, not news.
        void this.check()
      }

      /** Stop polling. The effect that owns this watcher calls it on disposal. */
      stop() {
        this.#stopped = true
        if (this.#timer !== undefined) clearInterval(this.#timer)
        this.#timer = undefined
      }

      /** One detection pass. */
      async check() {
        if (this.#stopped) return
        let record
        try {
          record = await this.poll()
        } catch {
          // Unreachable Host, or the plugin going away mid-request: stay quiet.
          return
        }
        if (this.#stopped) return
        const announced = this.store.observeInjection(record, Date.now())
        if (announced === null) return
        const name = announced.workspaceName !== '' ? announced.workspaceName : this.t('editor.title')
        this.store.showNotice({
          tone: 'ok',
          title: this.t('toast.injected'),
          detail: this.t('toast.detail', {
            workspace: name,
            characters: announced.characters,
          }),
          injectionSeq: announced.seq,
        })
      }
    }

    /**
     * Register the plugin's effects and slot entries.
     *
     * Synchronous on purpose: Cordis does not await a plugin's `apply` return
     * value, so every registration happens in one tick after the chunks are in
     * hand. The chunks are loaded before this runs, never during it.
     * @param ctx - the client root context.
     * @param loaded - the chunk exports.
     */
    function applyPlugin(ctx, loaded) {
      const { api, storeModule, icons, styles, dialog, settings, toast, markdown } = loaded
      const store = new storeModule.WorkspacePromptStore()
      // Bound once: the locale service returns a reference that is stable per
      // namespace, so passing it through wrappers costs nothing per render.
      const t = ctx.locale.bind(NS)

      // `ctx.effect` runs the callback now and keeps its return value as the
      // disposer, so the dictionaries and the stylesheet leave with the plugin.
      // The settings page's rules ride along in the same node: one stylesheet,
      // one insertion point, and every `dwp-` rule still leaves with the plugin.
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workspace-prompt: dictionaries')
      ctx.effect(() => {
        const node = document.createElement('style')
        node.setAttribute('data-plugin', NS)
        node.textContent = styles.STYLESHEET + settings.SETTINGS_STYLES
        document.head.append(node)
        return () => { node.remove() }
      }, 'dsh-workspace-prompt: styles')

      // The watcher outlives every component in this plugin: it is armed here and
      // disarmed by the effect's disposer, timers included.
      ctx.effect(() => {
        const watcher = new InjectionWatcher({
          store,
          t,
          poll: () => api.readLatest(),
        })
        watcher.start()
        return () => { watcher.stop() }
      }, 'dsh-workspace-prompt: injection watcher')

      // The settings page is the entry point, and it owns both views: the
      // workspace list and — in place of it, in the settings content column —
      // the editor. `slots.inject` waits for the settings shell to declare the
      // list, and this entry leaves with that declaration; the shell passes
      // `{ close }` and nothing else, so the store, `t`, the API, the icons, the
      // markdown renderer, and the editor component are wrapped in here.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-workspace-prompt',
        order: SETTINGS_ORDER,
        label: () => t('settings.title'),
      }, (props) => h(settings.WorkspacePromptSettings, {
        ...props,
        store,
        t,
        api,
        icons,
        markdown,
        editor: dialog.WorkspacePromptEditor,
      })))

      // The injection notice is the only overlay entry left: it reports on a
      // conversation that may be running anywhere in the frame, so it cannot
      // live inside the settings page the user may never open.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-workspace-prompt.injection-toast',
        order: TOAST_ORDER,
      }, (props) => h(toast.InjectionToast, { ...props, store, t, icons })))
    }

    /**
     * Fetch every chunk, leaves first.
     *
     * The order is a dependency order: a chunk's own body may use anything it
     * already has, and the view chunks only need what the entry passes them, so
     * nothing here waits on a sibling that has not arrived.
     * @returns the chunk exports, memoized by the caller.
     */
    async function loadChunks() {
      const api = await require.async('./client.api.js')
      const storeModule = await require.async('./client.store.js')
      const icons = await require.async('./client.icons.js')
      const styles = await require.async('./client.styles.js')
      const markdown = await require.async('./client.markdown.js')
      const dialog = await require.async('./client.dialog.js')
      const settings = await require.async('./client.settings.js')
      const toast = await require.async('./client.toast.js')
      return { api, storeModule, icons, styles, markdown, dialog, settings, toast }
    }

    /** Chunk exports, loaded once. */
    let loaded

    return {
      inject: ['slots', 'locale'],
      /**
       * The plugin body.
       *
       * The chunk load is the only asynchronous step; the registration that
       * follows is synchronous, so a slow script arrival cannot leave the plugin
       * half-mounted. A load failure is reported instead of swallowed — without
       * the chunks nothing mounts at all, and silence would be undebuggable.
       * @param ctx - the client root context.
       */
      async apply(ctx) {
        try {
          loaded ??= await loadChunks()
        } catch (error) {
          const message = `[${NS}] client chunks failed to load: ${error instanceof Error ? error.message : String(error)}`
          if (typeof ctx?.logger?.error === 'function') ctx.logger.error(message)
          else console.error(message, error)
          return
        }
        applyPlugin(ctx, loaded)
      },
    }
  },
})
