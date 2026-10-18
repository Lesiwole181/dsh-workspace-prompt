/**
 * dsh-workspace-prompt — inline SVG icons.
 *
 * A zero-build Client chunk may not import the shipped icon set (only the
 * platform `react` seed is available), so the seven glyphs this page needs
 * are drawn here with `React.createElement`. Every glyph shares one `<svg>`
 * wrapper: 16×16 viewBox, `currentColor` strokes, `aria-hidden`, and a `size`
 * prop, so it inherits the surrounding theme instead of carrying a colour.
 *
 * Self-contained chunk: `react` comes from the platform seed table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.icons.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Shared `<svg>` wrapper for every glyph.
     * @param {number} size - Rendered edge length in pixels.
     * @param {Array<*>} children - Path/rect children.
     * @returns {object} The svg element.
     */
    function glyph(size, children) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, children)
    }

    /**
     * Left arrow: the editor's back control.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconBack({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'shaft', d: 'M12.5 8H3.5' }),
        h('path', { key: 'head', d: 'M7 4.5L3.5 8 7 11.5' }),
      ])
    }

    /**
     * Right chevron: the "open workspace" affordance on a list row.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconChevronRight({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'chevron', d: 'M6 3.5L10.5 8 6 12.5' }),
      ])
    }

    /**
     * Cross: dismissing a notice.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconClose({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'a', d: 'M4 4l8 8' }),
        h('path', { key: 'b', d: 'M12 4l-8 8' }),
      ])
    }

    /**
     * Plus: the primary "manage workspaces" action.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconPlus({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'h', d: 'M8 3.5v9' }),
        h('path', { key: 'v', d: 'M3.5 8h9' }),
      ])
    }

    /**
     * A sheet of lined paper: a workspace prompt.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconPrompt({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'sheet', d: 'M3.5 2.5h6l3 3v8h-9z' }),
        h('path', { key: 'fold', d: 'M9.5 2.5v3h3' }),
        h('path', { key: 'line-1', d: 'M5.5 8.5h5' }),
        h('path', { key: 'line-2', d: 'M5.5 11h3' }),
      ])
    }

    /**
     * Checkmark: an "added" badge or a successful state.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconCheck({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'check', d: 'M3 8.5l3 3 7-7' }),
      ])
    }

    /**
     * Warning triangle: the removal warning in the manage view.
     * @param {{ size?: number }} props - Optional rendered size.
     * @returns {object} The icon element.
     */
    function IconWarning({ size = 14 }) {
      return glyph(size, [
        h('path', { key: 'frame', d: 'M8 2.5l5.5 10.5h-11z' }),
        h('path', { key: 'mark', d: 'M8 6.5v2.75' }),
        h('path', { key: 'dot', d: 'M8 11.5v.01' }),
      ])
    }

    return {
      IconBack,
      IconChevronRight,
      IconClose,
      IconPlus,
      IconPrompt,
      IconCheck,
      IconWarning,
    }
  },
})
