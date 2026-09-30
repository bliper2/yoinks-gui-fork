'use strict'

// App updates from the GitHub releases of this repo (electron-updater reads
// the latest.yml that "npm run dist:win" writes next to the installer; upload
// both to the release). The installed app downloads the new version in the
// background and asks to restart; the portable exe cannot replace itself, so
// it only says a new version exists and opens the download page.

const { app, dialog, shell, Notification } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')

const REPO = { provider: 'github', owner: 'bliper2', repo: 'yoinks-gui-fork' }
const RELEASES_PAGE = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const ICON = path.join(__dirname, '..', 'extension', 'icons', 'icon128.png')

function start(getWindow) {
  if (!app.isPackaged) return // npm start: nothing to update
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR)

  autoUpdater.setFeedURL(REPO)
  autoUpdater.autoDownload = !portable
  autoUpdater.autoInstallOnAppQuit = true

  let told = null
  autoUpdater.on('update-available', info => {
    if (!portable || told === info.version || !Notification.isSupported()) return
    told = info.version
    const n = new Notification({ title: `Yoinks ${info.version} is available`, body: 'Click to open the download page.', icon: ICON })
    n.on('click', () => shell.openExternal(RELEASES_PAGE))
    n.show()
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

module.exports = { start }
