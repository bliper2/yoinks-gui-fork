'use strict'

// "Show in folder", "Open file" and the Windows folder picker.
// Paths can come from the extension's history, so they are checked here:
// reveal needs an existing path; open also needs a media file, so it can
// never launch a program. No cmd.exe anywhere: explorer.exe opens/selects
// directly, and Windows paths cannot contain `"`.

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { YoinksError } = require('../main/ytdlp')

const OPENABLE = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.mp3', '.m4a', '.opus', '.ogg', '.wav', '.flac', '.aac'])

function existingPath(raw) {
  const p = typeof raw === 'string' && path.isAbsolute(raw) ? path.normalize(raw) : null
  if (!p || !fs.existsSync(p)) throw new YoinksError({ code: 'missing', message: 'That file is gone — it may have been moved or deleted.' })
  return p
}

function openablePath(raw) {
  const p = existingPath(raw)
  if (!fs.statSync(p).isFile() || !OPENABLE.has(path.extname(p).toLowerCase())) {
    throw new YoinksError({ code: 'not-media', message: 'Only downloaded media files can be opened.' })
  }
  return p
}

function detached(cmd, args, options = {}) {
  spawn(cmd, args, { detached: true, stdio: 'ignore', ...options }).on('error', () => {}).unref()
}

function reveal(raw) {
  const target = existingPath(raw)
  const isDir = fs.statSync(target).isDirectory()
  if (process.platform === 'win32') {
    detached('explorer.exe', [isDir ? `"${target}"` : `/select,"${target}"`], { windowsVerbatimArguments: true })
  } else if (process.platform === 'darwin') detached('open', isDir ? [target] : ['-R', target])
  else detached('xdg-open', [isDir ? target : path.dirname(target)])
}

function open(raw) {
  const target = openablePath(raw)
  if (process.platform === 'win32') detached('explorer.exe', [`"${target}"`], { windowsVerbatimArguments: true })
  else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [target])
}

/**
 * Windows' folder dialog via PowerShell (the helper has no Electron).
 * The current folder goes in through an env var, never into the script.
 * Resolves the chosen folder, or null if cancelled.
 */
function pickFolder(current) {
  if (process.platform !== 'win32') return Promise.reject(new YoinksError({ code: 'unsupported', message: 'Choose the folder in the desktop app.' }))
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Where should Yoinks save downloads?'",
    '$dialog.ShowNewFolderButton = $true',
    '$dialog.SelectedPath = $env:YOINKS_CURRENT_DIR',
    "if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.SelectedPath }",
  ].join('; ')
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      env: { ...process.env, YOINKS_CURRENT_DIR: current },
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (err += chunk))
    child.on('error', error => reject(new YoinksError({ code: 'picker', message: 'Could not open the folder picker.', detail: error.message })))
    child.on('close', code => {
      if (code !== 0 && err.trim()) reject(new YoinksError({ code: 'picker', message: 'Could not open the folder picker.', detail: err.trim() }))
      else resolve(out.trim() || null)
    })
  })
}

module.exports = { reveal, open, pickFolder }
