/**
 * dsh-workspace-prompt — the page's whole stylesheet, as one string.
 *
 * `client.app.js` renders it once, inside the page component's own `<style>`
 * element, so the rules leave with the page; nothing is appended to the host
 * DOM. Every colour is a `--dsw-alias-*` / `--dsw-specific-*` theme token
 * — a literal colour here would stay light while the shell went dark — and
 * every class carries the `dwp-` prefix so nothing collides with shipped
 * sheets. Sizing uses plain pixels (theme tokens for radii), because the
 * settings panel's content column is a fixed 564×722-ish region.
 *
 * Self-contained chunk: one string, nothing from the module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.styles.js',
  factory() {
    /** Every rule this plugin owns. */
    const STYLE_TEXT = `
/* ---------- page shell ---------- */
.dwp-app {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.55;
}

.dwp-app,
.dwp-app *,
.dwp-app *::before,
.dwp-app *::after {
  box-sizing: border-box;
}

.dwp-root {
  /*
   * Shared right inset for a screen-level action button. The settings shell's
   * header action ("打开配置文件", the "open configuration file" button) sits
   * 50px inside the content column (header right padding 14 + close button 28 +
   * header gap 8); this section already consumes the options column's 24px side
   * padding, so the remaining inset is 50 - 24 = 26px. Both the list header and
   * the manage header use this variable so their action buttons line up.
   */
  --dwp-action-inset: 26px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.55;
}

.dwp-root,
.dwp-root *,
.dwp-root *::before,
.dwp-root *::after {
  box-sizing: border-box;
}

.dwp-view {
  min-width: 0;
}

.dwp-hint {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

/* ---------- buttons ---------- */
.dwp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px);
  font: inherit;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
}

.dwp-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.dwp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.dwp-btn-primary {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

.dwp-btn-primary:hover:not(:disabled) {
  border-color: var(--dsw-alias-button-primary-hover);
  background: var(--dsw-alias-button-primary-hover);
}

.dwp-btn-secondary {
  border-color: var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}

.dwp-btn-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dwp-btn-ghost {
  padding: 5px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}

.dwp-btn-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dwp-btn-danger {
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
}

.dwp-btn-danger:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-error-secondary);
  background: var(--dsw-alias-state-error-secondary);
}

.dwp-count-badge {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-label-primary-foreground);
  color: var(--dsw-alias-button-primary-fill);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 17px;
  text-align: center;
}

/* ---------- list view ---------- */

/*
 * Header row of the list box: the count on the left and the page's only action
 * ("Manage workspaces") on the right. It sits directly above the list box, so
 * the action reads as the box's top-right corner action instead of a page-level
 * toolbar action.
 *
 * The right inset aligns the button's right edge with the settings shell's
 * header action ("打开配置文件", the "open configuration file" button). The
 * value lives once in the --dwp-action-inset custom property on .dwp-root
 * (see the comment there); the same variable insets the manage view's Apply
 * button.
 */
.dwp-list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-right: var(--dwp-action-inset, 26px);
}

.dwp-list-head-meta {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dwp-list-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.dwp-list-head + .dwp-list,
.dwp-list-head + .dwp-empty {
  margin-top: -2px;
}

.dwp-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  list-style: none;
  overflow: hidden;
}

.dwp-list-item {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-list-item:first-child {
  border-top: none;
}

.dwp-workspace-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dwp-workspace-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dwp-workspace-row:active {
  background: var(--dsw-alias-interactive-bg-active);
}

.dwp-workspace-row:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}

.dwp-status-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}

.dwp-status-dot[data-enabled='true'] {
  background: var(--dsw-alias-state-success-primary);
}

.dwp-workspace-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dwp-workspace-name {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-workspace-path {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-workspace-meta {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dwp-chevron {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

/* ---------- shared states ---------- */
.dwp-loading {
  padding: 24px 8px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}

.dwp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 10px);
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}

.dwp-empty-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
}

.dwp-empty-body {
  margin: 0;
  max-width: 420px;
}

.dwp-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-state-error-primary);
}

.dwp-error-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dwp-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1);
}

.dwp-notice[data-tone='ok'] {
  border-color: var(--dsw-alias-state-success-primary);
}

.dwp-notice[data-tone='error'] {
  border-color: var(--dsw-alias-state-error-primary);
}

.dwp-notice-text {
  flex: 1 1 auto;
  min-width: 0;
}

.dwp-notice[data-tone='ok'] .dwp-notice-text {
  color: var(--dsw-alias-state-success-primary);
}

.dwp-notice[data-tone='error'] .dwp-notice-text {
  color: var(--dsw-alias-state-error-primary);
}

.dwp-notice-dismiss {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  line-height: 0;
  cursor: pointer;
}

.dwp-notice-dismiss:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dwp-notice-dismiss:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

/* ---------- manage view ---------- */
.dwp-manage-head {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Move the Apply button left off the content-column edge so it lines up with
     the list view's "Manage workspaces" button and the shell header action. */
  padding-right: var(--dwp-action-inset, 26px);
}

.dwp-manage-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.dwp-manage-desc {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dwp-manage-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  list-style: none;
  overflow-y: auto;
}

.dwp-manage-item {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-manage-item:first-child {
  border-top: none;
}

.dwp-manage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  cursor: pointer;
}

.dwp-manage-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dwp-manage-checkbox {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}

.dwp-manage-checkbox:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.dwp-manage-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dwp-manage-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-manage-path {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dwp-badge[data-tone='success'] {
  border-color: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
}

.dwp-manage-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dwp-manage-summary {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.dwp-manage-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
}

.dwp-warning-icon {
  display: inline-flex;
  flex: none;
  margin-top: 1px;
}

.dwp-confirm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md, 8px);
}

.dwp-confirm-body {
  margin: 0;
  color: var(--dsw-alias-label-primary);
}

.dwp-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* ---------- prompt editor ---------- */
.dwp-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.dwp-editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dwp-back {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.dwp-back:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dwp-back:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-editor-title {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.dwp-editor-name {
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-editor-path {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-editor-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}

.dwp-editor-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dwp-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
}

.dwp-tab {
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}

.dwp-tab:hover {
  color: var(--dsw-alias-label-primary);
}

.dwp-tab[aria-selected='true'] {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

.dwp-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-switch {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dwp-switch:disabled {
  opacity: 0.5;
  cursor: default;
}

.dwp-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.dwp-switch-track {
  position: relative;
  flex: none;
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background: var(--dsw-alias-state-idle-primary);
  transition: background 120ms ease;
}

.dwp-switch[aria-checked='true'] .dwp-switch-track {
  background: var(--dsw-alias-brand-primary);
}

.dwp-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb);
  transition: transform 120ms ease;
}

.dwp-switch[aria-checked='true'] .dwp-switch-thumb {
  transform: translateX(13px);
}

.dwp-switch-text {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.dwp-editor-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  min-height: 180px;
}

.dwp-textarea {
  display: block;
  width: 100%;
  min-height: 300px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  resize: vertical;
}

.dwp-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dwp-editor-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dwp-status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dwp-status[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dwp-status[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}

.dwp-status[data-tone='success'] {
  color: var(--dsw-alias-state-success-primary);
}

/* ---------- rendered Markdown (browse mode) ---------- */
.dwp-browse {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  max-height: 420px;
  overflow: auto;
}

.dwp-browse-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  padding: 24px 16px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}

.dwp-browse h1,
.dwp-browse h2,
.dwp-browse h3,
.dwp-browse h4,
.dwp-browse h5,
.dwp-browse h6 {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.35;
}

.dwp-browse h1 {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  font-size: 19px;
}

.dwp-browse h2 {
  font-size: 16px;
}

.dwp-browse h3 {
  font-size: 14px;
}

.dwp-browse h4,
.dwp-browse h5,
.dwp-browse h6 {
  font-size: 13px;
}

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
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2);
  overflow: auto;
}

.dwp-browse code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.dwp-browse :not(pre) > code {
  padding: 1px 4px;
  border-radius: var(--dsw-radius-sm, 4px);
  background: var(--dsw-alias-bg-layer-2);
}

.dwp-browse a {
  color: var(--dsw-alias-link);
}

.dwp-browse hr {
  margin: 14px 0;
  border: none;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
`

    return { STYLE_TEXT }
  },
})
