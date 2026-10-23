'use strict'

// Download progress outside the window: the bar on the taskbar (Windows) or
// launcher (Linux desktops that show one), and the optional tray icon from
// Settings, "Keep Yoinks running in the tray when the window is closed".
// Fed the controller's view on every state change.

const { app, Tray, Menu, nativeImage } = require('electron')

const { percentOf } = require('../extension/shared/controller.js')

/** { fraction: 0..1 | null (unknown), active, waiting } for the taskbar and the tray tooltip. */
function summarize(queue) {
  const active = queue.filter(job => job.phase === 'downloading')
  const waiting = queue.filter(job => job.phase === 'queued' || job.phase === 'probing').length
  const known = active.map(percentOf).filter(p => p !== null)
  const fraction = active.length && known.length === active.length ? known.reduce((a, b) => a + b, 0) / known.length / 100 : null
  return { fraction, active: active.length, waiting }
}

function tooltipOf({ fraction, active, waiting }) {
  if (!active) return waiting ? `Yoinks: ${waiting} waiting` : 'Yoinks'
  const percent = fraction === null ? '' : `, ${Math.round(fraction * 100)}%`
  return `Yoinks: ${active} downloading${percent}${waiting ? `, ${waiting} waiting` : ''}`
}

/**
 * @param {object} p
 * @param {() => Electron.BrowserWindow | null} p.getWindow
 * @param {string} p.iconPath
 * @param {() => void} p.onShow           bring the window back
 * @param {(type: string) => void} p.onCommand  controller command (pauseAll / resumeAll)
 * @param {() => void} p.onQuit           quit for real (asks first when downloads run)
 */
function create({ getWindow, iconPath, onShow, onCommand, onQuit }) {
  let tray = null
  let lastTip = null
  let lastMenuKey = null
  let lastBar = null

  function setBar(summary) {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    // Above 1 means "busy, amount unknown" (an indeterminate bar on Windows).
    const value = summary.active ? (summary.fraction ?? 2) : -1
    const key = value === 2 ? 'busy' : Math.round(value * 100)
    if (key === lastBar) return
    lastBar = key
    win.setProgressBar(value)
  }

  function ensureTray() {
    if (tray) return
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
    tray.on('click', onShow) // Windows; Linux opens the menu instead
    lastTip = null
    lastMenuKey = null
  }

  function dropTray() {
    tray?.destroy()
    tray = null
  }

  function updateTray(summary, queue) {
    const tip = tooltipOf(summary)
    if (tip !== lastTip) {
      lastTip = tip
      tray.setToolTip(tip)
    }
    const canPause = queue.some(job => job.phase === 'downloading' || job.phase === 'queued')
    const canResume = queue.some(job => job.phase === 'paused')
    const menuKey = `${tip}|${canPause}|${canResume}`
    if (menuKey === lastMenuKey) return
    lastMenuKey = menuKey
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: tip, enabled: false },
        { type: 'separator' },
        { label: 'Show Yoinks', click: onShow },
        { label: 'Pause all', enabled: canPause, click: () => onCommand('pauseAll') },
        { label: 'Resume all', enabled: canResume, click: () => onCommand('resumeAll') },
        { type: 'separator' },
        { label: 'Quit Yoinks', click: onQuit },
      ]),
    )
  }

  return {
    update(view) {
      const summary = summarize(view.queue)
      setBar(summary)
      if (!app.isReady()) return // the first state arrives before Electron can make a tray
      if (view.settings.closeToTray) {
        ensureTray()
        updateTray(summary, view.queue)
      } else dropTray()
    },
    get active() {
      return Boolean(tray)
    },
    destroy: dropTray,
  }
}

module.exports = { create, summarize, tooltipOf }
