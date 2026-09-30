/*
 * Settings, built from the shared schema (shared/settings-schema.js).
 * Every change is validated locally for instant feedback, then saved through
 * the controller -> helper -> settings.json (the one place settings live),
 * which validates again.
 */
;(function (root) {
  'use strict'
  const { h, icon, button } = root.YoinksDom
  const Schema = root.YoinksSettings
  const Template = root.YoinksTemplate
  const Theme = root.YoinksTheme

  const SECTION_ICONS = { Downloads: 'download', Audio: 'music', Tags: 'file', Playlists: 'list', Queue: 'list', 'yt-dlp': 'settings', Look: 'sun' }
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
        h('button', { type: 'button', role: 'radio', class: 'segment', 'aria-checked': 'false', dataset: { value }, onclick: () => save(field.key, value) }, icon(THEME_ICONS[value] ?? 'check', { size: 15 }), text),
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
        const video = Template.preview(control.value, { ext: 'mp4' })
        const audio = Template.preview(control.value, { ext: settings.audioFormat })
        const list = Template.preview(control.value, { ext: settings.audioFormat, playlist: true, folder: settings.playlistFolder, numbered: settings.playlistNumbered })
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

    const RENDERERS = { toggle: toggleField, select: selectField, number: numberField, text: textField, folder: folderField, segmented: segmentedField, accent: accentField, template: templateField }

    // ---------- sections ----------

    const sections = new Map()
    for (const field of Schema.FIELDS) {
      if (field.hidden) continue
      const control = RENDERERS[field.type](field)
      controls.set(field.key, control)
      if (!sections.has(field.section)) sections.set(field.section, [])
      sections.get(field.section).push(control.row)
    }

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

    const order = ['Look', 'Downloads', 'Audio', 'Tags', 'Playlists', 'Queue', 'yt-dlp']
    const el = h(
      'div',
      { class: 'settings' },
      h('h1', { class: 'headline' }, icon('settings', { size: 22 }), 'Settings'),
      h('p', { class: 'sub', text: 'Saved on this PC and shared by the Yoinks browser extension and desktop app.' }),
      order.map(name =>
        h('section', { class: 'card settings-section', 'aria-labelledby': `sec-${name}` }, h('h2', { id: `sec-${name}` }, icon(SECTION_ICONS[name], { size: 16 }), name), sections.get(name)),
      ),
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
