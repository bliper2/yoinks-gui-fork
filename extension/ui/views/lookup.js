/*
 * The lookup card on the home view: paste a link -> looking up -> pick a
 * format (or confirm Spotify matches) -> it joins the queue.
 */
;(function (root) {
  'use strict'
  const { h, icon, button, formatDuration, parseTime } = root.YoinksDom
  const Sites = root.YoinksSites

  function create(ctx) {
    const { send, bridge } = ctx
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
      placeholder: 'Paste a link…',
      'aria-label': 'Video or music link',
    })
    const form = h(
      'form',
      {
        class: 'url-form',
        onsubmit: event => {
          event.preventDefault()
          const value = input.value.trim()
          if (!value) return input.focus()
          // Several links pasted here go to the batch queue.
          if ((value.match(/https?:\/\//g) ?? []).length > 1) send({ type: 'batch', text: value })
          else send({ type: 'lookup', url: value })
        },
      },
      input,
      button({ icon: 'download', text: 'Yoink', variant: 'primary', type: 'submit', size: 'lg' }),
    )
    const inputPane = h(
      'div',
      { class: 'pane' },
      h('h1', { class: 'headline', text: 'Yoink a video or song' }),
      h('p', { class: 'sub', text: 'YouTube, YouTube Music, Spotify, SoundCloud, Bandcamp, TikTok, and 1,800+ more sites.' }),
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
        ),
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
      const times = h('div', { class: 'clip-times', hidden: true }, h('label', {}, 'From ', start), h('label', {}, 'to ', end))
      const remember = h('input', { type: 'checkbox', id: 'remember' })
      const problem = h('p', { class: 'inline-error', role: 'alert', hidden: true })
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
        if (reply?.time != null && Sites.sameMedia(reply.url, job.url)) start.value = formatDuration(Math.floor(reply.time))
        start.focus()
      })

      function pick(index) {
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
        send({ type: 'choose', index, clip, remember: remember.checked })
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

      return h(
        'div',
        { class: 'pane' },
        metaHeader(job),
        Sites.hasPlaylistParam(job.url) && !job.playlistCount
          ? button({ icon: 'list', text: 'Get the whole playlist instead', variant: 'link', onClick: () => send({ type: 'lookup', url: job.url, playlist: true }) })
          : null,
        list,
        options,
        h('label', { class: 'check' }, remember, 'Always use the format I pick'),
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
      else if (job.kind === 'spotify') pane = spotifyPane(job)
      else pane = formatsPane(job, view)
      el.replaceChildren(pane)
      if (!job) {
        if (!wasInput) input.value = ''
        input.focus()
      }
    }

    return { el, render, focus: () => input.focus() }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.lookup = { create }
})(typeof self !== 'undefined' ? self : this)
