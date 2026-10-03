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
    changelog: Views.legal.create(ctx, 'changelog'),
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
  // Navigation in the header, or as a floating pill at the bottom. It moves
  // out of the header then, because the header's blur would pin a fixed
  // element to the header instead of the window.
  function placeNav(where) {
    const bottom = where === 'bottom'
    if (bottom === nav.classList.contains('nav-floating')) return
    nav.classList.toggle('nav-floating', bottom)
    document.body.classList.toggle('nav-bottom', bottom)
    if (bottom) document.body.append(nav)
    else header.insertBefore(nav, windowControls)
  }

  const banner = h('div', { class: 'banner', role: 'alert', hidden: true })

  // "Yoinks was updated": shown once per version, with a link to what changed.
  const whatsNew = h('div', { class: 'banner banner-info', role: 'status', hidden: true })
  let whatsNewHandled = false
  function markSeen() {
    whatsNew.hidden = true
    bridge.send({ type: 'settings:set', patch: { lastSeenVersion: bridge.version } })
  }
  function checkWhatsNew(view, locked) {
    if (whatsNewHandled || !view.ready || locked || !bridge.version) return
    const seen = view.settings.lastSeenVersion
    if (seen === bridge.version) return (whatsNewHandled = true)
    whatsNewHandled = true
    if (!seen) return markSeen() // a fresh install has nothing "new"
    whatsNew.replaceChildren(
      icon('info', { size: 16 }),
      h('span', { text: `Yoinks was updated to ${bridge.version}.` }),
      button({ text: "See what's new", variant: 'link', onClick: () => (markSeen(), go('changelog')) }),
      button({ icon: 'close', label: 'Dismiss', variant: 'ghost', size: 'sm', onClick: markSeen }),
    )
    whatsNew.hidden = false
  }
  const main = h('main', { class: 'app-main', id: 'main' })
  document.body.append(header, banner, whatsNew, main)

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

    const look = `${view.settings.style}|${view.settings.theme}|${view.settings.accent}|${view.settings.customAccent}`
    if (look !== lastLook) {
      lastLook = look
      root.YoinksTheme.apply(view.settings)
    }
    placeNav(view.settings.navBar)

    const locked = needsTerms(view)
    nav.hidden = Boolean(locked)
    if (locked && current !== 'terms' && current !== 'privacy') go('terms')
    else if (firstTerms && !locked) go(bridge.initialView === 'settings' ? 'settings' : 'home')

    checkWhatsNew(view, locked)
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

  // ---------- drop a link (or files to convert) anywhere ----------

  const hasDrop = event => [...(event.dataTransfer?.types ?? [])].some(type => ['Files', 'text/uri-list', 'text/plain'].includes(type))
  document.addEventListener('dragover', event => hasDrop(event) && event.preventDefault())
  document.addEventListener('drop', event => {
    if (!hasDrop(event) || needsTerms(lastView) || event.target.closest?.('textarea')) return
    event.preventDefault()
    const files = [...(event.dataTransfer.files ?? [])]
    if (files.length) {
      if (bridge.pathOf) views.batch.addFiles(files)
      else bridge.send({ type: 'toast', kind: 'error', text: 'Drop links here. File conversion is in the Yoinks desktop app.' })
      return
    }
    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
    const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? []
    if (!links.length) return
    go('home')
    if (links.length > 1) bridge.send({ type: 'batch', text })
    else bridge.send({ type: 'lookup', url: links[0] })
  })

  // The desktop app offers a link you copied (setting "Offer links I copy").
  bridge.onClipboard?.(url => current === 'home' && lookup.prefill(url))

  go(bridge.initialView ?? 'home')
})(typeof self !== 'undefined' ? self : this)
