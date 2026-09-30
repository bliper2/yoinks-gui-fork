'use strict'

// Electron main process. It runs the same queue controller as the browser
// extension (extension/shared/controller.js) with an in-process backend
// (core/local-backend.js), and shows the same UI (extension/app.html).

const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const Controller = require('../extension/shared/controller.js')
const { createLocalBackend } = require('../core/local-backend')
const store = require('../core/settings-store')
const files = require('../core/files')

const ROOT = path.join(__dirname, '..')
const STATE_PATH = path.join(app.getPath('userData'), 'app-state.json')
const LEGAL = { terms: 'terms.md', privacy: 'privacy.md' }

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
  save: partial => {
    saved = { ...saved, ...partial }
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, JSON.stringify(saved))
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

function notify({ title, message, target }) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body: message, icon: path.join(ROOT, 'extension', 'icons', 'icon128.png') })
  n.on('click', () => {
    if (!target) return mainWindow?.show()
    try {
      files.reveal(target)
    } catch {
      mainWindow?.show()
    }
  })
  n.show()
}

const controller = Controller.create({
  backend: createLocalBackend({ pickFolder }),
  storage,
  notify,
  onState: view => mainWindow?.webContents.send('yoinks:state', view),
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
    icon: path.join(ROOT, 'extension', 'icons', 'icon128.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.loadFile(path.join(ROOT, 'extension', 'app.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.on('did-finish-load', () => controller.ready.then(() => mainWindow?.webContents.send('yoinks:state', controller.view())))

  // The UI never navigates or opens windows itself; links go to the browser.
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

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

ipcMain.on('yoinks:version', event => {
  event.returnValue = app.getVersion()
})

ipcMain.on('window:minimize', event => fromOurWindow(event) && mainWindow.minimize())
ipcMain.on('window:close', event => fromOurWindow(event) && mainWindow.close())
