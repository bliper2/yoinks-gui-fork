/*
 * Settings, built from the shared schema (shared/settings-schema.js).
 * Every change is validated locally for instant feedback, then saved through
 * the controller -> helper -> settings.json (the one place settings live),
 * which validates again.
 */
;(function (root) {
  'use strict'
  const { h, icon, button, copyText } = root.YoinksDom
  const Schema = root.YoinksSettings
  const Template = root.YoinksTemplate
  const Theme = root.YoinksTheme

  const SECTION_ICONS = { Health: 'health', Downloads: 'download', Audio: 'music', Tags: 'file', Playlists: 'list', Queue: 'list', 'yt-dlp': 'settings', Look: 'sun' }
  const THEME_ICONS = { system: 'monitor', light: 'sun', dark: 'moon' }

  function create(ctx) {
    const { send, bridge } = ctx
    let settings = Schema.defaults()
    const controls = new Map() // key -> { set(value), error }
    const extras = {}

    function save(key, value) {
      const { errors } = Schema.validate({ [key]: value }, settings)
      const control = controls.get(key)
      if (errors[key]) {
        control?.showError(errors[key])
        return
      }
      control?.showError('')
      // Look changes apply at once, before the round trip.
      if (['theme', 'accent', 'customAccent'].includes(key)) Theme.apply({ ...settings, [key]: value })
      send({ type: 'settings:set', patch: { [key]: value } })
    }

    // ---------- field renderers ----------

    function fieldShell(field, control, { wide = false } = {}) {
      const id = `set-${field.key}`
      const error = h('p', { class: 'inline-error', id: `${id}-err`, role: 'alert', hidden: true })
      const help = field.help ? h('p', { class: 'help', id: `${id}-help`, text: field.help }) : null
      if (!control.id) control.id = id
      if (help) control.setAttribute('aria-describedby', `${id}-help`)
      const row = h(
        'div',
        { class: `setting${wide ? ' setting-wide' : ''}` },
        h('div', { class: 'setting-text' }, h('label', { for: control.id, text: field.label }), help),
        h('div', { class: 'setting-control' }, control),
        error,
      )
      return {
        row,
        showError(message) {
          error.textContent = message
          error.hidden = !message
          control.setAttribute('aria-invalid', message ? 'true' : 'false')
        },
      }
    }

    function toggleField(field) {
      const control = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': 'false', onclick: () => save(field.key, control.getAttribute('aria-checked') !== 'true') }, h('span', { class: 'switch-thumb' }))
      const shell = fieldShell(field, control)
      control.setAttribute('aria-labelledby', `${control.id}-l`)
      shell.row.querySelector('label').id = `${control.id}-l`
      return { ...shell, set: v => control.setAttribute('aria-checked', String(v)) }
    }

    function selectField(field) {
      const control = h('select', { class: 'field', onchange: () => save(field.key, control.value) }, field.options.map(([value, text]) => h('option', { value, text })))
      return { ...fieldShell(field, control), set: v => (control.value = v) }
    }

    function numberField(field) {
      const control = h('input', { class: 'field field-num', type: 'number', min: field.min, max: field.max, step: field.step, onchange: () => save(field.key, control.value) })
      return { ...fieldShell(field, control), set: v => document.activeElement !== control && (control.value = v) }
    }

    function timeField(field) {
      const control = h('input', { class: 'field field-time', type: 'time', onchange: () => save(field.key, control.value) })
      return { ...fieldShell(field, control), set: v => document.activeElement !== control && (control.value = v) }
    }

    function textField(field) {
      const control = h('input', { class: 'field', type: 'text', maxlength: field.maxLength ?? 200, spellcheck: 'false', onchange: () => save(field.key, control.value.trim()) })
      return { ...fieldShell(field, control), set: v => document.activeElement !== control && (control.value = v) }
    }

    function folderField(field) {
      const path = h('span', { class: 'path', id: 'set-outDir-path' })
      const control = button({ icon: 'folder', text: 'Change…', variant: 'secondary', onClick: () => send({ type: 'folder:pick' }) })
      control.setAttribute('aria-describedby', 'set-outDir-path')
      const shell = fieldShell(field, control, { wide: true })
      shell.row.querySelector('.setting-control').prepend(path)
      return { ...shell, set: v => (path.textContent = v || 'Downloads (default)') }
    }

    function segmentedField(field) {
      const buttons = field.options.map(([value, text]) =>
        h('button', { type: 'button', role: 'radio', class: 'segment', 'aria-checked': 'false', dataset: { value }, onclick: () => save(field.key, value) }, THEME_ICONS[value] ? icon(THEME_ICONS[value], { size: 15 }) : '', text),
      )
      const control = h('div', { class: 'segmented', role: 'radiogroup' }, buttons)
      control.addEventListener('keydown', event => arrowRadio(event, buttons, b => save(field.key, b.dataset.value)))
      const shell = fieldShell(field, control)
      control.setAttribute('aria-labelledby', 'set-theme-l')
      shell.row.querySelector('label').id = 'set-theme-l'
      return {
        ...shell,
        set: v => buttons.forEach(b => {
          const on = b.dataset.value === v
          b.setAttribute('aria-checked', String(on))
          b.tabIndex = on ? 0 : -1
        }),
      }
    }

    function accentField(field) {
      const swatches = field.options
        .filter(([value]) => value !== 'custom')
        .map(([value, text]) => {
          const [a, b] = Theme.PRESETS[value]
          return h('button', { type: 'button', role: 'radio', class: 'swatch', title: text, 'aria-label': text, 'aria-checked': 'false', dataset: { value }, style: { background: `linear-gradient(135deg, ${a}, ${b})` }, onclick: () => save('accent', value) })
        })
      const picker = h('input', {
        type: 'color',
        class: 'swatch swatch-custom',
        title: 'Custom color',
        'aria-label': 'Custom accent color',
        oninput: () => Theme.apply({ ...settings, accent: 'custom', customAccent: picker.value }),
        onchange: () => send({ type: 'settings:set', patch: { accent: 'custom', customAccent: picker.value } }),
      })
      const control = h('div', { class: 'swatches', role: 'radiogroup' }, swatches, h('span', { class: 'custom-wrap', title: 'Custom color' }, picker, h('span', { class: 'custom-label', text: 'Custom' })))
      control.addEventListener('keydown', event => arrowRadio(event, swatches, b => save('accent', b.dataset.value)))
      const shell = fieldShell(field, control)
      control.setAttribute('aria-labelledby', 'set-accent-l')
      shell.row.querySelector('label').id = 'set-accent-l'
      return {
        ...shell,
        set: v => {
          swatches.forEach(b => {
            const on = b.dataset.value === v
            b.setAttribute('aria-checked', String(on))
            b.tabIndex = on || (v === 'custom' && b === swatches[0]) ? 0 : -1
          })
          picker.classList.toggle('is-on', v === 'custom')
          if (document.activeElement !== picker) picker.value = settings.customAccent
        },
      }
    }

    function templateField(field) {
      const control = h('input', { class: 'field', type: 'text', spellcheck: 'false', maxlength: 120, oninput: () => preview(), onchange: () => save(field.key, control.value) })
      const out = h('p', { class: 'preview', 'aria-live': 'polite' })
      const chips = h(
        'div',
        { class: 'token-chips' },
        Object.keys(Template.TOKENS).map(token =>
          h('button', {
            type: 'button',
            class: 'chip chip-btn',
            text: `{${token}}`,
            onclick: () => {
              const at = control.selectionStart ?? control.value.length
              control.value = control.value.slice(0, at) + `{${token}}` + control.value.slice(control.selectionEnd ?? at)
              control.focus()
              preview()
              save(field.key, control.value)
            },
          }),
        ),
      )
      function preview() {
        const video = Template.preview(control.value, { ext: 'mp4', folderBy: settings.folderBy })
        const audio = Template.preview(control.value, { ext: settings.audioFormat, folderBy: settings.folderBy })
        const list = Template.preview(control.value, { ext: settings.audioFormat, playlist: true, folder: settings.playlistFolder, numbered: settings.playlistNumbered, folderBy: settings.folderBy })
        out.replaceChildren(
          ...(video.error ? [h('span', { class: 'inline-error', text: video.error })] : [h('span', { text: video.name }), h('span', { text: audio.name }), h('span', { text: list.name })]),
        )
      }
      const shell = fieldShell(field, control, { wide: true })
      shell.row.querySelector('.setting-control').append(chips, out)
      return {
        ...shell,
        set: v => {
          if (document.activeElement !== control) control.value = v
          preview()
        },
      }
    }

    function arrowRadio(event, buttons, choose) {
      const i = buttons.indexOf(document.activeElement)
      if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const next = buttons[(i + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
      next.focus()
      choose(next)
      event.preventDefault()
    }

    const RENDERERS = { toggle: toggleField, select: selectField, number: numberField, text: textField, time: timeField, folder: folderField, segmented: segmentedField, accent: accentField, template: templateField }

    // ---------- sections ----------

    const sections = new Map()
    for (const field of Schema.FIELDS) {
      if (field.hidden) continue
      if (field.only && field.only !== bridge.platform) continue // e.g. desktop-only switches
      const control = RENDERERS[field.type](field)
      controls.set(field.key, control)
      if (!sections.has(field.section)) sections.set(field.section, [])
      sections.get(field.section).push(control.row)
    }

    // Presets: named combinations (quality, audio format, subtitles, cover art).
    extras.presets = h('div', { class: 'setting setting-wide preset-editor' })
    sections.get('Downloads').push(extras.presets)

    const presetName = h('input', { class: 'field', type: 'text', maxlength: 24, placeholder: 'Name, e.g. Music FLAC', 'aria-label': 'Preset name' })
    const presetFormat = h('select', { class: 'field', 'aria-label': 'Preset quality' }, Schema.FORMATS.map(([value, text]) => h('option', { value, text })))
    const presetAudio = h('select', { class: 'field', 'aria-label': 'Preset audio format' }, h('option', { value: '', text: 'Audio: my default' }), Schema.AUDIO_FORMATS.map(([value, text]) => h('option', { value, text: `Audio: ${text}` })))
    const presetSubs = h('input', { type: 'checkbox' })
    const presetCover = h('input', { type: 'checkbox', checked: true })
    const presetError = h('p', { class: 'inline-error', role: 'alert', hidden: true })
    const addPreset = () => {
      const preset = { id: Math.random().toString(36).slice(2, 8), name: presetName.value.trim(), format: presetFormat.value, audioFormat: presetAudio.value, embedSubs: presetSubs.checked, embedThumbnail: presetCover.checked }
      const { errors } = Schema.validate({ presets: [...(settings.presets ?? []), preset] }, settings)
      presetError.textContent = !preset.name ? 'Give the preset a name.' : (errors.presets ?? '')
      presetError.hidden = !presetError.textContent
      if (presetError.hidden) {
        send({ type: 'settings:set', patch: { presets: [...(settings.presets ?? []), preset] } })
        presetName.value = ''
      }
    }
    function renderPresets(list) {
      const key = JSON.stringify(list)
      if (extras.presets.dataset.key === key) return
      extras.presets.dataset.key = key
      extras.presets.replaceChildren(
        h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'Presets' }), h('p', { class: 'help', text: 'Save a combination once, then pick it with one click in the format list or in Batch.' })),
        h(
          'div',
          { class: 'setting-control preset-list' },
          list.map(preset =>
            h(
              'span',
              { class: 'chip remembered-chip' },
              `${preset.name}: ${preset.format === 'audio' ? 'audio' : preset.format === 'best' ? 'best video' : `${preset.format}p`}${preset.audioFormat ? ` ${preset.audioFormat.toUpperCase()}` : ''}`,
              h('button', { type: 'button', class: 'chip-x', 'aria-label': `Delete preset ${preset.name}`, title: 'Delete', onclick: () => send({ type: 'settings:set', patch: { presets: list.filter(p => p.id !== preset.id) } }) }, icon('close', { size: 12 })),
            ),
          ),
          h(
            'div',
            { class: 'preset-form' },
            presetName,
            h('div', { class: 'row wrap' }, presetFormat, presetAudio),
            h('div', { class: 'row wrap' }, h('label', { class: 'check' }, presetSubs, 'Subtitles'), h('label', { class: 'check' }, presetCover, 'Cover art')),
            button({ icon: 'check', text: 'Save preset', variant: 'secondary', size: 'sm', onClick: addPreset, disabled: list.length >= Schema.MAX_PRESETS }),
            presetError,
          ),
        ),
      )
    }

    // Watched channels: new uploads are added to the queue by themselves.
    extras.watches = h('div', { class: 'setting setting-wide watch-editor' })
    sections.get('Queue').push(extras.watches)
    const watchUrl = h('input', { class: 'field', type: 'url', placeholder: 'Channel or playlist link', 'aria-label': 'Channel or playlist link to watch' })
    const addWatch = () => {
      if (!watchUrl.value.trim()) return
      send({ type: 'watch:add', url: watchUrl.value })
      watchUrl.value = ''
    }
    watchUrl.addEventListener('keydown', event => event.key === 'Enter' && addWatch())
    function renderWatches(list) {
      const key = JSON.stringify(list.map(w => [w.url, w.title]))
      if (extras.watches.dataset.key === key) return
      extras.watches.dataset.key = key
      extras.watches.replaceChildren(
        h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'Watched channels' }), h('p', { class: 'help', text: 'Yoinks checks these every 30 minutes while it is open and downloads new uploads in your default quality.' })),
        h(
          'div',
          { class: 'setting-control preset-list' },
          list.map(watch =>
            h(
              'span',
              { class: 'chip remembered-chip', title: watch.url },
              watch.title,
              h('button', { type: 'button', class: 'chip-x', 'aria-label': `Stop watching ${watch.title}`, title: 'Stop watching', onclick: () => send({ type: 'watch:remove', url: watch.url }) }, icon('close', { size: 12 })),
            ),
          ),
          h('div', { class: 'preset-form' }, watchUrl, button({ icon: 'check', text: 'Watch', variant: 'secondary', size: 'sm', onClick: addWatch, disabled: list.length >= Schema.MAX_WATCHES })),
        ),
      )
    }

    // Quality remembered per website (set from the format list).
    extras.sites = h('div', { class: 'setting setting-wide', hidden: true })
    sections.get('Downloads').push(extras.sites)

    // Cookies need a clear privacy note next to the switch.
    sections.get('yt-dlp').push(
      h(
        'div',
        { class: 'note' },
        icon('info', { size: 16 }),
        h(
          'p',
          {},
          h('strong', { text: 'About browser cookies: ' }),
          'when turned on, yt-dlp reads your login cookies from the chosen browser on this PC and sends them only to the site you are downloading from, so it sees you as signed in. Nothing is sent anywhere else or stored by Yoinks. Chrome and Edge lock their cookies while running (close them first); Firefox works best.',
        ),
      ),
    )

    // yt-dlp version + update now
    extras.version = h('span', { class: 'mono', text: '…' })
    extras.versionNote = h('p', { class: 'help', 'aria-live': 'polite' })
    extras.update = button({ icon: 'retry', text: 'Update now', variant: 'secondary', onClick: () => send({ type: 'ytdlp:update' }) })
    sections.get('yt-dlp').unshift(
      h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'yt-dlp version' }), extras.versionNote), h('div', { class: 'setting-control' }, extras.version, extras.update)),
    )

    // Keyboard shortcut
    extras.shortcut = h('kbd', { text: '…' })
    const shortcutRows = [
      h(
        'div',
        { class: 'setting' },
        h('div', { class: 'setting-text' }, h('span', { class: 'label', text: bridge.platform === 'extension' ? 'Open Yoinks' : 'Shortcuts' }), h('p', { class: 'help', text: bridge.platform === 'extension' ? 'Your browser manages extension shortcuts.' : 'Ctrl+L link box · Ctrl+B batch · Ctrl+, settings · Esc back' })),
        h('div', { class: 'setting-control' }, bridge.platform === 'extension' ? extras.shortcut : null, bridge.openShortcutSettings ? button({ icon: 'external', text: 'Change', variant: 'secondary', onClick: bridge.openShortcutSettings }) : null),
      ),
    ]
    bridge.shortcut().then(key => (extras.shortcut.textContent = key || 'Not set'))

    // Data
    const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0]
      importInput.value = ''
      if (!file) return
      try {
        if (file.size > 100_000) throw new Error('too big')
        send({ type: 'settings:import', data: JSON.parse(await file.text()) })
      } catch {
        send({ type: 'toast', kind: 'error', text: 'That file is not a Yoinks settings export.' })
      }
    })
    function exportSettings() {
      const { termsAccepted, ...rest } = settings
      const blob = new Blob([JSON.stringify({ yoinksSettings: 1, ...rest }, null, 2)], { type: 'application/json' })
      const a = h('a', { href: URL.createObjectURL(blob), download: 'yoinks-settings.json' })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    const confirmReset = () => window.confirm('Reset all settings to their defaults?') && send({ type: 'settings:reset' })
    const confirmClear = () => window.confirm('Clear the list of recent downloads? Your files are not deleted.') && send({ type: 'history:clear' })
    const dataRow = h(
      'div',
      { class: 'button-grid' },
      button({ icon: 'upload', text: 'Export settings', variant: 'secondary', onClick: exportSettings }),
      button({ icon: 'download', text: 'Import settings…', variant: 'secondary', onClick: () => (bridge.isPopup && bridge.openFullPage ? bridge.openFullPage('settings') : importInput.click()) }),
      button({ icon: 'trash', text: 'Clear history', variant: 'secondary', onClick: confirmClear }),
      button({ icon: 'retry', text: 'Reset to defaults', variant: 'danger', onClick: confirmReset }),
      importInput,
    )

    const legalRow = h(
      'div',
      { class: 'button-grid' },
      button({ icon: 'file', text: 'Terms of use', variant: 'secondary', onClick: () => ctx.go('terms') }),
      button({ icon: 'info', text: 'Privacy', variant: 'secondary', onClick: () => ctx.go('privacy') }),
    )

    // Health check: tests the parts Yoinks needs and says which one is broken.
    extras.healthList = h('ul', { class: 'health-list', 'aria-live': 'polite' })
    extras.healthRun = button({ icon: 'health', text: 'Run health check', variant: 'secondary', onClick: () => send({ type: 'health:run' }) })
    extras.healthCopy = button({
      icon: 'copy',
      text: 'Copy results',
      variant: 'ghost',
      hidden: true,
      onClick: async () => {
        const report = lastHealth
        if (!report) return
        const lines = [`Yoinks ${bridge.version ?? '?'} (${bridge.platform === 'desktop' ? 'Windows app' : 'browser extension'}) health check`, ...report.checks.map(c => `${c.status.toUpperCase()}  ${c.label}: ${c.detail}`)]
        const ok = await copyText(lines.join('\n'))
        send({ type: 'toast', kind: ok ? 'success' : 'error', text: ok ? 'Results copied. Paste them in Discord or a GitHub issue.' : 'Could not copy.' })
      },
    })
    let lastHealth = null
    const healthCard = h(
      'section',
      { class: 'card settings-section', 'aria-labelledby': 'sec-Health' },
      h('h2', { id: 'sec-Health' }, icon('health', { size: 16 }), 'Health check'),
      h(
        'div',
        { class: 'setting' },
        h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'Is everything working?' }), h('p', { class: 'help', text: 'Checks yt-dlp, ffmpeg, your download folder and your connection.' })),
        h('div', { class: 'setting-control' }, extras.healthRun, extras.healthCopy),
      ),
      extras.healthList,
    )

    function renderHealth(health) {
      extras.healthRun.disabled = Boolean(health?.busy)
      extras.healthRun.querySelector('span').textContent = health?.busy ? 'Checking…' : health?.report ? 'Run again' : 'Run health check'
      const report = health?.report
      if (report === lastHealth) return
      lastHealth = report ?? null
      extras.healthCopy.hidden = !report
      extras.healthList.replaceChildren(
        ...(report?.checks ?? []).map(check =>
          h(
            'li',
            { class: `health-item health-${check.status}` },
            icon(check.status === 'ok' ? 'check' : check.status === 'warn' ? 'alert' : 'close', { size: 16 }),
            h('span', { class: 'health-label', text: check.label }),
            h('span', { class: 'health-detail', text: check.detail }),
          ),
        ),
      )
    }

    function renderSites(siteFormats) {
      const entries = Object.entries(siteFormats ?? {})
      extras.sites.hidden = entries.length === 0
      extras.sites.replaceChildren(
        h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'Remembered quality' }), h('p', { class: 'help', text: 'Websites where Yoinks skips the format list.' })),
        h(
          'div',
          { class: 'setting-control remembered' },
          entries.map(([site, format]) =>
            h(
              'span',
              { class: 'chip remembered-chip' },
              `${root.YoinksSites?.SITES.find(s => s.id === site)?.name ?? site}: ${Schema.FORMATS.find(([key]) => key === format)?.[1] ?? format}`,
              h('button', { type: 'button', class: 'chip-x', 'aria-label': `Forget ${site}`, title: 'Forget', onclick: () => send({ type: 'siteformat:forget', site }) }, icon('close', { size: 12 })),
            ),
          ),
        ),
      )
    }

    // Desktop app: where the browser extension lives and whether its helper is ready.
    let extensionCard = null
    if (bridge.extensionInfo) {
      const status = h('p', { class: 'help', 'aria-live': 'polite', text: 'Checking…' })
      const folder = h('span', { class: 'path mono', text: '' })
      const copyPath = button({ icon: 'copy', text: 'Copy path', variant: 'secondary', onClick: async () => send({ type: 'toast', kind: (await copyText(folder.textContent)) ? 'success' : 'error', text: 'Folder path copied.' }) })
      const openFolder = button({ icon: 'folder', text: 'Open folder', variant: 'secondary', onClick: () => bridge.openPath('extension') })
      const releases = button({ icon: 'external', text: 'Firefox / Waterfox file', variant: 'secondary', onClick: () => bridge.openExternal('https://github.com/bliper2/yoinks-gui-fork/releases/latest') })
      extensionCard = h(
        'section',
        { class: 'card settings-section', 'aria-labelledby': 'sec-ext' },
        h('h2', { id: 'sec-ext' }, icon('download', { size: 16 }), 'Browser extension'),
        h(
          'div',
          { class: 'setting setting-wide' },
          h('div', { class: 'setting-text' }, h('span', { class: 'label', text: 'Brave, Chrome, Edge' }), status, h('p', { class: 'help', text: 'Open your browser\'s extensions page, turn on Developer mode, choose Load unpacked and pick this folder:' })),
          h('div', { class: 'setting-control' }, folder),
        ),
        h('div', { class: 'button-grid' }, openFolder, copyPath, releases),
      )
      bridge.extensionInfo().then(info => {
        if (!info) return
        folder.textContent = info.folder
        status.textContent =
          info.mode === 'installed'
            ? info.ready
              ? 'The helper is set up. Nothing else to install.'
              : 'The helper could not be set up. Restart Yoinks, or reinstall it.'
            : info.mode === 'portable'
              ? 'This portable copy cannot set up the helper. Install Yoinks with the installer for one-step setup.'
              : 'Running from source: run npm run extension:install once.'
      })
    }

    // Search: hides every setting whose name or help does not match, and empty sections.
    const searchBox = h('input', { class: 'field settings-search', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings' })
    searchBox.addEventListener('input', () => {
      const words = searchBox.value.toLowerCase().split(/\s+/).filter(Boolean)
      for (const section of el.querySelectorAll('.settings-section')) {
        const rows = [...section.querySelectorAll('.setting')]
        let shown = 0
        for (const row of rows) {
          const match = words.every(word => (row.textContent ?? '').toLowerCase().includes(word))
          row.classList.toggle('search-hidden', !match)
          if (match && !row.hidden) shown++
        }
        const titleMatch = words.length && words.every(word => (section.querySelector('h2')?.textContent ?? '').toLowerCase().includes(word))
        if (titleMatch) rows.forEach(row => row.classList.remove('search-hidden'))
        section.classList.toggle('search-hidden', words.length > 0 && !titleMatch && (rows.length ? shown === 0 : true))
      }
    })

    const order = ['Look', 'Downloads', 'Audio', 'Tags', 'Playlists', 'Queue', 'yt-dlp']
    const el = h(
      'div',
      { class: 'settings' },
      h('h1', { class: 'headline' }, icon('settings', { size: 22 }), 'Settings'),
      h('p', { class: 'sub', text: 'Saved on this PC and shared by the Yoinks browser extension and desktop app.' }),
      searchBox,
      order.map(name =>
        h('section', { class: 'card settings-section', 'aria-labelledby': `sec-${name}` }, h('h2', { id: `sec-${name}` }, icon(SECTION_ICONS[name], { size: 16 }), name), sections.get(name)),
      ),
      healthCard,
      extensionCard,
      h('section', { class: 'card settings-section', 'aria-labelledby': 'sec-keys' }, h('h2', { id: 'sec-keys' }, icon('settings', { size: 16 }), 'Keyboard'), shortcutRows),
      h('section', { class: 'card settings-section', 'aria-labelledby': 'sec-data' }, h('h2', { id: 'sec-data' }, icon('file', { size: 16 }), 'Your data'), dataRow),
      h('section', { class: 'card settings-section', 'aria-labelledby': 'sec-about' }, h('h2', { id: 'sec-about' }, icon('info', { size: 16 }), 'About'), h('p', { class: 'help', text: `Yoinks ${bridge.version ?? ''} · No ads, no tracking, no accounts.` }), legalRow),
    )

    let askedVersion = false
    return {
      el,
      render(view) {
        settings = view.settings
        for (const [key, control] of controls) {
          control.set(settings[key])
          control.showError(view.settingsErrors?.[key] ?? '')
        }
        renderHealth(view.health)
        renderSites(settings.siteFormats)
        renderPresets(settings.presets ?? [])
        renderWatches(settings.watches ?? [])
        extras.version.textContent = view.ytdlp.version ?? (view.hostProblem ? 'unavailable' : '…')
        extras.versionNote.textContent = view.ytdlp.message || (view.ytdlp.version && !view.ytdlp.managed ? 'Installed on your system, not by Yoinks.' : view.hostProblem ?? '')
        extras.update.disabled = Boolean(view.ytdlp.busy)
        extras.update.querySelector('span').textContent = view.ytdlp.busy ? 'Updating…' : 'Update now'
        if (!askedVersion) {
          askedVersion = true
          send({ type: 'ytdlp:version' })
        }
      },
    }
  }

  root.YoinksViews = root.YoinksViews ?? {}
  root.YoinksViews.settings = { create }
})(typeof self !== 'undefined' ? self : this)
