/*
 * The download queue (with pause / resume / retry / cancel) and the list of
 * recent downloads, shown under the lookup card.
 */
;(function (root) {
  'use strict'
  const { h, icon, button, formatBytes, formatDuration, filenameOf, timeAgo, copyText, debugReport } = root.YoinksDom

  const PHASE_TEXT = {
    queued: 'Waiting…',
    probing: 'Looking up…',
    review: 'Check the Spotify matches',
    paused: 'Paused',
  }

  function percentOf(job) {
    const p = job.progress
    const fraction = job.processing ? 1 : p?.totalBytes ? Math.min(1, p.downloadedBytes / p.totalBytes) : 0
    return job.item ? ((job.item.index - 1 + fraction) / job.item.count) * 100 : fraction * 100
  }

  function statsText(job) {
    if (job.phase === 'failed') return job.error?.message ?? 'Download failed.'
    if (job.phase === 'queued' && job.error) return `${job.status ?? 'Retrying…'} ${job.error.message}`
    if (job.phase === 'queued' && job.waitNote) return job.waitNote
    if (job.phase !== 'downloading') return (job.phase === 'probing' && job.status) || PHASE_TEXT[job.phase] || ''
    const p = job.progress
    const bits = []
    if (job.item) bits.push(`${job.item.index}/${job.item.count}${job.item.title ? ` · ${job.item.title}` : ''}`)
    if (job.processing) bits.push(job.choiceKind === 'audio' ? 'converting…' : 'finishing…')
    else if (job.kind === 'convert') {
      // A conversion's "bytes" are microseconds of the file done so far.
      bits.push(p?.totalBytes ? `${Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100))}%` : 'converting…')
    } else if (p) {
      bits.push(p.totalBytes ? `${Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100))}%` : formatBytes(p.downloadedBytes))
      if (p.speed) bits.push(`${formatBytes(p.speed)}/s`)
      if (p.eta) bits.push(`${formatDuration(p.eta)} left`)
    } else bits.push('starting…')
    return bits.join(' · ')
  }

  function create(ctx) {
    const { send, bridge } = ctx
    const rows = new Map()
    let lastView = null

    const queueList = h('div', { class: 'job-list' })
    const queueCount = h('span', { class: 'count' })
    const pauseAll = button({ icon: 'pause', label: 'Pause all', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'pauseAll' }) })
    const resumeAll = button({ icon: 'play', label: 'Resume all', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'resumeAll' }) })
    const clearFailed = button({ icon: 'trash', label: 'Remove failed', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'clearFinished' }) })
    const queueSection = h(
      'section',
      { class: 'list-section', 'aria-label': 'Queue', hidden: true },
      h('h2', {}, h('span', {}, 'Queue ', queueCount), h('span', { class: 'section-actions' }, pauseAll, resumeAll, clearFailed)),
      queueList,
    )

    const recentList = h('div', { class: 'recent-list' })
    const recentSection = h(
      'section',
      { class: 'list-section', 'aria-label': 'Recent downloads', hidden: true },
      h('h2', {}, h('span', { text: 'Recent' }), button({ text: 'Clear', variant: 'link', onClick: () => send({ type: 'history:clear' }) })),
      recentList,
    )

    // ---------- queue rows (updated in place so buttons keep focus) ----------

    function makeRow(job) {
      const title = h('span', { class: 'job-title' })
      const format = h('span', { class: 'chip' })
      const actions = h('span', { class: 'job-actions' })
      const fill = h('div', { class: 'progress-fill' })
      const track = h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill)
      const stats = h('p', { class: 'job-stats' })
      const row = h('div', { class: 'job', role: 'group' }, h('div', { class: 'job-top' }, title, format, actions), track, stats)
      return { row, title, format, actions, track, fill, stats, actionKey: null }
    }

    function actionButtons(job) {
      const b = []
      if (job.phase === 'review') b.push(button({ icon: 'check', text: 'Review', variant: 'secondary', size: 'sm', onClick: () => send({ type: 'review', id: job.id }) }))
      if (job.phase === 'downloading' || job.phase === 'queued') b.push(button({ icon: 'pause', label: 'Pause', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'pause', id: job.id }) }))
      if (job.phase === 'paused') b.push(button({ icon: 'play', label: 'Resume', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'resume', id: job.id }) }))
      if (job.phase === 'failed') {
        b.push(button({ icon: 'retry', label: 'Retry', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'retry', id: job.id }) }))
        b.push(
          button({
            icon: 'copy',
            label: 'Copy details for support',
            variant: 'ghost',
            size: 'sm',
            onClick: async event => {
              const ok = await copyText(debugReport({ bridge, view: lastView, job }))
              send({ type: 'toast', kind: ok ? 'success' : 'error', text: ok ? 'Details copied. Paste them in Discord or a GitHub issue.' : 'Could not copy.' })
              event.currentTarget.blur()
            },
          }),
        )
      }
      b.push(button({ icon: 'close', label: job.phase === 'failed' ? 'Remove' : 'Cancel', variant: 'ghost', size: 'sm', onClick: () => send({ type: job.phase === 'failed' ? 'dismiss' : 'cancel', id: job.id }) }))
      return b
    }

    function renderQueue(queue) {
      queueSection.hidden = queue.length === 0
      const active = queue.filter(j => j.phase === 'downloading').length
      queueCount.textContent = active ? `(${active} active, ${queue.length} total)` : `(${queue.length})`
      pauseAll.disabled = !queue.some(j => j.phase === 'downloading' || j.phase === 'queued')
      resumeAll.disabled = !queue.some(j => j.phase === 'paused')
      clearFailed.disabled = !queue.some(j => j.phase === 'failed')

      const ids = new Set(queue.map(j => j.id))
      for (const [id, parts] of rows) if (!ids.has(id)) (parts.row.remove(), rows.delete(id))
      queue.forEach((job, i) => {
        let parts = rows.get(job.id)
        if (!parts) rows.set(job.id, (parts = makeRow(job)))
        if (queueList.children[i] !== parts.row) queueList.insertBefore(parts.row, queueList.children[i] ?? null)
        const name = job.title || job.url
        parts.row.dataset.phase = job.phase
        parts.row.setAttribute('aria-label', name)
        parts.title.textContent = name
        parts.title.title = name
        parts.format.textContent = job.choiceLabel || ''
        parts.format.hidden = !job.choiceLabel
        const pct = Math.round(percentOf(job))
        parts.fill.style.width = `${job.phase === 'downloading' || job.phase === 'paused' ? pct : 0}%`
        parts.track.setAttribute('aria-valuenow', String(pct))
        parts.track.hidden = job.phase === 'failed' || job.phase === 'review'
        parts.stats.textContent = statsText(job)
        const actionKey = job.phase
        if (actionKey !== parts.actionKey) {
          parts.actionKey = actionKey
          parts.actions.replaceChildren(...actionButtons(job))
        }
      })
    }

    // ---------- recent ----------

    let renderedHistory = null
    function renderHistory(history) {
      const key = JSON.stringify(history.map(e => e.id))
      recentSection.hidden = history.length === 0
      if (key === renderedHistory) return
      renderedHistory = key
      recentList.replaceChildren(
        ...history.slice(0, 20).map(entry =>
          h(
            'div',
            { class: 'recent-row' },
            icon(entry.kind === 'audio' ? 'music' : entry.folder ? 'list' : 'film', { size: 16 }),
            h('span', { class: 'recent-title', title: entry.folder ?? entry.filepath, text: entry.title }),
            h('span', { class: 'recent-when', text: timeAgo(entry.at) }),
            h(
              'span',
              { class: 'recent-actions' },
              button({ icon: 'folder', label: `Show ${filenameOf(entry.folder ?? entry.filepath)} in folder`, variant: 'ghost', size: 'sm', onClick: () => send({ type: 'file:reveal', filepath: entry.folder ?? entry.filepath }) }),
              entry.folder ? null : button({ icon: 'play', label: `Open ${filenameOf(entry.filepath)}`, variant: 'ghost', size: 'sm', onClick: () => send({ type: 'file:open', filepath: entry.filepath }) }),
              button({ icon: 'close', label: 'Remove from list', variant: 'ghost', size: 'sm', onClick: () => send({ type: 'history:forget', entryId: entry.id }) }),
            ),
          ),
        ),
      )
    }

    return {
      el: h('div', { class: 'lists' }, queueSection, recentSection),
      render(view) {
        lastView = view
        renderQueue(view.queue)
        renderHistory(view.history)
      },
    }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.queue = { create, percentOf }
})(typeof self !== 'undefined' ? self : this)
