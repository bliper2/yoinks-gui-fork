'use strict'

// One conversation with the download engine. The browser helper (host.js)
// runs one Session per native-messaging port; the desktop app runs them
// in-process. Same messages, same checks, either way.
//
// Job messages (a session holds one video/playlist/Spotify link):
//   probe {url, playlist?}   -> status…, probed
//   download {index, clip?} | {selections}  -> item/progress/processing…, done
//   pause | cancel           -> paused | cancelled
// One-shot requests (reply once):
//   settings:get | settings:set {patch} | settings:reset | settings:import {data}
//   folder:pick | file:reveal {filepath} | file:open {filepath}
//   ytdlp:version | ytdlp:update
// Errors reply { type: 'error', code, message, retryable }.
//
// Trust: choices, matches and file paths are held here and picked by index;
// the caller never passes yt-dlp arguments. Links must be http(s).

const fs = require('node:fs')
const path = require('node:path')

const ytdlp = require('../main/ytdlp')
const store = require('./settings-store')
const files = require('./files')
const spotify = require('./spotify')
const Schema = require('../extension/shared/settings-schema.js')
const Sites = require('../extension/shared/sites.js')
const Errors = require('../extension/shared/errors.js')

// An old yt-dlp cannot read a site that changed: it says "unable to extract",
// HTTP 403, or (Instagram) "login required". Update it once and try again;
// a really private post fails the same way the second time.
const RETRY_AFTER_UPDATE = new Set(['outdated', 'forbidden', 'login'])
const AUTO_UPDATE_EVERY_MS = 30 * 60 * 1000
let lastAutoUpdate = 0

class Session {
  /**
   * @param {(message: object) => void} send
   * @param {{ pickFolder?: (current: string) => Promise<string|null> }} [options]
   */
  constructor(send, { pickFolder = files.pickFolder } = {}) {
    this.send = send
    this.pickFolder = pickFolder
    this.abort = null
    this.bins = null
    this.probed = null // media: {url, playlist, infoJsonPath, choices, site}; spotify: {entity, matches, done:Set}
    this.tempFiles = new Set()
  }

  async handle(message) {
    try {
      await this.route(message ?? {})
    } catch (err) {
      this.send(errorReply(err))
    }
  }

  async route(message) {
    switch (message.type) {
      case 'probe':
        return this.probe(message.url, message.playlist === true)
      case 'download':
        return this.probed?.kind === 'spotify' ? this.downloadSpotify(message.selections) : this.downloadMedia(message.index, message.clip)
      case 'pause':
        return this.abort?.abort('pause')
      case 'cancel':
        return this.abort?.abort('cancel')

      case 'settings:get':
        return this.send({ type: 'settings', settings: store.load(), errors: {} })
      case 'settings:set': {
        const { settings, errors } = store.update(message.patch)
        return this.send({ type: 'settings', settings, errors })
      }
      case 'settings:reset':
        return this.send({ type: 'settings', settings: store.reset(), errors: {} })
      case 'settings:import': {
        const { settings, errors } = store.importAll(message.data)
        return this.send({ type: 'settings', settings, errors })
      }
      case 'folder:pick': {
        const chosen = await this.pickFolder(store.outDir())
        const { settings, errors } = chosen ? store.update({ outDir: chosen }) : { settings: store.load(), errors: {} }
        return this.send({ type: 'settings', settings, errors })
      }
      case 'file:reveal':
        files.reveal(message.filepath)
        return this.send({ type: 'ok' })
      case 'file:open':
        files.open(message.filepath)
        return this.send({ type: 'ok' })
      case 'ytdlp:version':
        return this.send({ type: 'ytdlp', ...(await ytdlp.versionInfo()) })
      case 'ytdlp:update':
        return this.send({ type: 'ytdlp', ...(await ytdlp.updateNow()) })
      default:
        throw new ytdlp.YoinksError({ code: 'bad-request', message: `Unknown request: ${String(message.type).slice(0, 40)}` })
    }
  }

  /** Stop everything and delete temp files (port closed / app quitting). */
  close() {
    this.abort?.abort('cancel')
    for (const file of this.tempFiles) fs.rmSync(file, { force: true })
    this.tempFiles.clear()
  }

  // ---------- shared plumbing ----------

  settings() {
    const settings = store.load()
    if (settings.termsAccepted < Schema.TERMS_VERSION) {
      throw new ytdlp.YoinksError({ code: 'terms', message: 'Please read and accept the terms first (Settings → Terms).' })
    }
    return settings
  }

  async binaries(signal, settings) {
    if (!this.bins) {
      const status = message => this.send({ type: 'status', message })
      this.bins = {
        ytdlp: await ytdlp.ensureYtDlp(status, signal, { autoUpdate: settings.ytdlpAutoUpdate }),
        ffmpeg: await ytdlp.findFfmpeg(),
      }
    }
    return this.bins
  }

  /** Run `step`; if yt-dlp looks out of date, update it (when allowed) and run `step` once more. */
  async retryWithUpdate(settings, step) {
    try {
      return await step()
    } catch (err) {
      if (!RETRY_AFTER_UPDATE.has(err?.code) || !settings.ytdlpAutoUpdate) throw err
      if (Date.now() - lastAutoUpdate < AUTO_UPDATE_EVERY_MS) throw err
      lastAutoUpdate = Date.now()
      const before = await ytdlp.versionInfo()
      if (!before.version || !before.managed) throw err // a system yt-dlp is not ours to update
      this.send({ type: 'status', message: 'Updating yt-dlp…' })
      const after = await ytdlp.updateNow().catch(() => null)
      if (!after || after.version === before.version) throw err
      return step()
    }
  }

  /** Run `work` with a fresh abort controller; turn pause/cancel into replies. */
  async withAbort(work) {
    const controller = (this.abort = new AbortController())
    try {
      await work(controller.signal)
    } catch (err) {
      if (err?.code === 'paused' || controller.signal.reason === 'pause') this.send({ type: 'paused' })
      else if (controller.signal.aborted) this.send({ type: 'cancelled' })
      else throw err
    } finally {
      if (this.abort === controller) this.abort = null
    }
  }

  track(file) {
    this.tempFiles.add(file)
    return file
  }

  // ---------- probe ----------

  async probe(rawUrl, wantPlaylist) {
    const url = validUrl(rawUrl)
    if (!url) throw new ytdlp.YoinksError({ code: 'bad-link', message: 'That is not a web link.' })
    const settings = this.settings()
    if (Sites.isSpotify(url)) return this.probeSpotify(url, settings)

    const site = Sites.siteFor(url)
    const playlist = wantPlaylist || Sites.isPlaylistLink(url)
    await this.withAbort(async signal => {
      const { ytdlp: bin } = await this.binaries(signal, settings)
      this.send({ type: 'status', message: playlist ? 'Reading playlist…' : 'Looking up video…' })
      const { info, infoJsonPath } = await this.retryWithUpdate(settings, () => ytdlp.probe(bin, url, signal, { playlist, settings }))
      this.track(infoJsonPath)
      const isPlaylist = info._type === 'playlist'
      const choices = ytdlp.buildChoices(info, { audioFormat: settings.audioFormat })
      this.probed = { kind: 'media', url, playlist: isPlaylist, infoJsonPath: isPlaylist ? null : infoJsonPath, choices, site }
      this.send({
        type: 'probed',
        kind: 'media',
        title: info.title ?? url,
        uploader: (info.artist ?? info.uploader ?? info.channel ?? '').replace(/ - Topic$/, '') || null,
        duration: info.duration ?? null,
        thumbnail: typeof info.thumbnail === 'string' && info.thumbnail.startsWith('https://') ? info.thumbnail : null,
        playlistCount: isPlaylist ? (info.entries?.length ?? info.playlist_count ?? null) : null,
        site: site?.id ?? null,
        music: Boolean(site?.music),
        choices,
        // What "default format" means for this link: music sites default to audio.
        defaultIndex: ytdlp.pickChoice(choices, site?.music ? 'audio' : settings.defaultFormat),
      })
    })
  }

  async probeSpotify(url, settings) {
    await this.withAbort(async signal => {
      this.send({ type: 'status', message: 'Reading Spotify…' })
      const entity = await spotify.lookup(url, signal)
      const { ytdlp: bin } = await this.binaries(signal, settings)
      this.send({ type: 'status', message: entity.tracks.length === 1 ? 'Finding it on YouTube Music…' : `Finding songs on YouTube Music (0/${entity.tracks.length})…` })
      const matches = await spotify.findMatches(bin, entity.tracks, {
        signal,
        settings,
        onProgress: (done, total) => total > 1 && this.send({ type: 'status', message: `Finding songs on YouTube Music (${done}/${total})…` }),
      })
      this.probed = { kind: 'spotify', url, entity, matches, done: new Set() }
      this.send({
        type: 'probed',
        kind: 'spotify',
        title: entity.title,
        uploader: entity.artists.join(', ') || null,
        spotifyType: entity.type,
        thumbnail: entity.cover,
        tracks: entity.tracks.map((track, i) => ({
          title: track.title,
          artists: track.artists,
          durationMs: track.durationMs,
          candidates: matches[i].map(({ title, artist, album, duration, confidence, level }) => ({ title, artist, album, duration, confidence, level })),
        })),
      })
    })
  }

  // ---------- download ----------

  async downloadMedia(index, rawClip) {
    const probed = this.probed
    const choice = probed?.kind === 'media' ? probed.choices[index] : null
    if (!choice) throw new ytdlp.YoinksError({ code: 'bad-request', message: 'Pick a format first.' })
    const settings = this.settings()
    const clip = rawClip && !probed.playlist ? validClip(rawClip) : null
    const outDir = store.outDir(settings)
    const args = ytdlp.buildArgs({
      choice,
      settings,
      outDir,
      playlist: probed.playlist,
      music: Boolean(probed.site?.music),
      clip,
      siteArgs: probed.site?.extraArgs ?? [],
    })

    await this.withAbort(async signal => {
      const bins = await this.binaries(signal, settings)
      const filepath = await this.retryWithUpdate(settings, () =>
        ytdlp.download(
          { ytdlp: bins.ytdlp, ffmpeg: bins.ffmpeg, url: probed.url, infoJsonPath: probed.infoJsonPath, playlist: probed.playlist, args },
          this.progressHandlers(),
          signal,
        ),
      )
      this.send({ type: 'done', filepath, folder: probed.playlist && settings.playlistFolder ? path.dirname(filepath) : null })
    })
  }

  async downloadSpotify(rawSelections) {
    const probed = this.probed
    const { entity, matches } = probed
    if (!Array.isArray(rawSelections) || rawSelections.length !== entity.tracks.length) {
      throw new ytdlp.YoinksError({ code: 'bad-request', message: 'Choose a match for each song.' })
    }
    // Each selection is an index into that track's candidates, or -1 to skip.
    const picks = rawSelections.map((s, i) => (Number.isInteger(s) && s >= 0 && s < matches[i].length ? s : -1))
    const wanted = picks.map((pick, i) => ({ pick, i })).filter(({ pick }) => pick >= 0)
    if (!wanted.length) throw new ytdlp.YoinksError({ code: 'bad-request', message: 'No songs selected.' })

    const settings = this.settings()
    const outDir = store.outDir(settings)
    const isList = entity.type !== 'track'
    const args = ytdlp.buildArgs({ choice: { kind: 'audio' }, settings, outDir, playlist: isList, music: true, forceTags: true })
    const failures = []
    let lastFile = null

    await this.withAbort(async signal => {
      const bins = await this.binaries(signal, settings)
      for (const [n, { pick, i }] of wanted.entries()) {
        if (probed.done.has(i)) continue // finished before a pause
        const track = entity.tracks[i]
        this.send({ type: 'item', item: { index: n + 1, count: wanted.length, title: track.title } })
        try {
          const details = entity.type === 'playlist' ? await spotify.trackDetails(track.id, signal) : { cover: entity.cover, year: entity.year }
          const { info, infoJsonPath } = await ytdlp.probe(bins.ytdlp, matches[i][pick].url, signal, { settings })
          fs.rmSync(infoJsonPath, { force: true })
          const patched = spotify.applyMetadata(info, { track, entity, index: i, cover: details.cover ?? entity.cover, year: details.year ?? entity.year })
          const patchedPath = this.track(await ytdlp.writeInfoJson(patched))
          lastFile = await ytdlp.download({ ytdlp: bins.ytdlp, ffmpeg: bins.ffmpeg, infoJsonPath: patchedPath, args }, this.progressHandlers(), signal)
          probed.done.add(i)
        } catch (err) {
          if (signal.aborted) throw err
          failures.push(`${track.title}: ${err.message}`)
        }
      }
      if (!lastFile && failures.length) throw new ytdlp.YoinksError({ code: 'unknown', message: failures[0], retryable: true })
      this.send({
        type: 'done',
        filepath: lastFile,
        folder: isList && settings.playlistFolder ? path.dirname(lastFile) : null,
        warning: failures.length ? `${failures.length} song${failures.length === 1 ? '' : 's'} could not be downloaded.` : null,
      })
    })
  }

  progressHandlers() {
    return {
      onProgress: progress => this.send({ type: 'progress', progress }),
      onProcessing: () => this.send({ type: 'processing' }),
      onItem: item => this.send({ type: 'item', item }),
    }
  }
}

// ---------- validation ----------

function validUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}

function validClip(clip) {
  const start = Number(clip.start ?? 0)
  const end = clip.end == null ? null : Number(clip.end)
  if (!Number.isFinite(start) || start < 0) throw new ytdlp.YoinksError({ code: 'bad-clip', message: 'The clip start is not a valid time.' })
  if (end !== null && (!Number.isFinite(end) || end <= start)) throw new ytdlp.YoinksError({ code: 'bad-clip', message: 'The clip has to end after it starts.' })
  return { start, end }
}

// Anything that isn't already a friendly YoinksError (fs errors, bugs) is
// still translated, so raw stack-ish text never reaches the user.
function errorReply(err) {
  const e = err instanceof ytdlp.YoinksError ? err : Errors.friendly(err?.message ?? String(err))
  return { type: 'error', code: e.code ?? 'unknown', message: e.message || 'Something went wrong.', retryable: Boolean(e.retryable) }
}

module.exports = { Session }
