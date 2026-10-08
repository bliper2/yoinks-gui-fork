'use strict'

// Core download engine — adapted from pablostanley/yoinks' src/lib/ytdlp.ts
// (MIT). It owns everything that talks to yt-dlp: finding/updating the
// binary, probing, format lists, music search, turning settings into yt-dlp
// arguments, and running downloads with progress. The desktop app and the
// browser helper both use it through core/session.js.

const { spawn, spawnSync } = require('node:child_process')
const { createWriteStream } = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const Errors = require('../extension/shared/errors.js')
const Template = require('../extension/shared/filename-template.js')
const { pickChoice } = require('../extension/shared/formats.js')

const YOINKS_DIR = path.join(os.homedir(), '.yoinks', 'bin')
const LOCAL_YTDLP = path.join(YOINKS_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const UPDATE_STAMP = path.join(YOINKS_DIR, 'last-update')
const UPDATE_EVERY_MS = 7 * 24 * 60 * 60 * 1000

// On Windows yt-dlp writes to a pipe in the legacy code page, turning e.g.
// Arabic or Japanese titles and file paths into spaces. Every call whose
// output we read must force UTF-8.
const UTF8 = ['--encoding', 'utf-8']

// ---------- errors ----------

/** An error with a friendly message; `code` is also 'paused' or 'cancelled'. */
class YoinksError extends Error {
  constructor({ code, message, retryable = false, detail = '' }) {
    super(message)
    this.code = code
    this.retryable = retryable
    this.detail = detail
  }
}

function fromYtdlp(stderr, fallback) {
  const friendly = Errors.friendly(stderr || fallback)
  return new YoinksError(friendly)
}

// ---------- binaries ----------

function ytDlpAssetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}

/**
 * Stop a child and everything it started. On Windows yt-dlp.exe is a
 * launcher that runs the real yt-dlp as its own child process; killing only
 * the launcher (what child.kill() does) leaves that one downloading.
 */
function killTree(child, { sync = false } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== 'win32' || !child.pid) {
    child.kill('SIGTERM')
    return
  }
  const taskkill = ['/pid', String(child.pid), '/T', '/F']
  if (sync) spawnSync('taskkill', taskkill, { windowsHide: true })
  else spawn('taskkill', taskkill, { windowsHide: true }).on('error', () => child.kill())
}

/** spawn(), but aborting `signal` stops the whole process tree (killTree). */
function spawnKillable(cmd, args, { signal, ...options } = {}) {
  signal?.throwIfAborted()
  const child = spawn(cmd, args, { ...options, windowsHide: true })
  if (signal) {
    const onAbort = () => killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    child.once('close', () => signal.removeEventListener('abort', onAbort))
  }
  return child
}

/** Run a command, resolving { code, stdout, stderr } (never rejects on exit code). */
function run(cmd, args, { signal, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnKillable(cmd, args, { signal, timeout })
    } catch (err) {
      reject(err)
      return
    }
    let stdout = ''
    let stderr = ''
    // Decode as a stream so a character split across chunks survives.
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => (signal?.aborted ? reject(signal.reason) : resolve({ code, stdout, stderr })))
  })
}

// Async on purpose: a blocking check here would freeze the caller.
async function commandWorks(cmd, args) {
  try {
    return (await run(cmd, args, { timeout: 10_000 })).code === 0
  } catch {
    return false
  }
}

/**
 * Resolve a usable yt-dlp: a system install first, then our managed copy
 * (self-updated weekly when `autoUpdate`), else download the standalone
 * binary from GitHub releases.
 */
async function ensureYtDlp(onStatus, signal, { autoUpdate = true } = {}) {
  if (await commandWorks('yt-dlp', ['--version'])) return 'yt-dlp'

  if (await commandWorks(LOCAL_YTDLP, ['--version'])) {
    if (autoUpdate && (await updateIsDue())) {
      onStatus('Updating yt-dlp…')
      await updateManaged(signal).catch(() => {}) // keep the current copy on failure
    }
    return LOCAL_YTDLP
  }

  onStatus('First run: downloading yt-dlp…')
  await fs.mkdir(YOINKS_DIR, { recursive: true })
  const response = await fetch(`${RELEASE_BASE}/${ytDlpAssetName()}`, { signal }).catch(err => {
    throw new YoinksError({ code: 'network', message: 'Could not download yt-dlp. Check your connection and try again.', retryable: true, detail: err.message })
  })
  if (!response.ok || !response.body) {
    throw new YoinksError({ code: 'network', message: `Could not download yt-dlp (HTTP ${response.status}). Try again later.`, retryable: true })
  }
  const tmp = `${LOCAL_YTDLP}.download`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp), { signal })
  await fs.chmod(tmp, 0o755)
  await fs.rename(tmp, LOCAL_YTDLP)
  await fs.writeFile(UPDATE_STAMP, '')
  return LOCAL_YTDLP
}

async function updateIsDue() {
  try {
    return Date.now() - (await fs.stat(UPDATE_STAMP)).mtimeMs >= UPDATE_EVERY_MS
  } catch {
    return true
  }
}

// A failed update (offline, GitHub down) must not wait a whole week for the
// next try: age the stamp so the update is due again in an hour.
async function retrySoon() {
  const when = new Date(Date.now() - UPDATE_EVERY_MS + 60 * 60 * 1000)
  await fs.utimes(UPDATE_STAMP, when, when).catch(() => {})
}

async function updateManaged(signal) {
  // Stamp first so parallel runs don't all try to replace the exe.
  await fs.mkdir(YOINKS_DIR, { recursive: true })
  await fs.writeFile(UPDATE_STAMP, '')
  let result
  try {
    result = await run(LOCAL_YTDLP, ['-U'], { signal, timeout: 180_000 })
  } catch (err) {
    await retrySoon()
    throw err
  }
  if (result.code !== 0) {
    await retrySoon()
    throw fromYtdlp(result.stderr || result.stdout, 'yt-dlp could not update itself.')
  }
  return result.stdout
}

/** { version, managed } for whichever yt-dlp ensureYtDlp would use. */
async function versionInfo() {
  for (const [bin, managed] of [['yt-dlp', false], [LOCAL_YTDLP, true]]) {
    try {
      const { code, stdout } = await run(bin, ['--version'], { timeout: 10_000 })
      if (code === 0) return { version: stdout.trim(), managed }
    } catch {
      // try the next one
    }
  }
  return { version: null, managed: true }
}

/** "Update now". A system install is left to whoever installed it. */
async function updateNow(onStatus = () => {}) {
  const before = await versionInfo()
  if (before.version && !before.managed) {
    return { ...before, message: 'yt-dlp is installed on your system (not by Yoinks), so update it the way you installed it.' }
  }
  if (!before.version) {
    await ensureYtDlp(onStatus, undefined, { autoUpdate: false })
    return { ...(await versionInfo()), message: 'yt-dlp downloaded.' }
  }
  onStatus('Updating yt-dlp…')
  await updateManaged()
  const after = await versionInfo()
  return { ...after, message: after.version === before.version ? 'yt-dlp is already up to date.' : `Updated yt-dlp to ${after.version}.` }
}

/**
 * ffmpeg for merging, audio conversion, clips and cover art: the copy
 * shipped with the app, then a system install, then ffmpeg-static.
 * undefined if none (yt-dlp still handles single-file formats).
 * The installed app keeps it in resources/ (package.json extraResources),
 * because nothing inside app.asar can be executed.
 */
async function findFfmpeg() {
  return (await ffmpegInfo()).path
}

/** { path, where } where `where` is 'bundled' | 'system' | 'package' | null (none found). */
async function ffmpegInfo() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const shipped = [process.resourcesPath && path.join(process.resourcesPath, exe), path.join(__dirname, '..', exe)].filter(Boolean)
  for (const bundled of shipped) if (await commandWorks(bundled, ['-version'])) return { path: bundled, where: 'bundled' }
  if (await commandWorks('ffmpeg', ['-version'])) return { path: undefined, where: 'system' } // on PATH, yt-dlp finds it itself
  try {
    const ffmpegPath = require('ffmpeg-static')
    if (ffmpegPath && (await commandWorks(ffmpegPath, ['-version']))) return { path: ffmpegPath, where: 'package' }
  } catch {
    // ffmpeg-static not installed or unsupported platform
  }
  return { path: undefined, where: null }
}

// ---------- probe ----------

function cookieArgs(settings) {
  return settings?.cookiesFromBrowser && settings.cookiesFromBrowser !== 'off' ? ['--cookies-from-browser', settings.cookiesFromBrowser] : []
}

/**
 * Video info as JSON (plus a temp file for --load-info-json). `playlist`
 * lists the entries without resolving each one (fast), so there are no
 * formats. `--` stops a link from ever being read as an option.
 */
async function probe(ytdlp, url, signal, { playlist = false, settings } = {}) {
  const mode = playlist ? ['--flat-playlist', '--yes-playlist'] : ['--no-playlist']
  const result = await run(ytdlp, [...UTF8, '-J', ...mode, '--no-warnings', ...cookieArgs(settings), '--', url], { signal })
  if (result.code !== 0) throw fromYtdlp(result.stderr, `yt-dlp exited with code ${result.code}`)
  let info
  try {
    info = JSON.parse(result.stdout)
  } catch {
    throw new YoinksError({ code: 'unknown', message: 'Could not read the video info from yt-dlp.', retryable: true })
  }
  const infoJsonPath = await writeInfoJson(info)
  return { info, infoJsonPath }
}

async function writeInfoJson(info) {
  const file = path.join(os.tmpdir(), `yoinks-info-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
  await fs.writeFile(file, JSON.stringify(info))
  return file
}

/**
 * Top YouTube Music song results for a search, each fully resolved so it has
 * artist, album and duration (used to score Spotify matches).
 */
async function searchMusic(ytdlp, query, { limit = 4, signal, settings } = {}) {
  const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`
  const result = await run(
    ytdlp,
    [...UTF8, '--no-warnings', '--skip-download', '--playlist-items', `1-${limit}`, '--print', '%(.{id,title,artist,album,duration,channel,webpage_url})j', ...cookieArgs(settings), '--', url],
    { signal },
  )
  if (result.code !== 0 && !result.stdout.trim()) throw fromYtdlp(result.stderr, 'YouTube Music search failed.')
  return result.stdout
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(entry => entry?.id)
    .map(entry => ({
      id: entry.id,
      url: `https://music.youtube.com/watch?v=${entry.id}`,
      title: entry.title ?? '',
      artist: (entry.artist ?? entry.channel ?? '').replace(/ - Topic$/, ''),
      album: entry.album ?? null,
      duration: entry.duration ?? null,
    }))
}

/**
 * Videos matching a text search on YouTube: [{ title, uploader, duration, url, thumbnail }].
 * The text goes after "--" inside a ytsearch URL, so it can never be an option.
 */
async function searchVideos(ytdlp, query, { limit = 8, signal, settings } = {}) {
  const text = String(query ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200)
  if (!text) throw new YoinksError({ code: 'bad-request', message: 'Type something to search for.' })
  const result = await run(ytdlp, [...UTF8, '-J', '--flat-playlist', '--no-warnings', ...cookieArgs(settings), '--', `ytsearch${limit}:${text}`], { signal })
  if (result.code !== 0) throw fromYtdlp(result.stderr, 'The search failed.')
  let info
  try {
    info = JSON.parse(result.stdout)
  } catch {
    throw new YoinksError({ code: 'unknown', message: 'Could not read the search results.', retryable: true })
  }
  return (info.entries ?? [])
    .filter(entry => entry?.id)
    .map(entry => ({
      title: entry.title ?? 'Untitled',
      uploader: entry.uploader ?? entry.channel ?? null,
      duration: entry.duration ?? null,
      url: /^https:\/\//.test(entry.url ?? '') ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`,
      thumbnail: (entry.thumbnails ?? []).map(t => t?.url).filter(u => typeof u === 'string' && u.startsWith('https://')).at(-1) ?? null,
    }))
}

// ---------- watched channels ----------

/** The newest uploads of a channel or playlist link: { title, entries: [{ id, title, url }] }. */
async function listUploads(ytdlp, rawUrl, { limit = 15, signal, settings } = {}) {
  let url = String(rawUrl ?? '')
  if (!/^https?:\/\//.test(url)) throw new YoinksError({ code: 'bad-request', message: 'That is not a link.' })
  // A bare YouTube channel link lists its tabs, not its videos.
  url = url.replace(/^(https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+))\/?(?:[?#].*)?$/, '$1/videos')
  const result = await run(ytdlp, [...UTF8, '-J', '--flat-playlist', '--no-warnings', '--playlist-end', String(limit), ...cookieArgs(settings), '--', url], { signal })
  if (result.code !== 0) throw fromYtdlp(result.stderr, 'Could not read that channel.')
  let info
  try {
    info = JSON.parse(result.stdout)
  } catch {
    throw new YoinksError({ code: 'unknown', message: 'Could not read that channel.', retryable: true })
  }
  if (!Array.isArray(info.entries)) throw new YoinksError({ code: 'not-a-list', message: 'That link is a single video. Watch a channel or playlist link instead.' })
  const entries = info.entries
    .filter(entry => entry?.id)
    .map(entry => ({
      id: String(entry.id).slice(0, 80),
      title: String(entry.title ?? 'Untitled').slice(0, 200),
      url: /^https:\/\//.test(entry.url ?? '') ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`,
    }))
  return { title: String(info.title ?? info.uploader ?? url).slice(0, 80), entries }
}

// ---------- convert a local file ----------

const CONVERT_TARGETS = {
  mp3: { ext: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '0'] },
  m4a: { ext: 'm4a', args: ['-vn', '-c:a', 'aac', '-b:a', '256k'] },
  flac: { ext: 'flac', args: ['-vn', '-c:a', 'flac'] },
  opus: { ext: 'opus', args: ['-vn', '-c:a', 'libopus', '-b:a', '160k'] },
  mp4: { ext: 'mp4', args: ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
}
function lastLines(text, n = 3) {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim())
    .slice(-n)
    .join(' ')
}

const CONVERTIBLE = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.mp3', '.m4a', '.opus', '.ogg', '.wav', '.flac', '.aac', '.wma'])

/**
 * Convert a local media file with ffmpeg into `outDir`, next to nothing else
 * of ours. Resolves the new file's path; rejects a YoinksError.
 * onProgress({ downloadedBytes, totalBytes }) carries microseconds done / total.
 */
function convertFile({ ffmpeg, input, outDir, target, onProgress, signal }) {
  const spec = CONVERT_TARGETS[target]
  if (!spec) return Promise.reject(new YoinksError({ code: 'bad-request', message: 'Pick a format to convert to.' }))
  const base = path.basename(input, path.extname(input))
  let output = path.join(outDir, `${base}.${spec.ext}`)
  for (let n = 1; require('node:fs').existsSync(output) || output === input; n++) output = path.join(outDir, `${base} (${n}).${spec.ext}`)
  const args = ['-hide_banner', '-nostdin', '-n', '-i', input, ...spec.args, '-progress', 'pipe:1', '-nostats', output]
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnKillable(ffmpeg ?? 'ffmpeg', args, { signal })
    } catch {
      reject(new YoinksError({ code: 'cancelled', message: 'Conversion cancelled.' }))
      return
    }
    activeChildren.add(child)
    let total = null
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (total === null) {
        const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
        if (m) total = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1_000_000
      }
    })
    child.stdout.on('data', chunk => {
      const m = /out_time_us=(\d+)/g
      let last = null
      for (let x = m.exec(chunk); x; x = m.exec(chunk)) last = Number(x[1])
      if (last !== null) onProgress?.({ downloadedBytes: last, totalBytes: total ?? undefined })
    })
    child.on('error', err => reject(err.code === 'ENOENT' ? new YoinksError(Errors.friendly('ffmpeg not found')) : fromYtdlp(err.message)))
    child.on('close', code => {
      activeChildren.delete(child)
      if (signal?.aborted) {
        require('node:fs').rm(output, { force: true }, () => {})
        reject(new YoinksError({ code: 'cancelled', message: 'Conversion cancelled.' }))
      } else if (code === 0) resolve(output)
      else reject(new YoinksError(Errors.friendly(lastLines(stderr) || 'The conversion failed.')))
    })
  })
}

// ---------- format choices ----------

const MAX_VIDEO_CHOICES = 8

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`
}


/**
 * The format list shown to the user: one entry per video height plus audio.
 * Entries are plain data ({kind, height, label, ext, sizeLabel}); the
 * yt-dlp arguments are built later by buildArgs() from the chosen entry.
 */
function buildChoices(info, { audioFormat = 'mp3' } = {}) {
  const audio = { kind: 'audio', label: 'Audio only', ext: audioFormat, sizeLabel: '' }
  if (info._type === 'playlist') {
    return [
      { kind: 'video', label: 'Best', ext: 'mp4', sizeLabel: '' },
      ...[1080, 720, 480].map(height => ({ kind: 'video', label: `${height}p`, height, ext: 'mp4', sizeLabel: 'max' })),
      audio,
    ]
  }

  const formats = info.formats ?? []
  const audioOnly = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
  const bestAudio = [...audioOnly].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]
  const audioSize = bestAudio?.filesize ?? bestAudio?.filesize_approx

  const videos = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
  const heights = [...new Set(videos.map(f => f.height))].sort((a, b) => b - a)
  const choices = heights.slice(0, MAX_VIDEO_CHOICES).map(height => {
    // yt-dlp lists formats worst to best, so the last one at this height is
    // the one "bv*[height=h]" downloads. No size known: show none rather
    // than the audio track's size alone.
    const best = videos.filter(f => f.height === height).at(-1)
    const muxed = best.acodec && best.acodec !== 'none'
    const videoSize = best.filesize ?? best.filesize_approx ?? 0
    const size = videoSize > 0 ? videoSize + (muxed ? 0 : (audioSize ?? 0)) : 0
    return { kind: 'video', label: `${height}p`, height, exact: true, ext: 'mp4', sizeLabel: size > 0 ? formatBytes(size) : '' }
  })
  if (choices.length === 0 && formats.some(f => f.vcodec && f.vcodec !== 'none')) {
    choices.push({ kind: 'video', label: 'Best available', ext: 'mp4', sizeLabel: '' })
  }
  audio.sizeLabel = audioSize ? formatBytes(audioSize) : ''
  choices.push(audio)
  return choices
}

// ---------- arguments ----------

const AUDIO_SELECTORS = { mp3: 'ba/b', m4a: 'ba[ext=m4a]/ba/b', flac: 'ba/b', opus: 'ba[acodec=opus]/ba/b' }

// Cover art from music sites is often a 16:9 frame with bars: crop it square.
const SQUARE_COVER = ['--ppa', `ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`]

function formatArgs(choice, settings) {
  if (choice.kind === 'audio') {
    const quality = settings.audioFormat === 'flac' || settings.audioBitrate === 'best' ? '0' : `${settings.audioBitrate}K`
    return ['-f', AUDIO_SELECTORS[settings.audioFormat] ?? 'ba/b', '-x', '--audio-format', settings.audioFormat, '--audio-quality', quality]
  }
  if (!choice.height) return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4']
  const h = choice.height
  const selector = choice.exact ? `bv*[height=${h}]+ba/b[height=${h}]/bv*[height<=${h}]+ba/b` : `bv*[height<=${h}]+ba/b[height<=${h}]/b`
  return ['-f', selector, '--merge-output-format', 'mp4']
}

/**
 * All yt-dlp arguments for one download, from validated settings.
 * @param {object} p
 * @param {object} p.choice     entry from buildChoices()
 * @param {object} p.settings   validated settings (core/settings-store)
 * @param {string} p.outDir
 * @param {boolean} [p.playlist]  a whole playlist/album
 * @param {boolean} [p.music]     music site: clean tags, square cover
 * @param {{start:number,end:number|null}} [p.clip]
 * @param {string[]} [p.siteArgs] per-site extras from shared/sites.js
 * @param {boolean} [p.forceTags] always embed tags + cover (Spotify)
 * @param {number[]|null} [p.items] playlist entries to take (1-based); null = all
 */
function buildArgs({ choice, settings, outDir, playlist = false, music = false, clip = null, siteArgs = [], forceTags = false, items = null }) {
  const args = [...formatArgs(choice, settings)]
  const isAudio = choice.kind === 'audio'

  if (clip) args.push('--download-sections', `*${clip.start}-${clip.end ?? 'inf'}`, '--force-keyframes-at-cuts')
  if (settings.embedMetadata || forceTags) args.push('--embed-metadata')
  if (settings.embedThumbnail || forceTags) {
    args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg')
    if (music || isAudio) args.push(...SQUARE_COVER)
  }
  if (music) args.push('--replace-in-metadata', 'uploader,channel,artist,album_artist', ' - Topic$', '')
  if (settings.embedSubs && !isAudio) {
    const langs = settings.subsLang === 'all' ? 'all,-live_chat' : `${settings.subsLang}.*,${settings.subsLang},-live_chat`
    args.push('--embed-subs', '--sub-langs', langs)
  }
  if (settings.speedLimit > 0) args.push('--limit-rate', `${settings.speedLimit}M`)
  if (playlist && items?.length) args.push('--playlist-items', items.join(','))
  if (settings.splitChapters && !clip) {
    // One file per chapter in a folder next to the full file.
    args.push('--split-chapters', '-o', `chapter:${path.join(outDir, '%(title).100B', '%(section_number)03d - %(section_title).100B.%(ext)s')}`)
  }
  args.push(...cookieArgs(settings), ...siteArgs)

  let template = Template.toYtdlp(settings.filenameTemplate, { playlist, folder: settings.playlistFolder, numbered: settings.playlistNumbered, folderBy: settings.folderBy })
  if (clip) template = template.replace(/\.%\(ext\)s$/, ` (clip ${clockLabel(clip.start)}-${clip.end === null ? 'end' : clockLabel(clip.end)}).%(ext)s`)
  args.push('-o', path.join(outDir, template))
  return args
}

function clockLabel(seconds) {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

// ---------- download ----------

const PROGRESS_PREFIX = 'YOINK|'
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`
const PROCESSING_LINE = /^\[(Merger|ExtractAudio|EmbedThumbnail|EmbedSubtitle|Metadata|ThumbnailsConvertor|FixupM4a|FixupM3u8|MetadataParser|ModifyChapters|SplitChapters)\]/

const activeChildren = new Set()
process.on('exit', () => activeChildren.forEach(child => killTree(child, { sync: true })))

/**
 * Run one download.
 * opts: { ytdlp, ffmpeg, url | infoJsonPath, playlist, args }
 * handlers: onProgress, onProcessing, onItem({index, count})
 * Abort `signal` with reason 'pause' to stop but keep partial files (the
 * next run resumes them); any other abort deletes them.
 * Resolves the final file path; rejects a YoinksError (code 'paused' /
 * 'cancelled' when stopped on purpose).
 */
function download(opts, handlers, signal) {
  const source = opts.playlist
    ? ['--yes-playlist', '--', opts.url]
    : ['--no-playlist', ...(opts.infoJsonPath ? ['--load-info-json', opts.infoJsonPath] : ['--', opts.url])]
  const args = [
    ...UTF8,
    ...opts.args,
    '--no-warnings',
    '--newline',
    // --print implies --quiet, which would hide the lines progress is read from
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_TEMPLATE}`,
    '--print',
    'after_move:filepath',
    '--no-simulate',
    ...(opts.ffmpeg ? ['--ffmpeg-location', opts.ffmpeg] : []),
    // Options must come before "--"; the link (if any) is last.
    ...source,
  ]

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnKillable(opts.ytdlp, args, { signal })
    } catch (err) {
      reject(signal?.aborted ? new YoinksError({ code: 'cancelled', message: 'Download cancelled.' }) : fromYtdlp(err.message))
      return
    }
    activeChildren.add(child)

    let stderr = ''
    let filepath = ''
    let part = 0
    let totalParts = 1
    let lastDownloaded = 0
    let buffer = ''
    const destinations = []

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith(PROGRESS_PREFIX)) {
          const [downloaded, total, totalEstimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).split('|')
          const downloadedBytes = toNumber(downloaded) ?? 0
          if (downloadedBytes < lastDownloaded) part++
          lastDownloaded = downloadedBytes
          handlers.onProgress?.({
            downloadedBytes,
            totalBytes: toNumber(total) ?? toNumber(totalEstimate),
            speed: toNumber(speed),
            eta: toNumber(eta),
            part,
            totalParts,
          })
        } else if (/^\[download\] Downloading item \d+ of \d+/.test(line)) {
          const [, index, count] = /item (\d+) of (\d+)/.exec(line)
          part = 0
          totalParts = 1
          lastDownloaded = 0
          handlers.onItem?.({ index: Number(index), count: Number(count) })
        } else if (line.includes('Downloading 1 format(s):')) {
          totalParts = (line.split('format(s):')[1] ?? '').trim().split('+').length
        } else if (PROCESSING_LINE.test(line)) {
          const target = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1] ?? /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1]
          if (target) destinations.push(target)
          handlers.onProcessing?.()
        } else if (line.startsWith('[download] Destination: ')) {
          destinations.push(line.slice('[download] Destination: '.length))
        } else if (/^\[info\] Writing video thumbnail .+ to: /.test(line)) {
          // The thumbnail is saved (then converted to .jpg) before the video.
          const thumb = line.slice(line.indexOf(' to: ') + ' to: '.length)
          destinations.push(thumb, thumb.replace(/\.[^.\\/]+$/, '.jpg'))
        } else if (path.isAbsolute(line)) {
          filepath = line
        }
      }
    })
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', err => {
      if (!signal?.aborted) reject(fromYtdlp(err.message))
    })
    child.on('close', code => {
      activeChildren.delete(child)
      if (signal?.aborted) {
        const paused = signal.reason === 'pause'
        // Paused: keep .part files so yt-dlp continues where it stopped.
        if (!paused) void removePartials(destinations)
        reject(new YoinksError(paused ? { code: 'paused', message: 'Paused.' } : { code: 'cancelled', message: 'Download cancelled.' }))
        return
      }
      // A playlist keeps going past entries that fail; report what was saved.
      if (filepath && (code === 0 || opts.playlist)) resolve(filepath)
      else reject(fromYtdlp(stderr, `Download failed (yt-dlp exit code ${code}).`))
    })
  })
}

function removePartials(destinations) {
  return Promise.allSettled(
    destinations.flatMap(dest => [dest, `${dest}.part`, `${dest}.ytdl`]).map(file => fs.rm(file, { force: true })),
  )
}

function toNumber(value) {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

module.exports = {
  listUploads,
  YoinksError,
  ensureYtDlp,
  versionInfo,
  updateNow,
  findFfmpeg,
  ffmpegInfo,
  probe,
  writeInfoJson,
  searchMusic,
  searchVideos,
  convertFile,
  CONVERT_TARGETS,
  CONVERTIBLE,
  buildChoices,
  pickChoice,
  buildArgs,
  download,
  formatBytes,
}
