/*
 * The download queue and everything the UI can ask for, independent of where
 * it runs. The extension's background worker and the desktop app's main
 * process each create one controller and plug in:
 *   backend.connect(handlers) -> { post(message), close() }   one job session
 *   backend.request(message)  -> Promise<reply>               one-shot request
 *   storage.load() / storage.save(partial)                     history + settings cache
 *   notify({ id, title, message, target })                     system notification
 *   onState(view)                                              push state to the UI
 *   onJobUpdate(job)                                           page buttons (optional)
 * Session messages are defined in core/session.js.
 *
 * Plain script (background.js importScripts) / CommonJS (Electron main).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./settings-schema.js'), require('./formats.js'), require('./sites.js'))
  } else root.YoinksController = factory(root.YoinksSettings, root.YoinksFormats, root.YoinksSites)
})(typeof self !== 'undefined' ? self : this, function (Schema, Formats, Sites) {
  'use strict'

  const HISTORY_LIMIT = 50
  const RETRY_DELAY_MS = 3000
  const TOAST_LIMIT = 4

  // Phases of a job:
  //   probing     looking the link up (auto jobs hold a queue slot)
  //   choices     looked up, waiting for the user to pick (the "lookup" card)
  //   lookup-error the lookup card's link failed
  //   review      a queued Spotify link waiting for the user to confirm matches
  //   queued      waiting for a free slot
  //   downloading
  //   paused
  //   failed
  //   cancelling  stopping; hidden from the UI
  const LOOKUP_PHASES = ['probing', 'choices', 'lookup-error']

  function create({ backend, storage, notify = () => {}, onState = () => {}, onJobUpdate = () => {}, platform = 'extension' }) {
    const jobs = new Map()
    let nextId = 1
    let settings = Schema.defaults()
    let settingsLoaded = false
    let settingsErrors = {}
    let history = []
    let ytdlpInfo = { version: null, managed: true, busy: false, message: '' }
    let toasts = []
    let toastId = 1
    let hostProblem = null

    // ---------- state out ----------

    function publicJob(job) {
      const { channel, retryTimer, ...rest } = job
      return rest
    }

    function view() {
      const all = [...jobs.values()].filter(job => job.phase !== 'cancelling')
      const lookup = all.find(job => job.focus)
      return {
        ready: settingsLoaded,
        platform,
        settings,
        settingsErrors,
        termsVersion: Schema.TERMS_VERSION,
        ytdlp: ytdlpInfo,
        hostProblem,
        lookup: lookup ? publicJob(lookup) : null,
        queue: all.filter(job => !job.focus).map(publicJob),
        history,
        toasts,
      }
    }

    let timer = null
    function broadcast() {
      clearTimeout(timer)
      timer = null
      onState(view())
    }
    // Progress arrives many times a second; the UI needs a few frames.
    function broadcastSoon() {
      timer ??= setTimeout(broadcast, 200)
    }

    function jobChanged(job) {
      if (job.source) onJobUpdate(publicJob(job))
    }

    function toast(kind, text) {
      toasts = [...toasts, { id: toastId++, kind, text }].slice(-TOAST_LIMIT)
    }

    // ---------- storage ----------

    const ready = (async () => {
      const saved = (await storage.load()) ?? {}
      history = Array.isArray(saved.history) ? saved.history : []
      if (saved.settings) settings = Schema.sanitize(saved.settings)
      await refreshSettings()
      broadcast()
    })()

    async function refreshSettings() {
      try {
        const reply = await backend.request({ type: 'settings:get' })
        applySettings(reply)
        hostProblem = null
      } catch (err) {
        hostProblem = err.message
      }
    }

    function applySettings(reply) {
      const before = settings.concurrency
      settings = reply.settings
      settingsErrors = reply.errors ?? {}
      settingsLoaded = true
      storage.save({ settings })
      if (settings.concurrency > before) pump()
    }

    function saveHistory() {
      storage.save({ history })
    }

    // ---------- jobs ----------

    function newJob(url, fields) {
      const job = {
        id: nextId++,
        url,
        createdAt: Date.now(),
        attempts: 0,
        probed: false,
        focus: false,
        wantPlaylist: false,
        wantFormat: null, // auto jobs: 'best' | '1080' | … | 'audio'
        clip: null,
        phase: 'queued',
        ...fields,
      }
      jobs.set(job.id, job)
      return job
    }

    function removeJob(job) {
      clearTimeout(job.retryTimer)
      jobs.delete(job.id)
      closeChannel(job)
      job.phase = 'removed'
      jobChanged(job)
    }

    function closeChannel(job) {
      const channel = job.channel
      job.channel = null
      job.probed = false
      channel?.close()
    }

    function openChannel(job) {
      if (job.channel) return job.channel
      const channel = backend.connect({
        onMessage: message => onMessage(job, message),
        onClose: reason => onClosed(job, channel, reason),
      })
      job.channel = channel
      return channel
    }

    // The session died without us closing it (helper crashed or missing).
    function onClosed(job, channel, reason) {
      if (job.channel !== channel) return
      job.channel = null
      job.probed = false
      if (job.phase === 'cancelling') return removeJob(job)
      if (['probing', 'downloading'].includes(job.phase)) {
        // A missing helper won't appear by retrying; a crash might be a one-off.
        fail(job, { code: 'host', message: reason || 'The Yoinks helper stopped unexpectedly.', retryable: !/not installed/i.test(reason ?? '') })
        broadcast()
      }
    }

    function activeCount() {
      return [...jobs.values()].filter(job => job.phase === 'downloading' || (job.phase === 'probing' && !job.focus)).length
    }

    // Start queued jobs while there are free slots.
    function pump() {
      const now = Date.now()
      const waiting = [...jobs.values()]
        .filter(job => job.phase === 'queued' && !(job.retryAt > now))
        .sort((a, b) => a.createdAt - b.createdAt)
      for (const job of waiting) {
        if (activeCount() >= settings.concurrency) break
        start(job)
      }
      broadcast()
    }

    function start(job) {
      job.error = null
      if (!job.probed) {
        job.phase = 'probing'
        job.status = 'Looking up…'
        openChannel(job).post({ type: 'probe', url: job.url, playlist: job.wantPlaylist })
      } else {
        job.phase = 'downloading'
        job.progress = null
        job.processing = false
        job.channel.post(
          job.kind === 'spotify'
            ? { type: 'download', selections: job.selections }
            : { type: 'download', index: job.choiceIndex, clip: job.clip },
        )
      }
      jobChanged(job)
    }

    function chooseFormat(job, index, clip = null) {
      const choice = job.choices?.[index]
      if (!choice) return false
      Object.assign(job, {
        choiceIndex: index,
        choiceLabel: choice.label,
        choiceKind: choice.kind,
        wantFormat: Formats.formatOf(choice),
        clip,
      })
      return true
    }

    function onMessage(job, message) {
      if (!jobs.has(job.id)) return
      switch (message.type) {
        case 'status':
          job.status = message.message
          break
        case 'probed':
          return onProbed(job, message)
        case 'item':
          job.item = message.item
          job.progress = null
          job.processing = false
          jobChanged(job)
          return broadcastSoon()
        case 'progress':
          job.progress = message.progress
          job.processing = false
          jobChanged(job)
          return broadcastSoon()
        case 'processing':
          job.processing = true
          jobChanged(job)
          break
        case 'done':
          return finish(job, message)
        case 'paused':
          job.phase = 'paused'
          jobChanged(job)
          return pump()
        case 'cancelled':
          removeJob(job)
          return pump()
        case 'error':
          return onError(job, message)
      }
      broadcast()
    }

    function onProbed(job, message) {
      job.probed = true
      Object.assign(job, {
        kind: message.kind,
        title: message.title,
        uploader: message.uploader,
        duration: message.duration ?? null,
        thumbnail: message.thumbnail ?? null,
        playlistCount: message.playlistCount ?? null,
        site: message.site ?? (message.kind === 'spotify' ? 'spotify' : null),
        music: message.music ?? message.kind === 'spotify',
        choices: message.choices ?? null,
        defaultIndex: message.defaultIndex ?? 0,
        spotifyType: message.spotifyType ?? null,
        tracks: message.tracks ?? null,
      })

      if (job.kind === 'spotify') {
        // Retrying after the helper restarted: reuse the picks already made.
        if (job.selections?.length === job.tracks.length) return beginDownload(job)
        job.phase = job.focus ? 'choices' : 'review'
        if (!job.focus) toast('info', `Check the matches for “${job.title}” in the queue.`)
        jobChanged(job)
        return pump()
      }

      if (job.focus) {
        // The lookup card: show formats unless "always use the default format".
        if (settings.alwaysUseFormat) {
          chooseFormat(job, job.defaultIndex)
          job.focus = false
          job.phase = 'queued'
          toast('info', `Added “${job.title}” (${job.choiceLabel}).`)
          return pump()
        }
        job.phase = 'choices'
        jobChanged(job)
        return broadcast()
      }

      // Batch / quick download: pick the wanted format and go.
      const index = job.wantFormat ? Formats.pickChoice(job.choices, job.wantFormat) : job.defaultIndex
      if (!chooseFormat(job, index, job.clip)) return fail(job, { code: 'format', message: 'No matching format for this link.', retryable: false })
      beginDownload(job)
    }

    function beginDownload(job) {
      // Already holding a slot from the lookup, so no queue wait.
      job.phase = 'queued'
      if (activeCount() < settings.concurrency) start(job)
      pump()
    }

    function onError(job, error) {
      if (job.phase === 'cancelling') return removeJob(job)
      if (job.phase === 'probing' && job.focus) {
        job.phase = 'lookup-error'
        job.error = error
        closeChannel(job)
        return broadcast()
      }
      fail(job, error)
      pump()
    }

    function fail(job, error) {
      // Network-type errors get automatic retries, up to the setting.
      if (error.retryable && job.attempts < settings.retries && job.phase !== 'choices') {
        job.attempts++
        job.phase = 'queued'
        job.error = error
        job.retryAt = Date.now() + RETRY_DELAY_MS * job.attempts
        job.status = `Retrying (${job.attempts}/${settings.retries})…`
        clearTimeout(job.retryTimer)
        job.retryTimer = setTimeout(pump, RETRY_DELAY_MS * job.attempts + 50)
        jobChanged(job)
        return
      }
      job.phase = 'failed'
      job.error = error
      if (error.code === 'host' || !job.channel) closeChannel(job)
      jobChanged(job)
      if (settings.notifications) notify({ id: `failed-${job.id}`, title: 'Download failed', message: `${job.title || job.url}\n${error.message}`, target: null })
    }

    function finish(job, { filepath, folder, warning }) {
      const entry = {
        id: `done-${Date.now()}-${job.id}`,
        title: job.title || filepath,
        filepath,
        folder: folder ?? null,
        url: job.url,
        kind: job.choiceKind ?? (job.kind === 'spotify' ? 'audio' : null),
        label: job.choiceLabel ?? (job.kind === 'spotify' ? 'Spotify' : null),
        at: Date.now(),
      }
      job.phase = 'done'
      jobChanged(job)
      removeJob(job)
      history = [entry, ...history].slice(0, HISTORY_LIMIT)
      saveHistory()
      toast(warning ? 'info' : 'success', warning ? `Yoinked “${entry.title}”. ${warning}` : `Yoinked “${entry.title}”.`)
      if (settings.notifications) notify({ id: entry.id, title: 'Yoinked', message: entry.title, target: entry.folder ?? entry.filepath })
      pump()
    }

    function focusedJob() {
      return [...jobs.values()].find(job => job.focus)
    }

    function dropFocused() {
      const current = focusedJob()
      if (!current) return
      if (LOOKUP_PHASES.includes(current.phase)) removeJob(current)
      else current.focus = false
    }

    // ---------- commands ----------

    function urlsFrom(text) {
      return [...new Set(String(text ?? '').match(/https?:\/\/[^\s<>"']+/g) ?? [])].slice(0, 500)
    }

    async function request(message, onReply) {
      try {
        const reply = await backend.request(message)
        onReply?.(reply)
        hostProblem = null
        return reply
      } catch (err) {
        toast('error', err.message)
        return null
      }
    }

    async function command(cmd) {
      await ready
      const job = cmd.id != null ? jobs.get(cmd.id) : null
      switch (cmd.type) {
        // --- the lookup card ---
        case 'lookup': {
          const url = urlsFrom(cmd.url)[0]
          if (!url) {
            toast('error', 'That does not look like a link.')
            break
          }
          dropFocused()
          const created = newJob(url, { focus: true, phase: 'probing', wantPlaylist: Boolean(cmd.playlist), source: cmd.source ?? null, status: 'Looking up…' })
          openChannel(created).post({ type: 'probe', url, playlist: created.wantPlaylist })
          break
        }
        case 'choose': {
          const current = focusedJob()
          if (current?.phase !== 'choices' || current.kind === 'spotify') return
          if (!chooseFormat(current, cmd.index, cmd.clip ?? null)) return
          current.focus = false
          current.phase = 'queued'
          if (cmd.remember) await command({ type: 'settings:set', patch: { defaultFormat: settingFormat(current.wantFormat), alwaysUseFormat: true } })
          return pump()
        }
        case 'chooseMatches': {
          const current = focusedJob()
          if (current?.phase !== 'choices' || current.kind !== 'spotify') return
          if (!Array.isArray(cmd.selections) || cmd.selections.length !== current.tracks.length) return
          current.selections = cmd.selections.map(n => (Number.isInteger(n) ? n : -1))
          current.choiceLabel = 'Spotify → audio'
          current.choiceKind = 'audio'
          current.focus = false
          current.phase = 'queued'
          return pump()
        }
        case 'closeLookup':
          dropFocused()
          break
        case 'review':
          if (job?.phase !== 'review') return
          dropFocused()
          job.focus = true
          job.phase = 'choices'
          break

        // --- adding without the format list ---
        case 'quick': {
          // Page buttons / context menu: 'best' | '1080' | 'audio' | 'playlist' | 'clip'
          const url = urlsFrom(cmd.url)[0]
          if (!url) return
          const explicit = Schema.FORMATS.some(([key]) => key === cmd.format)
          const format = explicit ? cmd.format : defaultFormatFor(url)
          newJob(url, {
            wantFormat: format,
            wantPlaylist: cmd.format === 'playlist',
            clip: cmd.format === 'clip' ? cmd.clip : null,
            source: cmd.source ?? null,
          })
          toast('info', 'Added to the queue.')
          return pump()
        }
        case 'batch': {
          const urls = urlsFrom(cmd.text)
          if (!urls.length) {
            toast('error', 'No links found. Put one link per line.')
            break
          }
          const format = Schema.FORMATS.some(([key]) => key === cmd.format) ? cmd.format : null
          for (const url of urls) newJob(url, { wantFormat: format ?? defaultFormatFor(url) })
          toast('success', `Added ${urls.length} link${urls.length === 1 ? '' : 's'} to the queue.`)
          return pump()
        }

        // --- queue controls ---
        case 'pause':
          if (job?.phase === 'downloading') job.channel?.post({ type: 'pause' })
          else if (job?.phase === 'queued') job.phase = 'paused'
          break
        case 'resume':
          if (job?.phase !== 'paused') return
          job.phase = 'queued'
          return pump()
        case 'retry':
          if (!job) return
          if (job.phase === 'lookup-error') {
            job.phase = 'probing'
            job.error = null
            openChannel(job).post({ type: 'probe', url: job.url, playlist: job.wantPlaylist })
            break
          }
          if (job.phase !== 'failed') return
          job.attempts = 0
          job.phase = 'queued'
          return pump()
        case 'cancel':
          if (!job) return
          if ((job.phase === 'downloading' || job.phase === 'probing') && job.channel) {
            job.phase = 'cancelling'
            job.channel.post({ type: 'cancel' })
          } else removeJob(job)
          pump()
          return
        case 'dismiss':
          if (job?.phase === 'failed') removeJob(job)
          break
        case 'pauseAll':
          for (const j of jobs.values()) await command({ type: 'pause', id: j.id })
          break
        case 'resumeAll':
          for (const j of jobs.values()) if (j.phase === 'paused') j.phase = 'queued'
          return pump()
        case 'clearFinished':
          for (const j of [...jobs.values()]) if (j.phase === 'failed') removeJob(j)
          break

        // --- settings and helpers ---
        case 'settings:refresh':
          await refreshSettings()
          break
        case 'settings:set':
          await request({ type: 'settings:set', patch: cmd.patch }, applySettings)
          if (Object.keys(settingsErrors).length) toast('error', Object.values(settingsErrors)[0])
          break
        case 'settings:reset':
          if (await request({ type: 'settings:reset' }, applySettings)) toast('success', 'Settings reset to defaults.')
          break
        case 'settings:import':
          if (await request({ type: 'settings:import', data: cmd.data }, applySettings)) {
            const errs = Object.values(settingsErrors)
            toast(errs.length ? 'error' : 'success', errs.length ? `Imported, but some values were invalid: ${errs[0]}` : 'Settings imported.')
          }
          break
        case 'terms:accept':
          await command({ type: 'settings:set', patch: { termsAccepted: Schema.TERMS_VERSION } })
          return
        case 'folder:pick':
          await request({ type: 'folder:pick' }, applySettings)
          break
        case 'file:reveal':
        case 'file:open':
          await request({ type: cmd.type, filepath: cmd.filepath })
          break
        case 'ytdlp:version':
          await request({ type: 'ytdlp:version' }, reply => (ytdlpInfo = { ...ytdlpInfo, ...reply, busy: false }))
          break
        case 'ytdlp:update':
          ytdlpInfo = { ...ytdlpInfo, busy: true, message: 'Updating…' }
          broadcast()
          await request({ type: 'ytdlp:update' }, reply => {
            ytdlpInfo = { ...ytdlpInfo, ...reply, busy: false }
            toast('success', reply.message)
          })
          ytdlpInfo = { ...ytdlpInfo, busy: false }
          break
        case 'history:forget':
          history = history.filter(entry => entry.id !== cmd.entryId)
          saveHistory()
          break
        case 'history:clear':
          history = []
          saveHistory()
          toast('success', 'History cleared.')
          break
        case 'toast':
          toast(cmd.kind ?? 'info', String(cmd.text ?? '').slice(0, 300))
          break
        default:
          return
      }
      broadcast()
    }

    // A picked height (e.g. 360) as the nearest "default format" choice.
    function settingFormat(format) {
      if (format === 'audio' || format === 'best') return format
      const allowed = Schema.FORMATS.map(([key]) => Number(key)).filter(Boolean).sort((a, b) => a - b)
      return String(allowed.find(h => h >= Number(format)) ?? 'best')
    }

    function defaultFormatFor(url) {
      return Sites.isMusic(url) ? 'audio' : settings.defaultFormat
    }

    // History entries are what notifications point at.
    function historyEntry(id) {
      return history.find(entry => entry.id === id) ?? null
    }

    return { ready, command, view, historyEntry, broadcast }
  }

  return { create, LOOKUP_PHASES }
})
