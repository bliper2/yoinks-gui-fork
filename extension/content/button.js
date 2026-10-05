/*
 * The in-page "Yoink" button: a split button (main action + ▾ menu) that
 * lives in a shadow root so site CSS can't break it. It copies the look of a
 * neighbouring native button (height, radius, colors, font) so it blends
 * into YouTube, SoundCloud, Bandcamp, … in light and dark themes.
 *
 * States: idle · loading · queued · downloading (progress ring) · paused ·
 * done · error. Site placement lives in content/mounts.js.
 */
;(function (root) {
  'use strict'

  const SVG = 'http://www.w3.org/2000/svg'
  const RING = 2 * Math.PI * 9 // circumference for r=9

  const CSS = `
    :host { all: initial; display: inline-flex; vertical-align: middle; position: relative;
      --h: var(--n-h, 36px); --radius: var(--n-radius, 18px); --bg: var(--n-bg, rgba(127,127,127,.18));
      --fg: var(--n-color, currentColor); --font: var(--n-font, system-ui, sans-serif); --size: var(--n-size, 14px);
      --weight: var(--n-weight, 500); --accent: #8b6bff; --accent-2: #22d3ee; }
    * { box-sizing: border-box; }
    .wrap { display: inline-flex; align-items: stretch; height: var(--h); border-radius: var(--radius);
      background: var(--bg); color: var(--fg); font: var(--weight) var(--size)/1 var(--font); }
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; cursor: pointer; color: inherit; font: inherit; height: 100%; border-radius: var(--radius); }
    button:hover { background-image: linear-gradient(rgba(127,127,127,.18), rgba(127,127,127,.18)); }
    :host(:focus), :host(:focus-within), .wrap:focus { outline: none; }
    button:focus { outline: none; }
    button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
    button:disabled { cursor: default; opacity: .6; }
    .main { padding: 0 12px 0 10px; border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .caret { width: 28px; border-top-left-radius: 0; border-bottom-left-radius: 0;
      border-left: 1px solid rgba(127,127,127,.35); }
    .caret svg { width: 10px; height: 10px; fill: currentColor; }
    .glyph { position: relative; width: 20px; height: 20px; display: inline-grid; place-items: center; flex: none; }
    .glyph svg { position: absolute; inset: 0; width: 20px; height: 20px; }
    .logo rect { fill: url(#g); }
    .ring-track { fill: none; stroke: rgba(127,127,127,.35); stroke-width: 2.5; }
    .ring-fill { fill: none; stroke: url(#g); stroke-width: 2.5; stroke-linecap: round;
      transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .3s ease; }
    .spin { animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
    .label { white-space: nowrap; }
    [data-state=done] .glyph { color: #2fb47c; }
    [data-state=error] .glyph { color: #e5484d; }

    /* variants */
    /* icon: a round icon button like the player's own (e.g. 👍 👎), plus a slim ▾ */
    :host([data-variant=icon]) .label { display: none; }
    :host([data-variant=icon]) .wrap { background: transparent; border-radius: 0; align-items: center; }
    :host([data-variant=icon]) .main { width: var(--h); height: var(--h); padding: 0; border-radius: 50%; }
    :host([data-variant=icon]) .caret { width: 16px; height: 28px; margin-left: -6px; border: 0; border-radius: 8px; opacity: .65; }
    :host([data-variant=icon]) .caret:hover { opacity: 1; }
    :host([data-variant=icon]) button:hover { background-image: none; background-color: rgba(255,255,255,.1); }
    :host([data-variant=icon]) .glyph, :host([data-variant=icon]) .glyph svg { width: 24px; height: 24px; }
    /* action: a feed's side column (TikTok): circle with the label under it, ▾ as a badge */
    :host([data-variant=action]) { display: flex; justify-content: center; width: 48px; padding-top: 8px; }
    :host([data-variant=action]) .wrap { position: relative; flex-direction: column; align-items: center; height: auto; background: transparent; border-radius: 0; }
    :host([data-variant=action]) .main { flex-direction: column; gap: 4px; padding: 0; height: auto; border-radius: 0; }
    :host([data-variant=action]) .main:hover { background-image: none; }
    :host([data-variant=action]) .glyph { width: 48px; height: 48px; border-radius: 50%; background: var(--bg); transition: filter .15s ease; }
    :host([data-variant=action]) .main:hover .glyph { filter: brightness(1.35); }
    :host([data-variant=action]) .glyph svg { inset: 12px; width: 24px; height: 24px; }
    :host([data-variant=action]) .label { font-size: 12px; font-weight: 700; line-height: 16px; opacity: .8; }
    :host([data-variant=action]) .caret { position: absolute; top: -2px; right: -8px; width: 20px; height: 20px; border: 0;
      border-radius: 50%; background: rgba(22,24,35,.8); color: #fff; }
    :host([data-variant=action]) .caret svg { width: 8px; height: 8px; }
    :host([data-variant=text]) .wrap { background: transparent; height: auto; }
    :host([data-variant=text]) .main { padding: 2px 4px 2px 0; text-decoration: underline; text-underline-offset: 2px; }
    :host([data-variant=text]) .caret { border-left: 0; width: 18px; }
    :host([data-variant=floating]) { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; }
    :host([data-variant=floating]) .wrap { --h: 44px; --radius: 22px; background: linear-gradient(120deg, var(--accent), var(--accent-2));
      color: #0a0d13; font: 700 14px/1 'Segoe UI', system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
    :host([data-variant=floating]) .ring-track { stroke: rgba(10,13,19,.25); }
    :host([data-variant=floating]) .ring-fill { stroke: #0a0d13; }
    :host([data-variant=floating]) .logo rect { fill: #0a0d13; }

    /* menu */
    /* fixed + placed by placeMenu(): sites clip or scroll their button rows */
    .menu { position: fixed; top: 0; left: 0; min-width: 210px; padding: 6px;
      background: #1c1f28; color: #e8edf4; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,.4); font: 400 13px/1.3 'Segoe UI', system-ui, sans-serif; z-index: 2147483001; }
    .menu[hidden] { display: none; }
    .item { display: flex; width: 100%; justify-content: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; height: auto; }
    .item:hover, .item:focus-visible { background: rgba(255,255,255,.08); background-image: none; outline: none; }
    .item small { margin-left: auto; color: #8f99ab; }
    .sep { height: 1px; margin: 4px 6px; background: rgba(255,255,255,.1); }
    .clip { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 8px 4px; }
    .clip label { display: grid; gap: 4px; color: #8f99ab; font-size: 11px; }
    .clip input { all: unset; box-sizing: border-box; height: 30px; padding: 0 8px; border-radius: 6px; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.14); color: #e8edf4; font: 12px Consolas, monospace; }
    .clip input:focus { border-color: var(--accent); }
    .clip .go { grid-column: 1 / -1; height: 32px; margin-top: 2px; border-radius: 8px; font-weight: 600;
      background: linear-gradient(120deg, var(--accent), var(--accent-2)); color: #0a0d13; }
    .clip .err { grid-column: 1 / -1; color: #ff8a8e; font-size: 11px; min-height: 0; }
  `

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') node.textContent = value
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
      else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value)
    }
    node.append(...children)
    return node
  }

  function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG, tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    node.append(...children)
    return node
  }

  function gradientDefs() {
    return svg('defs', {}, [
      svg('linearGradient', { id: 'g', x1: '0', y1: '0', x2: '1', y2: '1' }, [
        svg('stop', { offset: '0', 'stop-color': 'var(--accent)' }),
        svg('stop', { offset: '1', 'stop-color': 'var(--accent-2)' }),
      ]),
    ])
  }

  // The Yoinks mark (docs/logo.svg): a Y that becomes an arrow into a tray.
  function logo() {
    return svg('svg', { viewBox: '0 0 256 256', class: 'logo', 'aria-hidden': 'true' }, [
      gradientDefs(),
      svg('rect', { x: 8, y: 8, width: 240, height: 240, rx: 60 }),
      ...['M76 58 L128 112 L180 58', 'M128 112 V172', 'M100 146 L128 174 L156 146', 'M68 170 V190 Q68 204 82 204 H174 Q188 204 188 190 V170'].map(d =>
        svg('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 24, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      ),
    ])
  }

  function ring(fraction) {
    return svg('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, [
      gradientDefs(),
      svg('circle', { class: 'ring-track', cx: 10, cy: 10, r: 9 }),
      svg('circle', { class: 'ring-fill', cx: 10, cy: 10, r: 9, 'stroke-dasharray': RING, 'stroke-dashoffset': RING * (1 - fraction) }),
    ])
  }

  function spinner() {
    return svg('svg', { viewBox: '0 0 20 20', class: 'spin', 'aria-hidden': 'true' }, [
      gradientDefs(),
      svg('circle', { class: 'ring-track', cx: 10, cy: 10, r: 9 }),
      svg('circle', { class: 'ring-fill', cx: 10, cy: 10, r: 9, 'stroke-dasharray': RING, 'stroke-dashoffset': RING * 0.7 }),
    ])
  }

  function mark(pathD) {
    return svg('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, [
      svg('path', { d: pathD, fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ])
  }

  function formatTime(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return ''
    const s = Math.floor(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
  }

  function parseTime(text) {
    const t = String(text ?? '').trim()
    if (!t) return null
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN
    return t.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  }

  /** Copy the look of a native site button onto the host element. */
  function copyNativeStyle(host, native) {
    if (!native) return
    const cs = getComputedStyle(native)
    const set = (name, value) => value && host.style.setProperty(name, value)
    // Rendered height (includes padding); 0 when the site hides it for now.
    const height = native.getBoundingClientRect().height || parseFloat(cs.height) || 0
    set('--n-h', height >= 20 ? `${Math.round(height)}px` : '')
    // One corner only: the neighbour may be half of a joined pair
    // (YouTube's like/dislike is "20px 0 0 20px").
    set('--n-radius', cs.borderTopLeftRadius)
    set('--n-bg', cs.backgroundColor)
    set('--n-color', cs.color)
    set('--n-font', cs.fontFamily)
    set('--n-size', cs.fontSize)
    set('--n-weight', cs.fontWeight)
  }

  /**
   * @param {object} options
   * @param {'pill'|'icon'|'text'|'floating'} options.variant
   * @param {() => string} options.getUrl      link of the media on this page
   * @param {() => number|null} options.getTime  playback position (clip default)
   * @param {boolean} options.music            default to audio
   * @param {boolean} options.spotify          always review matches first
   * @param {boolean} options.playlist         the link is a whole playlist
   * @param {boolean} options.menuUp           open the menu upwards
   * @param {boolean} options.menuLeft         open the menu to the left (side columns)
   */
  function create({ variant = 'pill', getUrl, getTime = () => null, music = false, spotify = false, playlist = false, menuUp = false, menuLeft = false }) {
    const host = el('yoinks-button', { 'data-variant': variant })
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    shadow.adoptedStyleSheets = [sheet]

    const glyph = el('span', { class: 'glyph' })
    const label = el('span', { class: 'label' })
    const main = el('button', { class: 'main', type: 'button' }, [glyph, label])
    const caret = el('button', { class: 'caret', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'More download options', title: 'More options' }, [
      svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, [svg('path', { d: 'M1 3l4 4 4-4z' })]),
    ])
    const wrap = el('div', { class: 'wrap', 'data-state': 'idle' }, [main, caret])
    shadow.append(wrap)

    // The menu lives in its own overlay on <html>, not inside the button: sites
    // such as YouTube Music put the button in a bar with transforms or clipping,
    // which would hide or misplace a menu that is a child of it.
    const menu = el('div', { class: 'menu', role: 'menu', hidden: true })
    const overlay = el('yoinks-menu')
    overlay.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483001;'
    const overlayShadow = overlay.attachShadow({ mode: 'closed' })
    overlayShadow.adoptedStyleSheets = [sheet]
    overlayShadow.append(menu)

    let state = { phase: 'idle' }
    let resetTimer = null

    // ---------- actions ----------

    function send(message) {
      try {
        chrome.runtime.sendMessage(message).catch(() => {})
        return true
      } catch {
        // The extension was reloaded; this copy of the script is cut off.
        setState({ phase: 'error', error: 'Yoinks was updated. Reload this page.' })
        return false
      }
    }

    function quick(format, clip = null) {
      closeMenu()
      if (send({ type: 'page:quick', url: getUrl(), format, clip })) setState({ phase: 'loading' })
    }

    function choose(playlist = false) {
      closeMenu()
      if (send({ type: 'page:choose', url: getUrl(), playlist })) setState({ phase: 'loading', text: 'Opening…' })
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => state.phase === 'loading' && state.text && setState({ phase: 'idle' }), 3000)
    }

    main.addEventListener('click', () => {
      if (!['error', 'done', 'idle'].includes(state.phase)) return
      // Spotify always shows the YouTube Music matches before downloading.
      if (spotify) choose(false)
      else quick(music ? 'audio' : 'default')
    })

    // ---------- menu ----------

    function menuItems() {
      const url = getUrl()
      const S = root.YoinksSites
      if (spotify) {
        return [el('button', { class: 'item', role: 'menuitem', type: 'button', onclick: () => choose(false) }, [el('span', { text: 'Find on YouTube Music…' }), el('small', { text: 'opens Yoinks' })])]
      }
      const items = music
        ? [['audio', 'Audio', 'MP3 / your format'], ['best', 'Best video', '']]
        : [['best', 'Best video', ''], ['1080', '1080p', ''], ['720', '720p', ''], ['audio', 'MP3', 'audio only']]
      const nodes = items.map(([format, text, hint]) =>
        el('button', { class: 'item', role: 'menuitem', type: 'button', onclick: () => quick(format) }, [el('span', { text }), hint ? el('small', { text: hint }) : '']),
      )
      // A playlist button already downloads the whole list; clips make no sense.
      if (!playlist) nodes.push(el('button', { class: 'item', role: 'menuitem', type: 'button', onclick: showClip }, [el('span', { text: 'Clip…' }), el('small', { text: 'part of it' })]))
      if (!playlist && (S?.hasPlaylistParam(url) || S?.isPlaylistLink(url))) {
        nodes.push(el('button', { class: 'item', role: 'menuitem', type: 'button', onclick: () => quick('playlist') }, [el('span', { text: 'Whole playlist' })]))
      }
      nodes.push(el('div', { class: 'sep', role: 'separator' }))
      nodes.push(el('button', { class: 'item', role: 'menuitem', type: 'button', onclick: () => choose(false) }, [el('span', { text: 'Choose format…' }), el('small', { text: 'opens Yoinks' })]))
      return nodes
    }

    function showClip() {
      const now = getTime()
      const start = el('input', { type: 'text', inputmode: 'numeric', value: now ? formatTime(now) : '', placeholder: '0:00', 'aria-label': 'Clip start' })
      const end = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'end', 'aria-label': 'Clip end' })
      const error = el('div', { class: 'err', role: 'alert' })
      const go = el('button', { class: 'go', type: 'submit', text: 'Yoink clip' })
      const form = el('form', { class: 'clip' }, [el('label', {}, ['From', start]), el('label', {}, ['To', end]), error, go])
      form.addEventListener('submit', event => {
        event.preventDefault()
        const s = parseTime(start.value) ?? 0
        const e = parseTime(end.value)
        if (Number.isNaN(s) || Number.isNaN(e)) return (error.textContent = 'Use times like 1:05 or 65.')
        if (e !== null && e <= s) return (error.textContent = 'The end must be after the start.')
        quick('clip', { start: s, end: e })
      })
      menu.replaceChildren(form)
      placeMenu()
      end.focus({ preventScroll: true })
    }

    // Next to the button in viewport coordinates: below and right-aligned,
    // above when asked or when there is no room below, or to the left for
    // side columns; always kept inside the window.
    function placeMenu() {
      const anchor = wrap.getBoundingClientRect()
      const { width, height } = menu.getBoundingClientRect()
      const gap = 6
      let left = menuLeft ? anchor.left - 12 - width : anchor.right - width
      let top = menuLeft ? anchor.top : anchor.bottom + gap
      if (!menuLeft && (menuUp || top + height > innerHeight - 8) && anchor.top - gap - height >= 8) top = anchor.top - gap - height
      left = Math.min(Math.max(8, left), innerWidth - width - 8)
      top = Math.min(Math.max(8, top), innerHeight - height - 8)
      menu.style.left = `${Math.round(left)}px`
      menu.style.top = `${Math.round(top)}px`
    }

    function openMenu() {
      menu.replaceChildren(...menuItems())
      document.documentElement.append(overlay)
      menu.hidden = false
      placeMenu()
      caret.setAttribute('aria-expanded', 'true')
      menu.querySelector('.item')?.focus({ preventScroll: true })
      document.addEventListener('pointerdown', outside, true)
      addEventListener('scroll', placeMenu, true)
      addEventListener('resize', placeMenu)
    }

    function closeMenu() {
      menu.hidden = true
      overlay.remove()
      caret.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true)
      removeEventListener('scroll', placeMenu, true)
      removeEventListener('resize', placeMenu)
    }

    function outside(event) {
      const path = event.composedPath()
      if (!path.includes(host) && !path.includes(overlay)) closeMenu()
    }

    caret.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()))
    function menuKeys(event) {
      if (event.key === 'Escape' && !menu.hidden) {
        closeMenu()
        caret.focus()
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !menu.hidden) {
        const items = [...menu.querySelectorAll('.item')]
        const i = items.indexOf(overlayShadow.activeElement)
        items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true })
        event.preventDefault()
      }
    }
    wrap.addEventListener('keydown', menuKeys)
    menu.addEventListener('keydown', menuKeys)

    // ---------- state ----------

    function setState(next) {
      state = next
      clearTimeout(resetTimer)
      const phase = next.phase
      wrap.dataset.state = phase
      main.disabled = ['loading', 'queued', 'downloading', 'paused'].includes(phase)
      let text = playlist ? 'Yoink all' : 'Yoink'
      let title = spotify
        ? 'Find this on YouTube Music and download it with Yoinks'
        : playlist
          ? 'Download the whole playlist with Yoinks (into its own folder)'
          : music
            ? 'Download the audio with Yoinks'
            : 'Download with Yoinks'
      if (phase === 'loading') {
        glyph.replaceChildren(spinner())
        text = next.text ?? 'Adding…'
      } else if (phase === 'queued' || phase === 'probing') {
        glyph.replaceChildren(spinner())
        text = 'Queued'
      } else if (phase === 'downloading') {
        const pct = next.percent
        glyph.replaceChildren(ring(pct == null ? 0.05 : pct / 100))
        text = pct == null ? 'Starting…' : `${pct}%`
      } else if (phase === 'paused') {
        glyph.replaceChildren(ring((next.percent ?? 0) / 100))
        text = 'Paused'
      } else if (phase === 'done') {
        glyph.replaceChildren(mark('M4 10.5l4 4L16 6'))
        text = 'Done'
        title = 'Saved. Click to download again.'
        resetTimer = setTimeout(() => setState({ phase: 'idle' }), 6000)
      } else if (phase === 'error') {
        glyph.replaceChildren(mark('M10 5v6M10 14.5v.5'))
        text = 'Failed'
        title = `${next.error ?? 'Download failed.'} Click to try again.`
      } else {
        glyph.replaceChildren(logo())
      }
      label.textContent = text
      main.title = title
      main.setAttribute('aria-label', `${text}. ${title}`)
    }

    setState({ phase: 'idle' })

    return {
      host,
      setState,
      copyStyle: native => copyNativeStyle(host, native),
      /** Apply a job update from the background worker. */
      update(job) {
        const map = { probing: 'queued', queued: 'queued', review: 'queued', downloading: 'downloading', paused: 'paused', failed: 'error', done: 'done', removed: 'idle' }
        if (job.phase === 'removed' && state.phase === 'done') return
        setState({ phase: map[job.phase] ?? 'idle', percent: job.percent, error: job.error })
      },
      get phase() {
        return state.phase
      },
    }
  }

  root.YoinksPageButton = { create, formatTime }
})(typeof self !== 'undefined' ? self : this)
