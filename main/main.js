'use strict'

// Electron main process. It runs the same queue controller as the browser
// extension (extension/shared/controller.js) with an in-process backend
// (core/local-backend.js), and shows the same UI (extension/app.html).

const { app, BrowserWindow, ipcMain, shell, dialog, Notification, clipboard } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const Controller = require('../extension/shared/controller.js')
const { createLocalBackend } = require('../core/local-backend')
const store = require('../core/settings-store')
const files = require('../core/files')
const updater = require('./updater')
const helper = require('./helper')
const Tray = require('./tray')
const Ytdlp = require('./ytdlp')

const ROOT = path.join(__dirname, '..')
// Same as "appId" in package.json (the installer's shortcut uses it): taskbar
// pins and notifications group under one Yoinks icon.
const APP_ID = 'com.mrkraps.yoinks-gui'
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
// Electron picks Wayland by itself when the session is one (since Electron 38).
if (process.platform === 'linux') {
  // An AppImage cannot carry the SUID sandbox helper (and many distros block the
  // unprivileged alternative), so it would not start. The .deb/.rpm keep the sandbox.
  if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')
}
const STATE_PATH = path.join(app.getPath('userData'), 'app-state.json')
const LEGAL = { terms: 'terms.md', privacy: 'privacy.md', changelog: 'changelog.md' }
const ICON = path.join(ROOT, 'extension', 'icons', 'icon128.png')

let mainWindow = null

// ---------- controller wiring ----------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

let saved = readState()
const storage = {
  load: async () => saved,
  // Temp file then rename: a crash mid-write must not wipe the history and queue.
  save: partial => {
    saved = { ...saved, ...partial }
    try {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
      const tmp = `${STATE_PATH}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(saved))
      fs.renameSync(tmp, STATE_PATH)
    } catch (err) {
      console.error(`Could not save app-state.json: ${err.message}`)
    }
  },
}

// The desktop app has a real folder dialog (the helper uses PowerShell's).
async function pickFolder(current) {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Where should Yoinks save downloads?',
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
}

// "Convert files": the desktop app has a real file dialog.
async function pickFiles() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Choose files to convert',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video and audio', extensions: [...Ytdlp.CONVERTIBLE].map(ext => ext.slice(1)) }],
  })
  return result.canceled ? [] : result.filePaths
}

function notify({ title, message, target }) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body: message, icon: ICON })
  n.on('click', () => {
    if (!target) return showWindow()
    try {
      files.reveal(target)
    } catch {
      showWindow()
    }
  })
  n.show()
}

function showWindow() {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Downloads are running and the user wants to be asked: true unless they keep Yoinks open. */
function confirmStop() {
  const running = controller.view().queue.filter(job => job.phase === 'downloading' || job.phase === 'probing').length
  if (!running || !store.load().confirmClose) return true
  const choice = dialog.showMessageBoxSync(mainWindow ?? undefined, {
    type: 'question',
    buttons: ['Keep Yoinks open', 'Close and stop'],
    defaultId: 0,
    cancelId: 0,
    title: 'Downloads are running',
    message: running === 1 ? 'Yoinks is still downloading 1 file.' : `Yoinks is still downloading ${running} files.`,
    detail: 'If you close it now, the downloads stop. They come back paused next time, and paused ones keep their partial files.',
  })
  return choice === 1
}

const tray = Tray.create({
  getWindow: () => mainWindow,
  iconPath: ICON,
  onShow: showWindow,
  onCommand: type => controller.command({ type }),
  onQuit: () => {
    if (confirmStop()) app.quit()
  },
})

const controller = Controller.create({
  backend: createLocalBackend({ pickFolder, pickFiles }),
  storage,
  notify,
  onState: view => {
    mainWindow?.webContents.send('yoinks:state', view)
    tray.update(view)
  },
  platform: 'desktop',
})

// The extension writes the same settings.json: pick up its changes live.
fs.watchFile(store.SETTINGS_PATH, { interval: 1000 }, () => controller.command({ type: 'settings:refresh' }))

// ---------- window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    backgroundColor: '#0a0d13',
    frame: false,
    show: false,
    titleBarStyle: 'hidden',
    icon: ICON,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // The portable exe unpacks the app to a temp folder and runs it from there,
  // so "Pin to taskbar" would pin that temp copy, which is deleted on exit.
  // Point the pin (and its icon) at the portable exe itself instead.
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE
  if (process.platform === 'win32' && portableExe) {
    mainWindow.setAppDetails({
      appId: APP_ID,
      relaunchCommand: `"${portableExe}"`,
      relaunchDisplayName: 'Yoinks',
      appIconPath: portableExe,
      appIconIndex: 0,
    })
  }

  mainWindow.loadFile(path.join(ROOT, 'extension', 'app.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.on('did-finish-load', () => controller.ready.then(() => mainWindow?.webContents.send('yoinks:state', controller.view())))

  // The UI never navigates or opens windows itself; links go to the browser.
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // With the tray icon on, closing only hides the window. Otherwise closing
  // ends the app, and with it any running download: ask first.
  mainWindow.on('close', event => {
    if (quitting) return
    if (tray.active) {
      event.preventDefault()
      mainWindow.hide()
      if (!toldAboutTray && Notification.isSupported()) {
        toldAboutTray = true
        new Notification({ title: 'Yoinks is still running', body: 'Downloads keep going. Open Yoinks or quit it from the tray icon.', icon: ICON }).show()
      }
      return
    }
    if (!confirmStop()) event.preventDefault()
  })

  // Setting "Offer links I copy": put a copied link in the link box on return.
  let lastClipboardLink = ''
  mainWindow.on('focus', () => {
    if (!store.load().clipboardWatch) return
    const link = controller.urlsFrom(clipboard.readText())[0]
    if (link && link !== lastClipboardLink) {
      lastClipboardLink = link
      mainWindow?.webContents.send('yoinks:clipboard', link)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Set when the app is really quitting (including "restart to update"), so the
// close question above is only asked for a click on the window's own close.
let quitting = false
let toldAboutTray = false
app.on('before-quit', () => (quitting = true))

// A second copy would run its own queue and overwrite this one's history:
// bring the open window to the front instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    createWindow()
    controller.ready.then(() => tray.update(controller.view()))
    updater.start(() => mainWindow)
    helper.register() // browser extension helper, no Node.js needed
    // Watched channels: look for new uploads a minute after start, then every 30 minutes.
    setTimeout(() => controller.command({ type: 'watch:run' }), 60_000)
    setInterval(() => controller.command({ type: 'watch:run' }), 30 * 60_000)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ---------- IPC (only from our own window) ----------

function fromOurWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents
}

ipcMain.on('yoinks:command', (event, command) => {
  if (!fromOurWindow(event) || !command || typeof command.type !== 'string') return
  controller.command(command)
})

ipcMain.handle('yoinks:legal', (event, name) => {
  if (!fromOurWindow(event) || !LEGAL[name]) throw new Error('Unknown page.')
  return fs.promises.readFile(path.join(ROOT, 'extension', 'legal', LEGAL[name]), 'utf-8')
})

ipcMain.on('yoinks:open-external', (event, url) => {
  if (!fromOurWindow(event)) return
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url)
  } catch {
    // not a URL
  }
})

ipcMain.handle('yoinks:extension-info', event => (fromOurWindow(event) ? helper.info() : null))

ipcMain.on('yoinks:open-path', (event, which) => {
  if (!fromOurWindow(event) || which !== 'extension') return
  shell.openPath(helper.locations().extensionDir)
})

ipcMain.on('yoinks:version', event => {
  event.returnValue = app.getVersion()
})

ipcMain.on('window:minimize', event => fromOurWindow(event) && mainWindow.minimize())
ipcMain.on('window:close', event => fromOurWindow(event) && mainWindow.close())
