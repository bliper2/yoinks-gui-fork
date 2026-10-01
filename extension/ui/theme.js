/*
 * Applies the saved style, theme (light / dark / system) and accent color to the
 * page instantly. Used by the popup, settings page and desktop app.
 * The last applied look is kept in localStorage so the next page load
 * paints in the right colors before settings arrive.
 */
;(function (root) {
  'use strict'

  // [main, gradient end]
  const PRESETS = {
    violet: ['#8b6bff', '#22d3ee'],
    ocean: ['#2f80ed', '#22d3ee'],
    sunset: ['#ff6a4d', '#ffb03a'],
    forest: ['#1fbf6a', '#a3d93a'],
    rose: ['#f0457a', '#d16bff'],
  }
  const CACHE_KEY = 'yoinks-look'
  const media = root.matchMedia?.('(prefers-color-scheme: light)')
  let current = null

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
  }

  // Rotate hue to get a pleasant second gradient stop for a custom color.
  function shiftHue(hex, degrees) {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    let h = 0
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
    }
    h = (h * 60 + degrees + 360) % 360
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l - c / 2
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255)
  }

  // Dark text on light accents, white on dark ones (WCAG luminance).
  function onColor(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminance > 0.3 ? '#0a0d13' : '#ffffff'
  }

  function accentPair(settings) {
    if (settings.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(settings.customAccent ?? '')) {
      return [settings.customAccent, shiftHue(settings.customAccent, 40)]
    }
    return PRESETS[settings.accent] ?? PRESETS.violet
  }

  function resolvedTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme
    return media?.matches ? 'light' : 'dark'
  }

  /** Apply { style, theme, accent, customAccent } to this document. */
  function apply(settings) {
    if (!settings) return
    current = { style: settings.style ?? 'clean', theme: settings.theme ?? 'system', accent: settings.accent ?? 'violet', customAccent: settings.customAccent }
    const [a, b] = accentPair(current)
    const el = document.documentElement
    el.dataset.theme = resolvedTheme(current.theme)
    el.dataset.style = current.style
    el.style.setProperty('--accent', a)
    el.style.setProperty('--accent-2', b)
    el.style.setProperty('--on-accent', onColor(a))
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(current))
    } catch {
      // storage blocked: fine, the next load just paints default first
    }
  }

  // "System" follows the OS live.
  media?.addEventListener?.('change', () => current?.theme === 'system' && apply(current))

  // Paint from the last look straight away.
  try {
    apply(JSON.parse(localStorage.getItem(CACHE_KEY)))
  } catch {
    // nothing cached yet
  }

  root.YoinksTheme = { PRESETS, apply, accentPair }
})(typeof self !== 'undefined' ? self : this)
