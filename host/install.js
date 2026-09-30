'use strict'

// Registers (or with --uninstall, removes) the native messaging host so the
// yoinks extension can reach it. Windows only: browsers find hosts through a
// per-user registry key pointing at a manifest file. No admin rights needed.

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const HOST_NAME = 'com.yoinks.host'
// Pinned by the "key" in extension/manifest.json, so it is the same on every machine.
const EXTENSION_ID = 'ijjoaplmmifaojgihjaefpbobfgfdimp'
const MANIFEST_PATH = path.join(__dirname, `${HOST_NAME}.json`)

const BROWSER_KEYS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
]

function reg(args) {
  const result = spawnSync('reg', args, { encoding: 'utf-8' })
  return result.status === 0
}

if (process.platform !== 'win32') {
  console.error('The installer only supports Windows.')
  process.exit(1)
}

if (process.argv.includes('--uninstall')) {
  for (const key of BROWSER_KEYS) reg(['delete', `${key}\\${HOST_NAME}`, '/f'])
  fs.rmSync(MANIFEST_PATH, { force: true })
  console.log('Removed the yoinks native host.')
  process.exit(0)
}

fs.writeFileSync(
  MANIFEST_PATH,
  JSON.stringify(
    {
      name: HOST_NAME,
      description: 'yoinks downloader host',
      path: path.join(__dirname, 'host.bat'),
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2,
  ),
)

let failed = false
for (const key of BROWSER_KEYS) {
  if (!reg(['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', MANIFEST_PATH, '/f'])) {
    console.error(`Could not write ${key}\\${HOST_NAME}`)
    failed = true
  }
}

if (failed) process.exit(1)
console.log(`Registered ${HOST_NAME} for Chrome, Edge and Brave.`)
console.log('Now load the extension/ folder in your browser (see README).')
