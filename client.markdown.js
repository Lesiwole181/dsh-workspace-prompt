/**
 * A small Markdown renderer with no dependencies.
 *
 * The browse tab shows the prompt file the user just wrote, so the renderer only
 * has to cover ordinary prose: headings, paragraphs, lists, quotes, fenced code,
 * rules, and inline code / bold / italic / links. Two properties matter more
 * than coverage:
 *
 * 1. raw HTML is never parsed — every text run becomes a React string child, so
 *    a `<script>` in the prompt is displayed, not executed; and
 * 2. a link only becomes an anchor for `http(s)`, `mailto`, and relative
 *    targets, so `javascript:` arrives as plain text.
 *
 * Fenced blocks are collected first, which is what keeps code inside them out of
 * every later rule.
 *
 * Self-contained chunk: `react` comes from the platform seed table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-prompt',
  chunk: 'client.markdown.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The only URL shapes a link may carry; `//host` is treated as relative and dropped. */
    const SAFE_LINK = /^(?:https?:\/\/|mailto:)[^\s]*$/i

    /** One safe link target, or undefined when the destination must stay text. */
    function safeHref(raw) {
      const target = raw.trim().replace(/^<|>$/g, '')
      if (target === '' || target.startsWith('//')) return undefined
      if (SAFE_LINK.test(target)) return target
      // A relative target carries no scheme; anything with one is refused.
      return /^[a-z][a-z0-9+.-]*:/i.test(target) ? undefined : target
    }

    /**
     * One inline run.
     *
     * The alternation tries code first, then bold, then a link, then emphasis;
     * the `[^*]` guards keep a lone `*` (a bullet in prose, a multiplication
     * sign) from swallowing the rest of the paragraph.
     * @param text - one line of Markdown.
     * @returns React children (strings and inline elements).
     */
    function renderInline(text) {
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\[[^\]\n]*\]\([^()\s]*\))|(\*[^*\n]+\*)|(_[^_\n]+_)/g
      const nodes = []
      let cursor = 0
      let key = 0
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0
        if (start > cursor) nodes.push(text.slice(cursor, start))
        const token = match[0]
        const push = (element) => {
          nodes.push(h(React.Fragment, { key: `i${key}` }, element))
          key += 1
        }
        if (match[1] !== undefined) {
          push(h('code', null, token.slice(1, -1)))
        } else if (match[2] !== undefined || match[3] !== undefined) {
          push(h('strong', null, renderInline(token.slice(2, -2))))
        } else if (match[4] !== undefined) {
          const split = token.indexOf('](')
          const label = token.slice(1, split)
          const href = safeHref(token.slice(split + 2, -1))
          if (href === undefined) {
            nodes.push(token)
          } else {
            push(h('a', { href, target: '_blank', rel: 'noreferrer noopener' }, renderInline(label)))
          }
        } else {
          push(h('em', null, renderInline(token.slice(1, -1))))
        }
        cursor = start + token.length
      }
      if (cursor < text.length) nodes.push(text.slice(cursor))
      return nodes
    }

    /**
     * Split one line into list-item body and whether the marker was ordered.
     * @param line - one source line.
     * @returns `{ ordered, body }` or null when the line is not an item.
     */
    function listItem(line) {
      const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
      if (unordered !== null) return { ordered: false, body: unordered[1] }
      const ordered = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line)
      if (ordered !== null) return { ordered: true, body: ordered[1] }
      return null
    }

    /** Whether a line opens a fenced code block. */
    const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*\S*\s*$/

    /** Whether a line is a horizontal rule. */
    const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/

    /** Whether a line continues a preceding paragraph. */
    function isParagraphLine(line) {
      return line.trim() !== ''
        && !FENCE.test(line)
        && !RULE.test(line)
        && !/^\s{0,3}(?:#{1,6}\s|>|(?:[-*+]|\d{1,9}[.)])\s)/.test(line)
    }

    /**
     * Render one block: headings, rules, quotes, fences, lists, then paragraphs.
     * @param lines - the source lines.
     * @returns one React element per block.
     */
    function renderBlocks(lines) {
      const blocks = []
      let index = 0
      let key = 0
      const nextKey = () => {
        key += 1
        return `b${key}`
      }
      while (index < lines.length) {
        const line = lines[index]
        if (line.trim() === '') {
          index += 1
          continue
        }
        const fence = FENCE.exec(line)
        if (fence !== null) {
          const closer = fence[1][0] === '`' ? '`' : '~'
          const body = []
          index += 1
          while (index < lines.length && !new RegExp(`^\\s{0,3}\\${closer}{3,}\\s*$`).test(lines[index])) {
            body.push(lines[index])
            index += 1
          }
          // An unterminated fence runs to the end of the file rather than throwing.
          if (index < lines.length) index += 1
          blocks.push(h('pre', { key: nextKey() }, h('code', null, body.join('\n'))))
          continue
        }
        if (RULE.test(line)) {
          blocks.push(h('hr', { key: nextKey() }))
          index += 1
          continue
        }
        const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          blocks.push(h(`h${level}`, { key: nextKey() }, renderInline(heading[2])))
          index += 1
          continue
        }
        if (/^\s{0,3}>/.test(line)) {
          const raw = []
          while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
            raw.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
            index += 1
          }
          const inner = raw
            .filter(entry => entry.trim() !== '')
            .map((entry, position) => h('p', { key: `q${position}` }, renderInline(entry)))
          blocks.push(h('blockquote', { key: nextKey() }, inner))
          continue
        }
        const first = listItem(line)
        if (first !== null) {
          const ordered = first.ordered
          const items = []
          while (index < lines.length) {
            const item = listItem(lines[index])
            if (item === null || item.ordered !== ordered) break
            items.push(h('li', { key: `li${items.length}` }, renderInline(item.body)))
            index += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey() }, items))
          continue
        }
        const paragraph = []
        while (index < lines.length && isParagraphLine(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        blocks.push(h('p', { key: nextKey() }, renderInline(paragraph.join(' '))))
      }
      return blocks
    }

    /**
     * Render Markdown into React elements.
     * @param text - the prompt body (any string; non-strings render as empty).
     * @returns one element per block, ready to place inside a container.
     */
    function renderMarkdown(text) {
      if (typeof text !== 'string' || text.trim() === '') return []
      return renderBlocks(text.replace(/\r\n?/g, '\n').split('\n'))
    }

    return { renderMarkdown }
  },
})
