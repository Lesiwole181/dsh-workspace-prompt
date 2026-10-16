/**
 * Inline SVG icons, drawn with `React.createElement`.
 *
 * The plugin cannot import the shipped icon set (no `@deepseek-ai/*` dependency
 * in a zero-build bundle), so the three glyphs it needs are inlined here. Every
 * one draws with `currentColor` and inherits its size from a prop, which keeps
 * them inside the theme instead of carrying a colour of their own.
 *
 * Self-contained chunk: `react` comes from the platform seed table, and nothing
 * else is needed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.icons.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * One `<svg>` wrapper shared by the glyphs.
     * @param props - `{ size, children }`.
     * @returns the svg element.
     */
    function svg({ size = 14, children }) {
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
     * A document with lines: the workspace-prompt row button.
     * @param props - `{ size }`.
     * @returns the icon element.
     */
    function IconPromptOutline({ size = 14 }) {
      return svg({
        size,
        children: [
          h('path', { key: 'sheet', d: 'M3.5 2.5h6l3 3v8h-9z' }),
          h('path', { key: 'fold', d: 'M9.5 2.5v3h3' }),
          h('path', { key: 'l1', d: 'M5.75 8.5h4.5' }),
          h('path', { key: 'l2', d: 'M5.75 11h3' }),
        ],
      })
    }

    /**
     * A cross: the dialog's and the Toast's close button.
     * @param props - `{ size }`.
     * @returns the icon element.
     */
    function IconCloseOutline({ size = 14 }) {
      return svg({
        size,
        children: [
          h('path', { key: 'a', d: 'M4 4l8 8' }),
          h('path', { key: 'b', d: 'M12 4l-8 8' }),
        ],
      })
    }

    /**
     * A markdown sheet: reserved for surfaces that need a documentation glyph.
     * @param props - `{ size }`.
     * @returns the icon element.
     */
    function IconMarkdownOutline({ size = 14 }) {
      return svg({
        size,
        children: [
          h('rect', { key: 'frame', x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }),
          h('path', { key: 'm', d: 'M5 10V6.5l2 2 2-2V10' }),
          h('path', { key: 'arrow', d: 'M10.75 6.5v3.5' }),
          h('path', { key: 'head', d: 'M9.5 8.75l1.25 1.25 1.25-1.25' }),
        ],
      })
    }

    return { IconPromptOutline, IconCloseOutline, IconMarkdownOutline }
  },
})
