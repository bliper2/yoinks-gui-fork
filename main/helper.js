'use strict'

// Sets up the browser extension's helper for the installed app, so people do
// not need Node.js: browsers start Yoinks itself in "run as Node" mode on
// host/host.js. Registered per user (no admin) and refreshed every time the
// app starts so a moved or updated install keeps working.
// Windows: registry keys for Chrome, Edge, Brave and Firefox/Waterfox.
// Linux: manifest files in each browser's profile folder (host/linux-hosts.js),
// for the .deb/.rpm install and for the AppImage.
//
// The Windows portable exe cannot do this: it unpacks to a temporary folder
// that is deleted on exit. There the helper stays "npm run extension:install".

const { app } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const Linux = require('../host/linux-hosts')

const HOST_NAME = 'com.yoinks.host'
// Pinned by the "key" in extension/manifest.json and browser_specific_settings.gecko.id.
const CHROME_ORIGIN = 'chrome-extension://ijjoaplmmifaojgihjaefpbobfgfdimp/'
const GECKO_ID = 'yoinks@yoinks.app'

const CHROMIUM_KEYS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
]
const GECKO_KEYS = ['HKCU\\Software\\Mozilla\\NativeMessagingHosts', 'HKCU\\Software\\Waterfox\\NativeMessagingHosts']

const isPortable = () => Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
const isLinux = process.platform === 'linux'

/** 'installed' (can register), 'portable', or 'dev' (npm start). */
function mode() {
  if (!app.isPackaged) return 'dev'
  return isPortable() ? 'portable' : 'installed'
}

function locations() {
  const dir = path.join(app.getPath('userData'), 'helper')
  const resources = process.resourcesPath
  return {
    dir,
    bat: path.join(dir, isLinux ? 'host.sh' : 'host.bat'),
    chromeManifest: path.join(dir, `${HOST_NAME}.json`),
    geckoManifest: path.join(dir, `${HOST_NAME}.firefox.json`),
    hostJs: path.join(resources, 'app.asar', 'host', 'host.js'),
    extensionDir: app.isPackaged ? path.join(resources, 'extension') : path.join(__dirname, '..', 'extension'),
  }
}

const reg = args => new Promise(resolve => execFile('reg', args, { windowsHide: true }, error => resolve(!error)))

/**
 * Linux launcher: a shell script that runs this app as Node on host.js.
 * An AppImage is mounted somewhere new on every run, so it is started by its
 * own path ($APPIMAGE) and finds host.js through $APPDIR, which it sets.
 */
function registerLinux(where) {
  try {
    fs.mkdirSync(where.dir, { recursive: true })
    const run = process.env.APPIMAGE
      ? `exec "${process.env.APPIMAGE}" -e "require(process.env.APPDIR + '/resources/app.asar/host/host.js')" "$@"`
      : `exec "${process.execPath}" "${where.hostJs}" "$@"`
    fs.writeFileSync(where.bat, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1\nexport ELECTRON_RUN_AS_NODE\n${run}\n`, { mode: 0o755 })
    fs.chmodSync(where.bat, 0o755)
    return Linux.register({ launcher: where.bat, chromeOrigin: CHROME_ORIGIN, geckoId: GECKO_ID }).length > 0
  } catch {
    return false
  }
}

/** Write the launcher and host manifests and point the browsers at them. */
async function register() {
  if (mode() !== 'installed') return false
  const where = locations()
  if (isLinux) return registerLinux(where)
  if (process.platform !== 'win32') return false
  try {
    fs.mkdirSync(where.dir, { recursive: true })
    // ELECTRON_RUN_AS_NODE makes Yoinks.exe behave like node.exe for this one process.
    fs.writeFileSync(where.bat, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${where.hostJs}" %*\r\n`)
    const host = { name: HOST_NAME, description: 'Yoinks downloader host', path: where.bat, type: 'stdio' }
    fs.writeFileSync(where.chromeManifest, JSON.stringify({ ...host, allowed_origins: [CHROME_ORIGIN] }, null, 2))
    fs.writeFileSync(where.geckoManifest, JSON.stringify({ ...host, allowed_extensions: [GECKO_ID] }, null, 2))
  } catch {
    return false
  }
  const jobs = [
    ...CHROMIUM_KEYS.map(key => reg(['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', where.chromeManifest, '/f'])),
    ...GECKO_KEYS.map(key => reg(['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', where.geckoManifest, '/f'])),
  ]
  return (await Promise.all(jobs)).every(Boolean)
}

/** What Settings shows: where the extension folder is and whether the helper is ready. */
async function info() {
  const where = locations()
  const kind = mode()
  let ready = false
  if (kind === 'installed') {
    ready = isLinux
      ? fs.existsSync(where.bat) && Linux.registered(where.bat)
      : fs.existsSync(where.bat) && fs.existsSync(where.chromeManifest) && (await reg(['query', `${CHROMIUM_KEYS[0]}\\${HOST_NAME}`]))
  }
  return { mode: kind, ready, folder: where.extensionDir }
}

module.exports = { register, info, locations, mode }
