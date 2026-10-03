'use strict'

// Registers (or with --uninstall, removes) the native messaging host so the
// yoinks extension can reach it. No admin rights needed. Windows: browsers find
// hosts through a per-user registry key pointing at a manifest file. Linux:
// manifest files in each installed browser's profile folder.

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const Linux = require('./linux-hosts')

const HOST_NAME = 'com.yoinks.host'
// Pinned by the "key" in extension/manifest.json, so it is the same on every machine.
const EXTENSION_ID = 'ijjoaplmmifaojgihjaefpbobfgfdimp'
// browser_specific_settings.gecko.id in extension/manifest.json.
const GECKO_ID = 'yoinks@yoinks.app'
const MANIFEST_PATH = path.join(__dirname, `${HOST_NAME}.json`)
// Firefox-family browsers want "allowed_extensions" instead of "allowed_origins".
const GECKO_MANIFEST_PATH = path.join(__dirname, `${HOST_NAME}.firefox.json`)

const BROWSER_KEYS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
]
// Firefox and forks like Waterfox read Mozilla's key; Waterfox's own key too, to be safe.
const GECKO_KEYS = ['HKCU\\Software\\Mozilla\\NativeMessagingHosts', 'HKCU\\Software\\Waterfox\\NativeMessagingHosts']

function reg(args) {
  const result = spawnSync('reg', args, { encoding: 'utf-8' })
  return result.status === 0
}

if (process.platform === 'linux') {
  const launcher = path.join(__dirname, 'host.sh')
  if (process.argv.includes('--uninstall')) {
    Linux.unregister()
    fs.rmSync(launcher, { force: true })
    console.log('Removed the yoinks native host.')
    process.exit(0)
  }
  fs.writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'host.js')}" "$@"\n`, { mode: 0o755 })
  fs.chmodSync(launcher, 0o755)
  const written = Linux.register({ launcher, chromeOrigin: `chrome-extension://${EXTENSION_ID}/`, geckoId: GECKO_ID })
  if (!written.length) {
    console.error('No supported browser profile found. Start Chrome, Chromium, Brave, Edge, Vivaldi or Firefox once, then run this again.')
    process.exit(1)
  }
  console.log(`Registered ${HOST_NAME} in:\n${written.map(file => `  ${file}`).join('\n')}`)
  console.log('Now load the extension/ folder in your browser (see README).')
  process.exit(0)
}

if (process.platform !== 'win32') {
  console.error('The installer supports Windows and Linux.')
  process.exit(1)
}

if (process.argv.includes('--uninstall')) {
  for (const key of [...BROWSER_KEYS, ...GECKO_KEYS]) reg(['delete', `${key}\\${HOST_NAME}`, '/f'])
  fs.rmSync(MANIFEST_PATH, { force: true })
  fs.rmSync(GECKO_MANIFEST_PATH, { force: true })
  console.log('Removed the yoinks native host.')
  process.exit(0)
}

const hostManifest = {
  name: HOST_NAME,
  description: 'yoinks downloader host',
  path: path.join(__dirname, 'host.bat'),
  type: 'stdio',
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ ...hostManifest, allowed_origins: [`chrome-extension://${EXTENSION_ID}/`] }, null, 2))
fs.writeFileSync(GECKO_MANIFEST_PATH, JSON.stringify({ ...hostManifest, allowed_extensions: [GECKO_ID] }, null, 2))

let failed = false
for (const [keys, manifest] of [[BROWSER_KEYS, MANIFEST_PATH], [GECKO_KEYS, GECKO_MANIFEST_PATH]]) {
  for (const key of keys) {
    if (!reg(['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'])) {
      console.error(`Could not write ${key}\\${HOST_NAME}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log(`Registered ${HOST_NAME} for Chrome, Edge, Brave, Firefox and Waterfox.`)
console.log('Now load the extension/ folder in your browser (see README).')
