'use strict'

// Native messaging registration on Linux. Browsers read a manifest from a fixed
// folder in their own profile directory, so there is no registry: we write the
// manifest into every installed browser's folder. Used by the installed app
// (main/helper.js) and by "npm run extension:install" (host/install.js).
//
// Only browsers that already have a profile folder are touched, and the app
// registers again at every start, so a browser installed later is picked up.
// Snap and Flatpak browsers run in a sandbox and cannot start the helper.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOST_NAME = 'com.yoinks.host'

const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
// [browser profile folder, folder inside it that holds the manifests]
const CHROMIUM = ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge', 'vivaldi'].map(name => [path.join(config, name), path.join(config, name, 'NativeMessagingHosts')])
const GECKO = ['.mozilla', '.waterfox', '.librewolf'].map(name => [path.join(os.homedir(), name), path.join(os.homedir(), name, 'native-messaging-hosts')])

const manifestFile = dir => path.join(dir, `${HOST_NAME}.json`)

/**
 * Write the manifests. `launcher` is the executable file browsers start.
 * Returns the manifest paths written (empty if no supported browser is installed).
 */
function register({ launcher, chromeOrigin, geckoId }) {
  const written = []
  const host = { name: HOST_NAME, description: 'Yoinks downloader host', path: launcher, type: 'stdio' }
  for (const [list, extra] of [
    [CHROMIUM, { allowed_origins: [chromeOrigin] }],
    [GECKO, { allowed_extensions: [geckoId] }],
  ]) {
    for (const [profile, dir] of list) {
      if (!fs.existsSync(profile)) continue
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(manifestFile(dir), JSON.stringify({ ...host, ...extra }, null, 2))
      written.push(manifestFile(dir))
    }
  }
  return written
}

/** Delete every manifest this app wrote. */
function unregister() {
  for (const [, dir] of [...CHROMIUM, ...GECKO]) fs.rmSync(manifestFile(dir), { force: true })
}

/** True if at least one browser has a manifest pointing at `launcher`. */
function registered(launcher) {
  return [...CHROMIUM, ...GECKO].some(([, dir]) => {
    try {
      return JSON.parse(fs.readFileSync(manifestFile(dir), 'utf-8')).path === launcher
    } catch {
      return false
    }
  })
}

module.exports = { register, unregister, registered }
