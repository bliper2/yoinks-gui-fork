/*
 * The Yoinks app shell: header + navigation, view switching, theme, toasts,
 * the first-run terms gate and keyboard shortcuts. Runs in the extension
 * popup, the extension's settings tab and the desktop window.
 */
;(function (root) {
  'use strict'
  const { h, icon, button } = root.YoinksDom
  const Views = root.YoinksViews
  const bridge = root.YoinksBridge

  const mode = bridge.platform === 'desktop' ? 'desktop' : bridge.isPopup ? 'popup' : 'page'
  document.documentElement.dataset.mode = mode

  let current = null
  let lastView = null
  let lastLook = null

  const ctx = { bridge, send: command => bridge.send(command), go }

  const lookup = Views.lookup.create(ctx)
  const queue = Views.queue.create(ctx)
  const views = {
    home: { el: h('div', { class: 'view-home' }, lookup.el, queue.el), render: v => (lookup.render(v), queue.render(v)), focus: lookup.focus },
    batch: Views.batch.create(ctx),
    settings: Views.settings.create(ctx),
    terms: Views.legal.create(ctx, 'terms'),
    privacy: Views.legal.create(ctx, 'privacy'),
  }

  // ---------- header ----------

  const NAV = [
    ['home', 'download', 'Download'],
    ['batch', 'list', 'Batch'],
    ['settings', 'settings', 'Settings'],
  ]
  const navButtons = NAV.map(([name, iconName, label]) =>
    h('button', { type: 'button', class: 'nav-btn', dataset: { view: name }, title: label, 'aria-label': label, onclick: () => go(name) }, icon(iconName), h('span', { class: 'nav-label', text: label })),
  )
  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, navButtons)
  const windowControls = bridge.window
    ? h(
        'div',
        { class: 'window-controls' },
        button({ icon: 'minimize', label: 'Minimize', variant: 'ghost', size: 'sm', onClick: bridge.window.minimize }),
        button({ icon: 'close', label: 'Close', variant: 'ghost', size: 'sm', class: 'btn-close', onClick: bridge.window.close }),
      )
    : null
  const header = h(
    'header',
    { class: 'app-header' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon32.png', alt: '', width: 18, height: 18 }), h('span', { text: 'yoinks' })),
    nav,
    windowControls,
  )
  const banner = h('div', { class: 'banner', role: 'alert', hidden: true })
  const main = h('main', { class: 'app-main', id: 'main' })
  document.body.append(header, banner, main)

  // ---------- routing ----------

  function needsTerms(view) {
    return view?.ready && view.settings.termsAccepted < view.termsVersion
  }

  function go(name) {
    if (!views[name]) name = 'home'
    // Until the terms are accepted only the legal pages are reachable.
    if (needsTerms(lastView) && name !== 'terms' && name !== 'privacy') name = 'terms'
    if (current === name) return
    current = name
    main.replaceChildren(views[name].el)
    navButtons.forEach(b => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'))
    if (lastView) views[name].render(lastView)
    views[name].focus?.()
    main.scrollTop = 0
  }

  // ---------- state ----------

  bridge.onState(view => {
    const firstTerms = needsTerms(lastView)
    lastView = view

    const look = `${view.settings.theme}|${view.settings.accent}|${view.settings.customAccent}`
    if (look !== lastLook) {
      lastLook = look
      root.YoinksTheme.apply(view.settings)
    }

    const locked = needsTerms(view)
    nav.hidden = Boolean(locked)
    if (locked && current !== 'terms' && current !== 'privacy') go('terms')
    else if (firstTerms && !locked) go(bridge.initialView === 'settings' ? 'settings' : 'home')

    banner.hidden = !view.hostProblem
    banner.replaceChildren(icon('alert', { size: 16 }), h('span', { text: view.hostProblem ?? '' }))

    views[current]?.render(view)
    root.YoinksToast.sync(view.toasts)
  })

  // ---------- keyboard ----------

  document.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      go('home')
      lookup.focus()
    } else if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      go('batch')
    } else if (mod && event.key === ',') {
      event.preventDefault()
      go('settings')
    } else if (event.key === 'Escape' && !event.defaultPrevented) {
      if (current !== 'home') go('home')
      else if (lastView?.lookup) bridge.send({ type: 'closeLookup' })
    }
  })

  go(bridge.initialView ?? 'home')
})(typeof self !== 'undefined' ? self : this)
