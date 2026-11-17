'use strict'

// The Windows portable exe unpacks Yoinks to a new temporary folder on every
// start and deletes it on exit. Two things break because of that:
//  - Shortcuts that Windows made from the running window (pinned to Start,
//    "Create shortcut") point into that folder and stop working.
//  - Browsers need a helper that is still there when Yoinks is closed.
// So on every start the portable app repairs its shortcuts, and keeps a
// lasting copy of itself for the helper in %LOCALAPPDATA%\Yoinks: one per
// version (hard links when possible, so no extra space), plus the browser
// extension in a folder whose path never changes.

const { app, shell } = require('electron')
// Electron's fs reads app.asar as a folder; this one copies it as the file it is.
const ofs = require('original-fs')
const os = require('node:os')
const path = require('node:path')

const APP_ID = 'com.mrkraps.yoinks-gui'
const COMPLETE = '.yoinks-complete'

const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || null
const isPortable = () => process.platform === 'win32' && Boolean(portableExe())

function home() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Yoinks')
}

/** Where the lasting copy for this version lives, and the stable extension folder. */
function locations(version = app.getVersion()) {
  const base = home()
  const runtime = path.join(base, 'runtime', version)
  return {
    base,
    runtime,
    exe: path.join(runtime, 'Yoinks.exe'),
    hostJs: path.join(runtime, 'resources', 'app.asar', 'host', 'host.js'),
    extensionDir: path.join(base, 'extension'),
  }
}

// ---------- shortcuts ----------

/** Shortcut files Windows or the user may have made for Yoinks. */
function shortcutCandidates() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const names = ['Yoinks.lnk', 'Yoinks.exe.lnk', 'Yoinks - Shortcut.lnk']
  const dirs = [
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'StartMenu'),
  ]
  return dirs.flatMap(dir => names.map(name => path.join(dir, name)))
}

const inside = (child, parent) => {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase())
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * A shortcut needs fixing when it starts Yoinks.exe from a temporary folder,
 * or from a folder that is gone. Shortcuts to anything else are left alone.
 */
function needsRepair(target, { tmp = os.tmpdir(), exists = p => ofs.existsSync(p) } = {}) {
  if (!target || path.basename(target).toLowerCase() !== 'yoinks.exe') return false
  return inside(target, tmp) || !exists(target)
}

/** Point broken Yoinks shortcuts at the portable exe. Returns the fixed paths. */
function repairShortcuts() {
  const exe = portableExe()
  if (!isPortable() || !exe) return []
  const fixed = []
  for (const file of shortcutCandidates()) {
    if (!ofs.existsSync(file)) continue
    let link
    try {
      link = shell.readShortcutLink(file)
    } catch {
      continue
    }
    if (!needsRepair(link.target)) continue
    const ok = shell.writeShortcutLink(file, 'update', {
      target: exe,
      cwd: path.dirname(exe),
      args: '',
      icon: exe,
      iconIndex: 0,
      appUserModelId: APP_ID,
    })
    if (ok) fixed.push(file)
  }
  return fixed
}

// ---------- the lasting copy for the browser helper ----------

/** Copy (or hard-link) a folder tree. Returns once everything is in place. */
async function mirror(from, to, { link = true } = {}) {
  await ofs.promises.mkdir(to, { recursive: true })
  for (const entry of await ofs.promises.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await mirror(src, dest, { link })
      continue
    }
    await ofs.promises.rm(dest, { force: true })
    if (link) {
      try {
        await ofs.promises.link(src, dest)
        continue
      } catch {
        // another drive, or links not allowed: copy instead
      }
    }
    await ofs.promises.copyFile(src, dest)
  }
}

/**
 * Make sure this version has a lasting copy (and the stable extension
 * folder is current), and remove the copies of other versions.
 * Resolves { exe, hostJs } or null when it could not be made.
 */
async function ensureRuntime() {
  if (!isPortable()) return null
  const where = locations()
  const marker = path.join(where.runtime, COMPLETE)
  try {
    if (!ofs.existsSync(marker)) {
      await ofs.promises.rm(where.runtime, { recursive: true, force: true })
      await mirror(path.dirname(process.execPath), where.runtime)
      await ofs.promises.writeFile(marker, new Date().toISOString())
    }
    // A real copy, not links: the browser keeps reading this folder.
    await ofs.promises.rm(where.extensionDir, { recursive: true, force: true })
    await mirror(path.join(where.runtime, 'resources', 'extension'), where.extensionDir, { link: false })
    await removeOtherVersions(where)
    return { exe: where.exe, hostJs: where.hostJs }
  } catch (err) {
    console.error(`Could not keep a copy of Yoinks for the browser helper: ${err.message}`)
    return null
  }
}

async function removeOtherVersions(where) {
  const root = path.dirname(where.runtime)
  for (const name of await ofs.promises.readdir(root).catch(() => [])) {
    if (name === path.basename(where.runtime)) continue
    // A helper still running from an old copy keeps its files locked; try next time.
    await ofs.promises.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {})
  }
}

/** Ready when this version's copy and the extension folder are in place. */
function runtimeReady() {
  const where = locations()
  return ofs.existsSync(path.join(where.runtime, COMPLETE)) && ofs.existsSync(where.extensionDir)
}

module.exports = { isPortable, locations, repairShortcuts, needsRepair, ensureRuntime, runtimeReady }
