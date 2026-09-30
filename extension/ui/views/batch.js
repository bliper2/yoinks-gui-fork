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

    const form = h(
      'form',
      {
        class: 'card batch',
        onsubmit: event => {
          event.preventDefault()
          if (!countLinks(area.value)) return
          send({ type: 'batch', text: area.value, format: format.value })
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
      el: form,
      render() {},
      focus: () => area.focus(),
    }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.batch = { create }
})(typeof self !== 'undefined' ? self : this)
