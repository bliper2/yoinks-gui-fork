'use strict'

// "Health check" in Settings: tests the parts Yoinks needs and says which one
// is broken. Each check is { id, label, status: 'ok' | 'warn' | 'fail', detail }.
// Nothing is sent anywhere except one tiny request to test the connection.

const fs = require('node:fs')
const path = require('node:path')

const ytdlp = require('../main/ytdlp')
const store = require('./settings-store')

const ONE_GB = 1024 ** 3

async function checkYtDlp(settings) {
  const info = await ytdlp.versionInfo()
  if (!info.version) {
    return { id: 'ytdlp', label: 'yt-dlp', status: 'fail', detail: 'Not found. It is downloaded on first use; check your connection, then try a download or press Update now.' }
  }
  const age = ageInDays(info.version)
  const where = info.managed ? 'managed by Yoinks' : 'installed on your system'
  if (age !== null && age > 90 && !settings.ytdlpAutoUpdate) {
    return { id: 'ytdlp', label: 'yt-dlp', status: 'warn', detail: `${info.version} (${where}). It is ${age} days old and automatic updates are off; sites may have changed.` }
  }
  return { id: 'ytdlp', label: 'yt-dlp', status: 'ok', detail: `${info.version} (${where})` }
}

async function checkFfmpeg() {
  const info = await ytdlp.ffmpegInfo()
  if (!info.where) {
    return { id: 'ffmpeg', label: 'ffmpeg', status: 'fail', detail: 'Not found. Merging video and audio, MP3 and cover art need it. Reinstall Yoinks.' }
  }
  const place = { bundled: 'the copy that comes with Yoinks', system: 'installed on your system', package: 'from the ffmpeg-static package' }[info.where]
  return { id: 'ffmpeg', label: 'ffmpeg', status: 'ok', detail: `Found, ${place}.` }
}

async function checkFolder(settings) {
  const dir = store.outDir(settings)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
    const probe = path.join(dir, `.yoinks-write-test-${process.pid}`)
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
  } catch (err) {
    return { id: 'folder', label: 'Download folder', status: 'fail', detail: `${dir} is not writable (${err.code ?? err.message}). Choose another folder in Settings.` }
  }
  try {
    const stats = await fs.promises.statfs(dir)
    const free = stats.bavail * stats.bsize
    const text = `${(free / ONE_GB).toFixed(1)} GB free`
    if (free < ONE_GB) return { id: 'folder', label: 'Download folder', status: 'warn', detail: `${dir}: only ${text}.` }
    return { id: 'folder', label: 'Download folder', status: 'ok', detail: `${dir}: ${text}.` }
  } catch {
    return { id: 'folder', label: 'Download folder', status: 'ok', detail: `${dir}: writable.` }
  }
}

async function checkInternet() {
  try {
    const response = await fetch('https://www.youtube.com/generate_204', { signal: AbortSignal.timeout(6000) })
    return response.status === 204 || response.ok
      ? { id: 'internet', label: 'Internet', status: 'ok', detail: 'Connected.' }
      : { id: 'internet', label: 'Internet', status: 'warn', detail: `YouTube answered with error ${response.status}.` }
  } catch {
    return { id: 'internet', label: 'Internet', status: 'fail', detail: 'Could not reach YouTube. Check your connection, VPN or firewall.' }
  }
}

function checkRuntime() {
  return { id: 'runtime', label: 'Yoinks engine', status: 'ok', detail: `Running (Node ${process.versions.node}${process.versions.electron ? `, Electron ${process.versions.electron}` : ''}).` }
}

/** "2026.08.19" -> whole days since then, or null if it is not a date. */
function ageInDays(version, now = Date.now()) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version ?? '')
  if (!m) return null
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.floor((now - then) / 86_400_000)
}

async function run(settings = store.load()) {
  const checks = await Promise.all([checkYtDlp(settings), checkFfmpeg(), checkFolder(settings), checkInternet()])
  checks.push(checkRuntime())
  const worst = checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok'
  return { checks, status: worst, at: Date.now() }
}

module.exports = { run, ageInDays }
