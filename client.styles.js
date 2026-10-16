/**
 * The plugin's whole stylesheet, as one string.
 *
 * `client.js` inserts it in a `ctx.effect` that returns the removal function, so
 * the rules leave with the plugin. Every colour, border, and surface comes from
 * a `--dsw-alias-*` / `--dsw-specific-*` theme token — a literal colour here
 * would stay light while the shell went dark. Class names all carry the `dwp-`
 * prefix so nothing collides with the shipped sheets.
 *
 * Two surfaces are described here:
 *
 * - the **inline editor** (`client.dialog.js`), which is committed inside the
 *   settings content column and therefore positions nothing: it is a bordered
 *   block in the page's flow, with no backdrop and no z-order of its own;
 * - the **injection notice** (`client.toast.js`), the plugin's only remaining
 *   `shell.overlay` entry, which resets `pointer-events` because that layer is
 *   click-through.
 *
 * The settings page (`client.settings.js`) ships its own string, which the entry
 * appends to this one: the plugin keeps a single `<style>` node and a single
 * insertion effect, while each chunk owns the rules for the markup it renders.
 *
 * Self-contained chunk: one string, nothing from the module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.styles.js',
  factory() {
    /** Every rule this plugin owns. */
    const STYLESHEET = `
/* ---- overlay entries (the injection notice is the only one) ---- */
.dwp-toast-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

/* ---- inline editor (settings page, second view) ---- */
.dwp-editor-view {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.dwp-editor-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dwp-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}

.dwp-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.dwp-switch-track {
  position: relative;
  flex: none;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--dsw-alias-state-idle-primary);
  transition: background 120ms ease;
}

.dwp-switch[aria-checked='true'] .dwp-switch-track {
  background: var(--dsw-alias-brand-primary);
}

.dwp-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  transition: transform 120ms ease;
}

.dwp-switch[aria-checked='true'] .dwp-switch-track::after {
  transform: translateX(14px);
}

.dwp-switch-state {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.dwp-editor-target {
  margin: 0;
  padding: 10px 14px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.dwp-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
}

.dwp-tab {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}

.dwp-tab[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
}

.dwp-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-body {
  flex: 1 1 auto;
  min-height: 220px;
  overflow: auto;
  padding: 12px 14px;
}

.dwp-editor {
  display: block;
  width: 100%;
  min-height: 260px;
  resize: vertical;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.dwp-editor:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-editor[readonly] {
  cursor: default;
}

.dwp-browse {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.dwp-browse-empty {
  color: var(--dsw-alias-label-secondary);
}

.dwp-browse h1,
.dwp-browse h2,
.dwp-browse h3,
.dwp-browse h4,
.dwp-browse h5,
.dwp-browse h6 {
  margin: 18px 0 8px;
  line-height: 1.35;
}

.dwp-browse h1 { font-size: 20px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 6px; }
.dwp-browse h2 { font-size: 17px; }
.dwp-browse h3 { font-size: 15px; }
.dwp-browse h4,
.dwp-browse h5,
.dwp-browse h6 { font-size: 13px; }

.dwp-browse p {
  margin: 8px 0;
}

.dwp-browse ul,
.dwp-browse ol {
  margin: 8px 0;
  padding-left: 22px;
}

.dwp-browse li {
  margin: 3px 0;
}

.dwp-browse blockquote {
  margin: 10px 0;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}

.dwp-browse pre {
  margin: 10px 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}

.dwp-browse code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.dwp-browse :not(pre) > code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
}

.dwp-browse a {
  color: var(--dsw-alias-brand-primary);
}

.dwp-browse hr {
  margin: 14px 0;
  border: none;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-editor-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-status {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.dwp-status[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dwp-status[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}

.dwp-save {
  flex: none;
  padding: 6px 16px;
  border: 1px solid var(--dsw-alias-brand-primary);
  border-radius: 6px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font: inherit;
  cursor: pointer;
}

.dwp-save:disabled {
  opacity: 0.6;
  cursor: default;
}

.dwp-save:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

/* ---- injection toast ---- */
.dwp-toast {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 360px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  pointer-events: auto;
}

.dwp-toast-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
}

.dwp-toast[data-tone='error'] .dwp-toast-dot {
  background: var(--dsw-alias-state-error-primary);
}

.dwp-toast[data-tone='warn'] .dwp-toast-dot {
  background: var(--dsw-alias-state-warn-primary);
}

.dwp-toast-text {
  min-width: 0;
}

.dwp-toast-title {
  font-weight: 600;
}

.dwp-toast-detail {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
}

.dwp-toast-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  line-height: 0;
}

.dwp-toast-close:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.dwp-toast-close:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
`

    return { STYLESHEET }
  },
})
