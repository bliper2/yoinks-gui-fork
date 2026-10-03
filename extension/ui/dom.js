/*
 * Small DOM + formatting helpers and the icon set for the Yoinks UI
 * (popup, settings page, desktop app). No framework; no innerHTML with data.
 */
;(function (root) {
  'use strict'

  const SVG_NS = 'http://www.w3.org/2000/svg'

  // 24×24 stroke icons.
  const ICONS = {
    download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14',
    folder: 'M3.5 6.5h6l1.8 2H20.5v10h-17z',
    play: 'M8 5.5v13l10.5-6.5z',
    pause: 'M8 5.5v13M16 5.5v13',
    retry: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
    close: 'M6 6l12 12M18 6L6 18',
    settings: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7 7 0 0 1-1.7 1l-.4 2h-3.6l-.4-2a7 7 0 0 1-1.7-1l-1.9.6L5.8 14.7l1.6-1.2a7 7 0 0 1 0-2L5.8 10.3 7.6 7.2l1.9.6a7 7 0 0 1 1.7-1l.4-2h3.6l.4 2a7 7 0 0 1 1.7 1l1.9-.6 1.8 3.1-1.6 1.2a7 7 0 0 1 0 2z',
    list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.5M4.5 12h.5M4.5 17.5h.5',
    home: 'M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    alert: 'M12 7.5v6M12 16.5v.5M12 3.5l9.5 16.5h-19z',
    info: 'M12 11v5.5M12 7.5v.5M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 6l-6 6 6 6',
    music: 'M9 17.5V6l10-2v11.5M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    film: 'M4 5.5h16v13H4zM8 5.5v13M16 5.5v13M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4',
    trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7',
    upload: 'M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19h14',
    external: 'M13.5 4.5H19.5V10.5M19.5 4.5L11 13M17 14v5.5H4.5V7H10',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
    moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
    monitor: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
    scissors: 'M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 8l11 9M8.5 16l11-9',
    minimize: 'M5 12h14',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    file: 'M6 3.5h8l4 4v13H6zM14 3.5v4h4',
    skip: 'M6 6l7 6-7 6zM16 6v12',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L21 21',
    copy: 'M9 9h11v11H9zM5 15V4h10',
    health: 'M4 12h4l2-5 4 10 2-5h4',
    swap: 'M4 8h13l-3-3.5M20 16H7l3 3.5',
  }

  function icon(name, { size = 18, label } = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    svg.setAttribute('class', `icon icon-${name}`)
    if (label) {
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', label)
    } else svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', ICONS[name] ?? '')
    svg.append(path)
    return svg
  }

  /**
   * h('button', { class: 'btn', onclick, disabled: true }, 'text', child…)
   * Attributes: class, text, style (object), dataset (object), on* handlers,
   * aria-*, and plain attributes. false/null/undefined are skipped.
   */
  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === false || value == null) continue
      if (key === 'text') node.textContent = value
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
      else if (key === 'dataset') Object.assign(node.dataset, value)
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
      else if (key in node && typeof value !== 'string') node[key] = value
      else node.setAttribute(key, value === true ? '' : value)
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue
      node.append(child instanceof Node ? child : String(child))
    }
    return node
  }

  /** A button with an icon and (optionally visible) text; always labelled. */
  function button({ icon: iconName, text, label, variant = 'secondary', size, onClick, disabled, type = 'button', ...rest }) {
    const iconOnly = !text
    return h(
      'button',
      {
        type,
        class: ['btn', `btn-${variant}`, size && `btn-${size}`, iconOnly && 'btn-icon', rest.class].filter(Boolean).join(' '),
        title: label ?? rest.title ?? null,
        'aria-label': iconOnly ? (label ?? text) : null,
        disabled,
        onclick: onClick,
        ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'class' && k !== 'title')),
      },
      iconName ? icon(iconName) : null,
      text ? h('span', { text }) : null,
    )
  }

  // ---------- formatting ----------

  function formatDuration(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return null
    const s = Math.round(seconds)
    const hrs = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, '0')
    return hrs > 0 ? `${hrs}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit++
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
  }

  function shortenPath(p) {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean)
    return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : p || 'Downloads'
  }

  function filenameOf(p) {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? ''
  }

  // "1:05", "1:02:03", "65" or "65.5" -> seconds; blank -> null; junk -> NaN.
  function parseTime(text) {
    const t = String(text ?? '').trim()
    if (!t) return null
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN
    return t.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  }

  function timeAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`
    return new Date(ms).toLocaleDateString()
  }

  // ---------- support helpers ----------

  /** Copy text to the clipboard (works in popups, tabs and the desktop window). */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    }
  }

  /**
   * A short report to paste into Discord or a GitHub issue. Only what is
   * needed to find the problem: versions, the link and the error. No settings,
   * no file names, no cookies.
   */
  function debugReport({ bridge, view, job }) {
    const where = bridge.platform === 'desktop' ? 'Windows app' : 'browser extension'
    return [
      `Yoinks ${bridge.version ?? '?'} (${where})`,
      `yt-dlp: ${view?.ytdlp?.version ?? 'unknown'}`,
      `Link: ${job?.url ?? '-'}`,
      `Error: ${job?.error?.code ?? 'unknown'} - ${job?.error?.message ?? 'no message'}`,
      job?.error?.detail ? `Details: ${job.error.detail}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }

  root.YoinksDom = { h, icon, button, formatDuration, formatBytes, shortenPath, filenameOf, parseTime, timeAgo, copyText, debugReport }
})(typeof self !== 'undefined' ? self : this)
