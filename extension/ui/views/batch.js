/*
 * Batch mode: paste many links (or drop / open a .txt file), pick a format,
 * add them all to the queue.
 */
;(function (root) {
  'use strict'
  const { h, button, icon } = root.YoinksDom
  const Schema = root.YoinksSettings

  const MAX_FILE = 2 * 1024 * 1024

  function countLinks(text) {
    return new Set(String(text).match(/https?:\/\/[^\s<>"']+/g) ?? []).size
  }

  function create(ctx) {
    const { send, bridge } = ctx
    let shownPrefill = null
    const area = h('textarea', {
      class: 'field batch-area',
      rows: 8,
      spellcheck: 'false',
      placeholder: 'One link per line…\nhttps://www.youtube.com/watch?v=…\nhttps://open.spotify.com/album/…',
      'aria-label': 'Links to download',
      'aria-describedby': 'batch-hint',
    })
    const format = h(
      'select',
      { class: 'field', 'aria-label': 'Format for all links' },
      h('option', { value: 'default', text: 'Default format (music sites: audio)' }),
      Schema.FORMATS.map(([value, text]) => h('option', { value, text })),
    )
    let shownPresets = ''
    function paintPresets(presets) {
      const key = JSON.stringify(presets.map(p => [p.id, p.name]))
      if (key === shownPresets) return
      shownPresets = key
      const chosen = format.value
      format.querySelectorAll('option[data-preset]').forEach(option => option.remove())
      for (const preset of presets) format.append(h('option', { value: `preset:${preset.id}`, text: `Preset: ${preset.name}`, dataset: { preset: '1' } }))
      format.value = [...format.options].some(o => o.value === chosen) ? chosen : 'default'
    }
    const count = h('span', { id: 'batch-hint', class: 'hint' })
    const add = button({ icon: 'download', text: 'Add to queue', variant: 'primary', size: 'lg', type: 'submit' })
    const fileInput = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true })

    function update() {
      const n = countLinks(area.value)
      count.textContent = n ? `${n} link${n === 1 ? '' : 's'} found` : 'No links yet'
      add.disabled = n === 0
      add.querySelector('span').textContent = n > 1 ? `Add ${n} to queue` : 'Add to queue'
    }

    async function loadFile(file) {
      if (!file) return
      if (file.size > MAX_FILE) return send({ type: 'toast', kind: 'error', text: 'That file is too big (2 MB max).' })
      const text = await file.text()
      area.value = [area.value.trim(), text.trim()].filter(Boolean).join('\n')
      update()
    }

    fileInput.addEventListener('change', () => loadFile(fileInput.files[0]))
    area.addEventListener('input', update)
    area.addEventListener('dragover', event => (event.preventDefault(), area.classList.add('dragging')))
    area.addEventListener('dragleave', () => area.classList.remove('dragging'))
    area.addEventListener('drop', event => {
      event.preventDefault()
      area.classList.remove('dragging')
      loadFile(event.dataTransfer.files[0])
    })

    // In the small popup, a file dialog can close the popup: open this view
    // in a tab instead.
    const openFile = button({
      icon: 'file',
      text: 'Open text file…',
      variant: 'secondary',
      onClick: () => (bridge.isPopup && bridge.openFullPage ? bridge.openFullPage('batch') : fileInput.click()),
    })

    // ---------- convert files (desktop app) ----------

    const target = h(
      'select',
      { class: 'field', 'aria-label': 'Convert to' },
      [['mp3', 'MP3 (audio)'], ['m4a', 'M4A (audio)'], ['flac', 'FLAC (lossless audio)'], ['opus', 'Opus (audio)'], ['mp4', 'MP4 (video)']].map(([value, text]) => h('option', { value, text })),
    )
    const dropZone = h('div', { class: 'drop-zone', tabindex: '0', role: 'button', 'aria-label': 'Drop video or audio files here to convert them, or press Enter to choose files' }, icon('swap', { size: 18 }), h('span', { text: 'Drop files here, or choose files…' }))
    const choose = () => send({ type: 'convert:pick', target: target.value })
    dropZone.addEventListener('click', choose)
    dropZone.addEventListener('keydown', event => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), choose()))
    dropZone.addEventListener('dragover', event => (event.preventDefault(), dropZone.classList.add('dragging')))
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'))
    dropZone.addEventListener('drop', event => {
      event.preventDefault()
      event.stopPropagation()
      dropZone.classList.remove('dragging')
      addFiles([...event.dataTransfer.files])
    })

    /** Files (from a drop anywhere in the window) to convert with the chosen format. */
    function addFiles(files) {
      const paths = files.map(file => bridge.pathOf?.(file)).filter(Boolean)
      if (!paths.length) return send({ type: 'toast', kind: 'error', text: 'Could not read those files.' })
      send({ type: 'convert', paths, target: target.value })
      ctx.go('home')
    }

    const convertCard =
      bridge.platform === 'desktop'
        ? h(
            'section',
            { class: 'card batch convert' },
            h('h2', { class: 'headline' }, icon('swap', { size: 20 }), 'Convert files'),
            h('p', { class: 'sub', text: 'Turn video or audio files from your PC into another format. The new file goes in your download folder.' }),
            h('div', { class: 'row wrap' }, h('label', { class: 'inline-label' }, 'Convert to ', target)),
            dropZone,
          )
        : null

    const form = h(
      'form',
      {
        class: 'card batch',
        onsubmit: event => {
          event.preventDefault()
          if (!countLinks(area.value)) return
          const preset = format.value.startsWith('preset:') ? format.value.slice(7) : null
          send({ type: 'batch', text: area.value, format: preset ? 'default' : format.value, preset })
          area.value = ''
          update()
          ctx.go('home')
        },
      },
      h('h1', { class: 'headline' }, icon('list', { size: 22 }), 'Batch'),
      h('p', { class: 'sub', text: 'Paste several links, drop a .txt file here, or open one. Everything joins the queue.' }),
      area,
      count,
      h('div', { class: 'row wrap' }, openFile, fileInput, h('label', { class: 'inline-label' }, 'Format ', format)),
      add,
    )
    update()

    return {
      el: h('div', { class: 'batch-view' }, form, convertCard),
      addFiles,
      render(view) {
        paintPresets(view.settings.presets ?? [])
        // Links a page collected ("Yoink all videos on this page").
        if (view.prefill && view.prefill !== shownPrefill) {
          shownPrefill = view.prefill
          area.value = [area.value.trim(), view.prefill.trim()].filter(Boolean).join('\n')
          update()
          send({ type: 'prefill:clear' })
        }
      },
      focus: () => area.focus(),
    }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.batch = { create }
})(typeof self !== 'undefined' ? self : this)
