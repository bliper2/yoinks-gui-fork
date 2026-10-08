/*
 * The lookup card on the home view: paste a link -> looking up -> pick a
 * format (or confirm Spotify matches) -> it joins the queue.
 */
;(function (root) {
  'use strict'
  const { h, icon, button, formatDuration, parseTime, copyText, debugReport } = root.YoinksDom
  const Sites = root.YoinksSites

  /** What was typed: a link (maybe without https://), or words to search for. */
  function asLink(value) {
    if (/^https?:\/\/\S+$/i.test(value)) return value
    if (/^(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(value) && !/\s/.test(value)) return `https://${value}`
    return null
  }

  function create(ctx) {
    const { send, bridge } = ctx
    let lastView = null
    const el = h('section', { class: 'card lookup', 'aria-label': 'Look up a link' })
    let renderedKey = null
    let firstState = true

    // ---------- input ----------

    const input = h('input', {
      class: 'field url-field',
      type: 'text',
      inputmode: 'url',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Paste a link or search…',
      'aria-label': 'Video or music link, or words to search for',
    })
    const form = h(
      'form',
      {
        class: 'url-form',
        onsubmit: event => {
          event.preventDefault()
          const value = input.value.trim()
          if (!value) return input.focus()
          // Several links pasted here go to the batch queue; words are a search.
          if ((value.match(/https?:\/\//g) ?? []).length > 1) return send({ type: 'batch', text: value })
          const link = asLink(value)
          if (link) send({ type: 'lookup', url: link })
          else send({ type: 'search', query: value })
        },
      },
      input,
      button({ icon: 'download', text: 'Yoink', variant: 'primary', type: 'submit', size: 'lg' }),
    )
    const inputPane = h(
      'div',
      { class: 'pane' },
      h('h1', { class: 'headline', text: 'Yoink a video or song' }),
      h('p', { class: 'sub', text: 'YouTube, YouTube Music, Spotify, SoundCloud, Bandcamp, TikTok, and 1,800+ more sites. Type words to search YouTube.' }),
      form,
    )

    // Popup just opened on a video page: look it up straight away (unless it
    // is already queued or was downloaded before — then just prefill).
    async function autoLookup(view) {
      const tab = await bridge.activeTab()
      const url = tab?.url ?? ''
      if (!/^https?:/.test(url)) return
      const seen = view.queue.some(job => Sites.sameMedia(job.url, url)) || view.history.some(entry => Sites.sameMedia(entry.url, url))
      if (Sites.isMediaPage(url) && !seen) send({ type: 'lookup', url, source: tab.id >= 0 ? { tabId: tab.id } : null })
      else {
        input.value = url
        input.select()
      }
    }

    // ---------- probing / error ----------

    function probingPane(job) {
      return h(
        'div',
        { class: 'pane centered' },
        h('div', { class: 'pixel-loader', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span'), h('span')),
        h('p', { class: 'status-line', role: 'status', text: job.status || 'Looking up…' }),
        button({ text: 'Cancel', variant: 'ghost', onClick: () => send({ type: 'closeLookup' }) }),
      )
    }

    function errorPane(job) {
      const copy = button({
        icon: 'copy',
        text: 'Copy details',
        variant: 'ghost',
        onClick: async () => {
          const ok = await copyText(debugReport({ bridge, view: lastView, job }))
          copy.querySelector('span').textContent = ok ? 'Copied' : 'Could not copy'
          setTimeout(() => (copy.querySelector('span').textContent = 'Copy details'), 2000)
        },
      })
      return h(
        'div',
        { class: 'pane centered' },
        h('div', { class: 'error-mark', 'aria-hidden': 'true' }, icon('alert', { size: 22 })),
        h('p', { class: 'error-title', text: "That didn't work." }),
        h('p', { class: 'error-message', role: 'alert', text: job.error?.message ?? 'Something went wrong.' }),
        h(
          'div',
          { class: 'row' },
          button({ icon: 'retry', text: 'Try again', variant: 'secondary', onClick: () => send({ type: 'retry', id: job.id }) }),
          button({ icon: 'back', text: 'Different link', variant: 'ghost', onClick: () => send({ type: 'closeLookup' }) }),
          copy,
        ),
      )
    }

    // ---------- search results ----------

    function resultsPane(job) {
      const rows = (job.results ?? []).map(result =>
        h(
          'button',
          { type: 'button', class: 'result', onclick: () => send({ type: 'lookup', url: result.url }) },
          result.thumbnail ? h('img', { class: 'result-thumb', src: result.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'result-thumb thumb-empty' }, icon('film')),
          h(
            'span',
            { class: 'result-text' },
            h('span', { class: 'result-title', text: result.title }),
            h('span', { class: 'result-sub', text: [result.uploader, formatDuration(result.duration)].filter(Boolean).join(' · ') }),
          ),
        ),
      )
      return h(
        'div',
        { class: 'pane' },
        h('p', { class: 'meta-title', text: `Results for “${job.searchQuery}”` }),
        rows.length ? h('div', { class: 'result-list', role: 'list' }, rows) : h('p', { class: 'hint', text: 'Nothing found. Try other words.' }),
        button({ icon: 'back', text: 'Search again', variant: 'ghost', onClick: () => send({ type: 'closeLookup' }) }),
      )
    }

    // ---------- media formats ----------

    function metaHeader(job) {
      const sub = [job.uploader, job.playlistCount ? `${job.playlistCount} items` : formatDuration(job.duration)].filter(Boolean).join(' · ')
      return h(
        'div',
        { class: 'meta' },
        job.thumbnail ? h('img', { class: 'thumb', src: job.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div', { class: 'thumb thumb-empty' }, icon(job.music ? 'music' : 'film')),
        h('div', { class: 'meta-text' }, h('p', { class: 'meta-title', text: job.title || 'Untitled' }), h('p', { class: 'meta-sub', text: sub || ' ' })),
      )
    }

    function formatsPane(job, view) {
      const clipOn = h('input', { type: 'checkbox', id: 'clip-on', disabled: Boolean(job.playlistCount) })
      const start = h('input', { class: 'field field-sm', id: 'clip-start', type: 'text', inputmode: 'numeric', placeholder: '0:00', 'aria-label': 'Clip start' })
      const end = h('input', { class: 'field field-sm', id: 'clip-end', type: 'text', inputmode: 'numeric', placeholder: 'end', 'aria-label': 'Clip end' })
      // Trim handles: two sliders over the video's length, kept in step with the time boxes.
      const total = Math.floor(job.duration ?? 0)
      const lowHandle = h('input', { type: 'range', min: 0, max: total, value: 0, step: 1, 'aria-label': 'Clip start handle' })
      const highHandle = h('input', { type: 'range', min: 0, max: total, value: total, step: 1, 'aria-label': 'Clip end handle' })
      const handles = total > 1 ? h('div', { class: 'trim' }, lowHandle, highHandle) : null
      if (handles) {
        const fromHandles = () => {
          let lo = Number(lowHandle.value)
          let hi = Number(highHandle.value)
          if (lo >= hi) {
            if (document.activeElement === lowHandle) lo = lowHandle.value = Math.max(0, hi - 1)
            else hi = highHandle.value = Math.min(total, lo + 1)
          }
          start.value = lo ? formatDuration(lo) : ''
          end.value = hi >= total ? '' : formatDuration(hi)
        }
        lowHandle.addEventListener('input', fromHandles)
        highHandle.addEventListener('input', fromHandles)
        const fromBoxes = () => {
          const s = parseTime(start.value)
          const e = parseTime(end.value)
          if (typeof s === 'number' && !Number.isNaN(s)) lowHandle.value = Math.min(s, total)
          if (e === null) highHandle.value = total
          else if (typeof e === 'number' && !Number.isNaN(e)) highHandle.value = Math.min(e, total)
        }
        start.addEventListener('input', fromBoxes)
        end.addEventListener('input', fromBoxes)
      }
      const times = h('div', { class: 'clip-times', hidden: true }, h('label', {}, 'From ', start), h('label', {}, 'to ', end), handles)
      const remember = h('input', { type: 'checkbox', id: 'remember' })
      const siteName = job.site && !job.entries?.length ? Sites.SITES.find(site => site.id === job.site)?.name : null
      const rememberSite = siteName ? h('input', { type: 'checkbox', id: 'remember-site' }) : null
      const problem = h('p', { class: 'inline-error', role: 'alert', hidden: true })

      // Playlists: tick the videos you want.
      const entries = job.entries ?? []
      const boxes = entries.map(() => h('input', { type: 'checkbox', checked: true }))
      const picked = () => boxes.map((box, i) => (box.checked ? i + 1 : null)).filter(Boolean)
      const summary = h('summary', {})
      const updatePicked = () => (summary.textContent = `${picked().length} of ${entries.length} videos selected`)
      boxes.forEach(box => box.addEventListener('change', updatePicked))
      updatePicked()
      const setAll = on => {
        boxes.forEach(box => (box.checked = on))
        updatePicked()
      }
      const chooser = entries.length
        ? h(
            'details',
            { class: 'options playlist-picker' },
            summary,
            h('div', { class: 'row' }, button({ text: 'All', variant: 'link', onClick: () => setAll(true) }), button({ text: 'None', variant: 'link', onClick: () => setAll(false) })),
            h(
              'div',
              { class: 'pick-list' },
              entries.map((entry, i) => h('label', { class: 'check' }, boxes[i], h('span', { class: 'pick-title', text: `${i + 1}. ${entry.title}` }), entry.duration ? h('span', { class: 'pick-time', text: formatDuration(entry.duration) }) : null)),
            ),
          )
        : null
      const options = h(
        'details',
        { class: 'options' },
        h('summary', {}, icon('settings', { size: 14 }), 'Options'),
        h('label', { class: 'check' }, clipOn, icon('scissors', { size: 14 }), job.playlistCount ? 'Only a clip (not for playlists)' : 'Only a clip'),
        times,
        ...[
          ['embedMetadata', 'Save title, artist and chapters'],
          ['embedThumbnail', 'Add cover art'],
          ['embedSubs', 'Add subtitles (videos)'],
        ].map(([key, text]) =>
          h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', checked: view.settings[key], onchange: event => send({ type: 'settings:set', patch: { [key]: event.target.checked } }) }),
            text,
          ),
        ),
      )

      clipOn.addEventListener('change', async () => {
        times.hidden = !clipOn.checked
        if (!clipOn.checked || start.value) return
        const tab = await bridge.activeTab()
        const reply = tab ? await bridge.currentTime(tab.id) : null
        if (reply?.time != null && Sites.sameMedia(reply.url, job.url)) {
          start.value = formatDuration(Math.floor(reply.time))
          start.dispatchEvent(new Event('input'))
        }
        start.focus()
      })

      function pick(index, overrides = null) {
        let items = null
        if (entries.length) {
          const chosen = picked()
          if (!chosen.length) {
            problem.textContent = 'Choose at least one video.'
            problem.hidden = false
            chooser.open = true
            return
          }
          if (chosen.length < entries.length) items = chosen
        }
        let clip = null
        if (clipOn.checked) {
          const s = parseTime(start.value) ?? 0
          const e = parseTime(end.value)
          const message = Number.isNaN(s) || Number.isNaN(e) ? 'Write times like 1:05 or 65.' : e !== null && e <= s ? 'The clip has to end after it starts.' : ''
          if (message) {
            problem.textContent = message
            problem.hidden = false
            options.open = true
            return
          }
          clip = { start: s, end: e }
        }
        send({ type: 'choose', index, clip, items, overrides, remember: remember.checked, rememberSite: Boolean(rememberSite?.checked) })
      }

      const list = h(
        'div',
        { class: 'choice-list', role: 'list' },
        job.choices.map((choice, index) =>
          h(
            'button',
            {
              type: 'button',
              role: 'listitem',
              class: `choice${choice.kind === 'audio' ? ' is-audio' : ''}${index === job.defaultIndex ? ' is-default' : ''}`,
              onclick: () => pick(index),
            },
            icon(choice.kind === 'audio' ? 'music' : 'film', { size: 16 }),
            h('span', { class: 'choice-label', text: choice.label }),
            h('span', { class: 'choice-ext', text: choice.ext }),
            index === job.defaultIndex ? h('span', { class: 'chip', text: 'default' }) : null,
            h('span', { class: 'choice-size', text: choice.sizeLabel || '' }),
          ),
        ),
      )

      // Presets: one click picks the quality and the extras you saved.
      const presets = (view.settings.presets ?? []).map(preset =>
        h('button', {
          type: 'button',
          class: 'chip chip-btn',
          title: `${preset.format === 'audio' ? 'Audio' : preset.format === 'best' ? 'Best video' : `${preset.format}p`}${preset.audioFormat ? `, ${preset.audioFormat.toUpperCase()}` : ''}${preset.embedSubs ? ', subtitles' : ''}${preset.embedThumbnail ? ', cover art' : ''}`,
          text: preset.name,
          onclick: () => {
            const index = root.YoinksFormats.pickChoice(job.choices, preset.format)
            pick(index < 0 ? job.defaultIndex : index, { audioFormat: preset.audioFormat, embedSubs: preset.embedSubs, embedThumbnail: preset.embedThumbnail })
          },
        }),
      )

      return h(
        'div',
        { class: 'pane' },
        metaHeader(job),
        presets.length ? h('div', { class: 'preset-row' }, h('span', { class: 'hint', text: 'Presets' }), presets) : null,
        Sites.hasPlaylistParam(job.url) && !job.playlistCount
          ? button({ icon: 'list', text: 'Get the whole playlist instead', variant: 'link', onClick: () => send({ type: 'lookup', url: job.url, playlist: true }) })
          : null,
        chooser,
        list,
        options,
        h('label', { class: 'check' }, remember, 'Always use the format I pick'),
        rememberSite ? h('label', { class: 'check' }, rememberSite, `Use this quality for ${siteName} from now on`) : null,
        problem,
        button({ icon: 'back', text: 'Different link', variant: 'ghost', onClick: () => send({ type: 'closeLookup' }) }),
      )
    }

    // ---------- Spotify matches ----------

    function spotifyPane(job) {
      const selections = job.tracks.map(track => (track.candidates.length ? 0 : -1))
      const count = h('span')
      const go = button({ icon: 'download', text: 'Download', variant: 'primary', size: 'lg', onClick: () => send({ type: 'chooseMatches', selections }) })
      function updateCount() {
        const n = selections.filter(s => s >= 0).length
        go.querySelector('span').textContent = n === 1 ? 'Download 1 song' : `Download ${n} songs`
        go.disabled = n === 0
        const low = job.tracks.filter((t, i) => selections[i] >= 0 && t.candidates[selections[i]].level === 'low').length
        count.textContent = low ? `${low} low-confidence match${low === 1 ? '' : 'es'} — check before downloading.` : 'Matched on YouTube Music. Spotify’s tags and cover are added.'
      }

      const rows = job.tracks.map((track, i) => {
        const badge = h('span', { class: 'confidence' })
        const detail = h('span', { class: 'match-detail' })
        const select = h(
          'select',
          { class: 'field field-sm match-select', 'aria-label': `Match for ${track.title}` },
          track.candidates.map((c, n) => h('option', { value: n, text: `${c.title} — ${c.artist}${c.album ? ` (${c.album})` : ''} · ${formatDuration(c.duration) ?? '?'} · ${c.confidence}%` })),
          h('option', { value: -1, text: 'Skip this song' }),
        )
        select.value = String(selections[i])
        function paint() {
          const c = track.candidates[selections[i]]
          badge.className = `confidence ${c ? `level-${c.level}` : 'level-skip'}`
          badge.textContent = c ? `${c.confidence}%` : 'skip'
          badge.title = c ? `${c.level} confidence match` : 'Not downloaded'
          detail.textContent = c ? `${c.title} — ${c.artist}` : track.candidates.length ? 'Skipped' : 'No match found on YouTube Music'
        }
        select.addEventListener('change', () => {
          selections[i] = Number(select.value)
          paint()
          updateCount()
        })
        paint()
        return h(
          'li',
          { class: 'match' },
          h('div', { class: 'match-top' }, h('span', { class: 'match-title', text: `${track.title}` }), badge),
          h('span', { class: 'match-artist', text: `${track.artists.join(', ')} · ${formatDuration((track.durationMs ?? 0) / 1000) ?? ''}` }),
          detail,
          track.candidates.length ? select : null,
        )
      })
      updateCount()
      return h(
        'div',
        { class: 'pane' },
        metaHeader({ ...job, music: true, uploader: `Spotify ${job.spotifyType ?? ''} · ${job.uploader ?? ''}`, duration: null }),
        h('p', { class: 'hint' }, count),
        h('ol', { class: 'match-list' }, rows),
        go,
        button({ icon: 'back', text: 'Different link', variant: 'ghost', onClick: () => send({ type: 'closeLookup' }) }),
      )
    }

    // ---------- render ----------

    function render(view) {
      lastView = view
      const job = view.lookup
      if (firstState) {
        firstState = false
        if (!job && bridge.isPopup) autoLookup(view)
      }
      const key = job ? `${job.id}:${job.phase}:${job.phase === 'probing' ? job.status : ''}` : 'input'
      if (key === renderedKey) return
      const wasInput = renderedKey === 'input'
      renderedKey = key
      let pane
      if (!job) pane = inputPane
      else if (job.phase === 'probing') pane = probingPane(job)
      else if (job.phase === 'lookup-error') pane = errorPane(job)
      else if (job.phase === 'results') pane = resultsPane(job)
      else if (job.kind === 'spotify') pane = spotifyPane(job)
      else pane = formatsPane(job, view)
      el.replaceChildren(pane)
      if (!job) {
        if (!wasInput) input.value = ''
        input.focus()
      }
    }

    // A copied link offered by the desktop app: put it in the box, ready to go.
    function prefill(url) {
      if (renderedKey !== 'input') return
      input.value = url
      input.focus()
      input.select()
    }

    return { el, render, focus: () => input.focus(), prefill }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.lookup = { create }
})(typeof self !== 'undefined' ? self : this)
