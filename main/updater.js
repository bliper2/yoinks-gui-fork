'use strict'

// App updates from the GitHub releases of this repo (electron-updater reads
// the latest.yml that "npm run dist:win" writes next to the installer; upload
// both to the release). The installed app downloads the new version in the
// background and asks to restart. The portable exe cannot replace itself, so
// it downloads the new portable exe next to the running one and says so.

const { app, dialog, shell, Notification } = require('electron')
const { autoUpdater } = require('electron-updater')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const REPO = { provider: 'github', owner: 'bliper2', repo: 'yoinks-gui-fork' }
const RELEASES_PAGE = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`
const DOWNLOAD_PREFIX = `https://github.com/${REPO.owner}/${REPO.repo}/releases/download/`
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const ICON = path.join(__dirname, '..', 'extension', 'icons', 'icon128.png')

/**
 * Download Yoinks-<version>-x64-portable.exe from the release into `dir`
 * (the folder of the running portable exe). Verifies the size and, when
 * GitHub provides it, the SHA-256. Resolves the new file's path.
 */
async function downloadPortable(version, dir) {
  const name = `Yoinks-${version}-x64-portable.exe`
  const target = path.join(dir, name)
  if (fs.existsSync(target)) return target

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'Yoinks-updater' }
  const release = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/tags/v${version}`, { headers, signal: AbortSignal.timeout(20_000) }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`GitHub answered ${r.status}`))))
  const asset = release.assets?.find(a => a.name === name && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX))
  if (!asset) throw new Error('The release has no portable file.')

  const response = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'Yoinks-updater' } })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)
  const part = `${target}.part`
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(part)
  const source = Readable.fromWeb(response.body)
  source.on('data', chunk => hash.update(chunk))
  try {
    await pipeline(source, out)
    const size = fs.statSync(part).size
    if (asset.size && size !== asset.size) throw new Error('The download is incomplete.')
    const expected = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1]
    if (expected && hash.digest('hex') !== expected) throw new Error('The download does not match its checksum.')
    fs.renameSync(part, target)
  } catch (err) {
    fs.rmSync(part, { force: true })
    throw err
  }
  return target
}

function start(getWindow) {
  if (!app.isPackaged) return // npm start: nothing to update
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)

  autoUpdater.setFeedURL(REPO)
  autoUpdater.autoDownload = !portable
  autoUpdater.autoInstallOnAppQuit = true

  let told = null
  async function tellPortable(info) {
    if (told === info.version || !Notification.isSupported()) return
    told = info.version
    let saved = null
    try {
      saved = portableDir ? await downloadPortable(info.version, portableDir) : null
    } catch {
      // fall through: offer the download page instead
    }
    const n = new Notification(
      saved
        ? { title: `Yoinks ${info.version} is ready`, body: 'It was saved next to this one. Click to show it. Unpin the old one and pin the new one if you pinned it.', icon: ICON }
        : { title: `Yoinks ${info.version} is available`, body: 'Click to open the download page.', icon: ICON },
    )
    n.on('click', () => (saved ? shell.showItemInFolder(saved) : shell.openExternal(RELEASES_PAGE)))
    n.show()
  }

  autoUpdater.on('update-available', info => {
    if (portable) tellPortable(info)
  })

  autoUpdater.on('update-downloaded', async info => {
    if (told === info.version) return
    told = info.version
    const { response } = await dialog.showMessageBox(getWindow() ?? undefined, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Yoinks ${info.version} is ready to install`,
      detail: 'Restart now to update (running downloads stop), or it installs the next time you close Yoinks.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  // Offline, rate-limited or no release yet: try again at the next check.
  autoUpdater.on('error', () => {})

  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_EVERY_MS)
}

module.exports = { start, downloadPortable }
