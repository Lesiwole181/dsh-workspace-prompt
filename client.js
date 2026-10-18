/**
 * dsh-workspace-prompt — browser half entry.
 *
 * A zero-build Client bundle: this classic script registers one factory through
 * `window.__ModuleLoader__.load()`. The factory loads the sibling chunks
 * (`client.<name>.js` in the package root, fetched with `require.async`), then
 * registers a single `settings.section` contribution whose component owns the
 * whole page (workspace list ⇄ manage view ⇄ prompt editor).
 *
 * The module table seeds `react`; chunks therefore only require `react` and
 * receive everything else (API client, markdown renderer, icons, styles,
 * components) through props from this entry. Styles are rendered by the page
 * component as a React `<style>` element, so they disappear with the page.
 *
 * UI revision 2 (2026-10-18): the list view's "Manage workspaces" action moved
 * from the page-level toolbar into the list-box header row (directly above the
 * box, right edge aligned with the settings shell's "open configuration file"
 * action), and the empty list box no longer renders a duplicate manage button.
 *
 * UI revision 3 (2026-10-18): the manage view's top-left control is now "Back"
 * (返回) instead of "Cancel" (it still returns to the list without applying),
 * and its "Apply" button is inset from the content-column edge by the shared
 * `--dwp-action-inset`, lining it up with the list view's action button.
 *
 * This comment also changes the entry bundle's artifact revision, so the Host's
 * client-module HMR watch serves the new chunk URLs after reloading the plugin.
 *
 * Recovery bump (2026-10-18): the settings entry can disappear from a page when
 * its plugin reload races a temporarily invalid chunk file (a failed chunk
 * import aborts `apply`, so no `settings.section` entry is registered until the
 * package reloads again). The fixed chunks are on disk; this entry revision is
 * bumped once more so the HMR watch re-publishes and the page reloads the
 * plugin — no host restart or manual page refresh required.
 */

window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-workspace-prompt'

    /** Order of the settings page among the other settings sections. */
    const SETTINGS_SECTION_ORDER = 25

    /** Sibling chunks and the props key each one is exposed under. */
    const CHUNKS = [
      ['i18n', './client.i18n.js'],
      ['api', './client.api.js'],
      ['markdown', './client.markdown.js'],
      ['icons', './client.icons.js'],
      ['styles', './client.styles.js'],
      ['app', './client.app.js'],
      ['workspaceList', './client.workspace-list.js'],
      ['manageWorkspaces', './client.manage-workspaces.js'],
      ['promptEditor', './client.prompt-editor.js'],
    ]

    /** Chunk exports, loaded once per page lifetime. */
    let modules

    /**
     * Load every sibling chunk (the only asynchronous step in the plugin).
     * @returns {Promise<Record<string, object>>} Chunk exports keyed by prop name.
     */
    async function loadChunks() {
      const loaded = {}
      for (const [key, file] of CHUNKS) {
        loaded[key] = await require.async(file)
      }
      return loaded
    }

    /**
     * Register locale dictionaries, then the settings page.
     * @param {object} ctx Client root context.
     * @param {Record<string, object>} loaded Chunk exports.
     * @returns {void}
     */
    function registerPlugin(ctx, loaded) {
      const t = ctx.locale.bind(NS)
      const api = loaded.api.createWorkspacePromptApi()

      // Re-render the page when the active locale changes. `t` reads the active
      // locale at call time, so the re-render is all that is needed.
      const useLocaleVersion = () => React.useSyncExternalStore(
        (onChange) => ctx.locale.subscribe(onChange),
        () => ctx.locale.getSnapshot().active,
        () => ctx.locale.getSnapshot().active,
      )

      ctx.effect(
        () => ctx.locale.register(NS, { zh: loaded.i18n.zh, en: loaded.i18n.en }),
        `${NS}: dictionaries`,
      )

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: SETTINGS_SECTION_ORDER,
        label: () => t('settings.title'),
      }, (props) => h(loaded.app.WorkspacePromptApp, {
        ...props,
        t,
        api,
        useLocaleVersion,
        modules: loaded,
      })))
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Client plugin body.
       * @param {object} ctx Client root context.
       * @returns {Promise<void>} Resolves after registration; a chunk load
       *   failure is logged and leaves the plugin unmounted.
       */
      async apply(ctx) {
        try {
          modules ??= await loadChunks()
        } catch (error) {
          const message = `[${NS}] client chunks failed to load: ${error instanceof Error ? error.message : String(error)}`
          if (typeof ctx.logger?.error === 'function') ctx.logger.error(message)
          else console.error(message, error)
          return
        }
        try {
          registerPlugin(ctx, modules)
        } catch (error) {
          const message = `[${NS}] client registration failed: ${error instanceof Error ? error.message : String(error)}`
          if (typeof ctx.logger?.error === 'function') ctx.logger.error(message)
          else console.error(message, error)
        }
      },
    }
  },
})
