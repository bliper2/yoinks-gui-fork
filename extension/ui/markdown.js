/*
 * A deliberately tiny Markdown renderer for the Terms and Privacy pages
 * (legal/*.md): headings (#, ##, ###), paragraphs, "- " lists, **bold**,
 * `code` and [links](https://…). Builds DOM nodes; never uses innerHTML.
 */
;(function (root) {
  'use strict'
  const { h } = root.YoinksDom

  function inline(text, onLink) {
    const out = []
    const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g
    let last = 0
    let m
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      if (m[1]) out.push(h('strong', { text: m[1] }))
      else if (m[2]) out.push(h('code', { text: m[2] }))
      else {
        const url = m[4]
        out.push(h('a', { href: url, text: m[3], rel: 'noopener', onclick: event => (event.preventDefault(), onLink(url)) }))
      }
      last = re.lastIndex
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }

  function render(markdown, { onLink = () => {} } = {}) {
    const blocks = String(markdown).replace(/\r/g, '').split(/\n{2,}/)
    const nodes = []
    for (const block of blocks) {
      const lines = block.split('\n').filter(line => line.trim())
      if (!lines.length) continue
      const heading = lines[0].match(/^(#{1,3})\s+(.*)$/)
      if (heading && lines.length === 1) {
        nodes.push(h(`h${heading[1].length + 1}`, {}, inline(heading[2], onLink)))
      } else if (lines.every(line => /^\s*-\s+/.test(line))) {
        nodes.push(h('ul', {}, lines.map(line => h('li', {}, inline(line.replace(/^\s*-\s+/, ''), onLink)))))
      } else {
        nodes.push(h('p', {}, inline(lines.join(' '), onLink)))
      }
    }
    return nodes
  }

  root.YoinksMarkdown = { render }
})(typeof self !== 'undefined' ? self : this)
