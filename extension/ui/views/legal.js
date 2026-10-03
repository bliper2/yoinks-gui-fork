/*
 * Terms and Privacy pages (text lives in legal/terms.md and legal/privacy.md).
 * Until the current terms are accepted, the terms page is a gate: the rest
 * of the app is locked and the helper refuses to download.
 */
;(function (root) {
  'use strict'
  const { h, icon, button } = root.YoinksDom
  const Markdown = root.YoinksMarkdown

  function create(ctx, name) {
    const { send, bridge } = ctx
    const body = h('div', { class: 'legal-body' }, h('p', { class: 'hint', text: 'Loading…' }))
    const agree = h('input', { type: 'checkbox', id: `agree-${name}` })
    const accept = button({ icon: 'check', text: 'Continue', variant: 'primary', size: 'lg', disabled: true, onClick: () => send({ type: 'terms:accept' }) })
    agree.addEventListener('change', () => (accept.disabled = !agree.checked))
    const gate = h(
      'div',
      { class: 'gate', hidden: true },
      h('label', { class: 'check check-strong', for: agree.id }, agree, 'I understand and accept the Terms of use and the Privacy notice.'),
      accept,
    )
    const other = name === 'terms' ? 'privacy' : 'terms'
    const el = h(
      'article',
      { class: 'card legal' },
      body,
      // The changelog ("what's new") is not a legal page: no links, no gate.
      name === 'changelog'
        ? button({ icon: 'back', text: 'Back', variant: 'ghost', onClick: () => ctx.go('home') })
        : h('p', { class: 'legal-links' }, button({ icon: other === 'privacy' ? 'info' : 'file', text: other === 'privacy' ? 'Read the Privacy notice' : 'Read the Terms of use', variant: 'link', onClick: () => ctx.go(other) })),
      name === 'changelog' ? null : gate,
    )

    bridge
      .readText(name)
      .then(text => body.replaceChildren(...Markdown.render(text, { onLink: url => bridge.openExternal(url) })))
      .catch(() => body.replaceChildren(h('p', { class: 'inline-error', text: `Could not load the ${name} text.` })))

    return {
      el,
      render(view) {
        const needed = view.ready && view.settings.termsAccepted < view.termsVersion
        gate.hidden = !needed
      },
    }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.legal = { create }
})(typeof self !== 'undefined' ? self : this)
