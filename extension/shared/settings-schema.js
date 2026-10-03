/*
 * The one definition of every Yoinks setting: defaults, validation and the
 * labels the settings page renders from. Loaded as a plain script by the
 * extension and required by Node (desktop app + native helper), so the
 * rules can never drift between them.
 *
 * Settings are stored in one file, %APPDATA%\yoinks-gui\settings.json,
 * written only through core/settings-store.js, which validates with this.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksSettings = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // Bump when terms.md or privacy.md change in a way people must re-accept.
  const TERMS_VERSION = 1

  const FORMATS = [
    ['best', 'Best video'],
    ['2160', '4K (2160p)'],
    ['1440', '1440p'],
    ['1080', '1080p'],
    ['720', '720p'],
    ['480', '480p'],
    ['audio', 'Audio only'],
  ]
  const AUDIO_FORMATS = [
    ['mp3', 'MP3'],
    ['m4a', 'M4A (AAC)'],
    ['flac', 'FLAC (lossless)'],
    ['opus', 'Opus'],
  ]
  const BITRATES = [
    ['best', 'Best (VBR)'],
    ['320', '320 kbps'],
    ['256', '256 kbps'],
    ['192', '192 kbps'],
    ['128', '128 kbps'],
  ]
  const COOKIE_BROWSERS = [
    ['off', 'Off'],
    ['firefox', 'Firefox'],
    ['brave', 'Brave'],
    ['chrome', 'Chrome'],
    ['edge', 'Edge'],
  ]
  const THEMES = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]
  // Whole-look presets (shapes, surfaces, effects); ui/theme.css has them.
  const STYLES = [
    ['clean', 'Clean'],
    ['playful', 'Playful'],
    ['neon', 'Neon'],
    ['classic', 'Classic'],
  ]
  const NAV_BARS = [
    ['top', 'Top'],
    ['bottom', 'Floating bottom'],
  ]
  const MAX_PRESETS = 12
  const FOLDER_BY = [
    ['none', 'No extra folder'],
    ['uploader', 'Uploader or channel'],
    ['site', 'Website'],
  ]
  const ACCENTS = [
    ['violet', 'Violet'],
    ['ocean', 'Ocean'],
    ['sunset', 'Sunset'],
    ['forest', 'Forest'],
    ['rose', 'Rose'],
    ['custom', 'Custom'],
  ]

  // Every field: key, default, type, and what the settings page shows.
  // `section` groups fields on the page; `hidden` fields are not rendered.
  const FIELDS = [
    { key: 'outDir', section: 'Downloads', type: 'folder', default: '', label: 'Download folder', help: 'Empty means your Downloads folder.' },
    { key: 'defaultFormat', section: 'Downloads', type: 'select', options: FORMATS, default: 'best', label: 'Default format', help: 'Highlighted in the format list and used for batch and quick downloads.' },
    { key: 'alwaysUseFormat', section: 'Downloads', type: 'toggle', default: false, label: 'Always use the default format', help: 'Skip the format list and start downloading right away.' },
    { key: 'filenameTemplate', section: 'Downloads', type: 'template', default: '{title}', label: 'File name', help: 'Use {title}, {artist}, {album}, {track}, {uploader}, {date}, {year}, {id}.' },
    { key: 'folderBy', section: 'Downloads', type: 'select', options: FOLDER_BY, default: 'none', label: 'Sort into folders by', help: 'Puts each file in a folder named after its uploader or website.' },
    { key: 'clipboardWatch', section: 'Downloads', type: 'toggle', default: false, only: 'desktop', label: 'Offer links I copy', help: 'When you come back to Yoinks, a copied link is put in the link box.' },

    { key: 'audioFormat', section: 'Audio', type: 'select', options: AUDIO_FORMATS, default: 'mp3', label: 'Audio format' },
    { key: 'audioBitrate', section: 'Audio', type: 'select', options: BITRATES, default: 'best', label: 'Bitrate', help: 'Ignored for FLAC, which is lossless.' },

    { key: 'embedMetadata', section: 'Tags', type: 'toggle', default: true, label: 'Save title, artist, album and chapters' },
    { key: 'embedThumbnail', section: 'Tags', type: 'toggle', default: true, label: 'Add cover art' },
    { key: 'embedSubs', section: 'Tags', type: 'toggle', default: false, label: 'Add subtitles to videos' },
    { key: 'splitChapters', section: 'Tags', type: 'toggle', default: false, label: 'Also split videos with chapters into one file per chapter', help: 'Good for albums and mixes. The full file is kept too.' },
    { key: 'subsLang', section: 'Tags', type: 'text', default: 'en', label: 'Subtitle language', help: 'A language code like en, de or pt-BR.', maxLength: 10 },

    { key: 'playlistFolder', section: 'Playlists', type: 'toggle', default: true, label: 'Save playlists and albums in their own folder' },
    { key: 'playlistNumbered', section: 'Playlists', type: 'toggle', default: true, label: 'Number the files (001, 002, …)' },

    { key: 'concurrency', section: 'Queue', type: 'number', min: 1, max: 5, step: 1, default: 2, label: 'Downloads at the same time' },
    { key: 'speedLimit', section: 'Queue', type: 'number', min: 0, max: 1000, step: 0.5, default: 0, label: 'Speed limit per download (MB/s)', help: '0 means no limit.' },
    { key: 'retries', section: 'Queue', type: 'number', min: 0, max: 10, step: 1, default: 2, label: 'Retry failed downloads', help: 'How many times to try again after a network error.' },
    { key: 'notifications', section: 'Queue', type: 'toggle', default: true, label: 'Show a notification when a download finishes or fails' },
    { key: 'confirmClose', section: 'Queue', type: 'toggle', default: true, only: 'desktop', label: 'Ask before closing while downloads are running' },
    { key: 'scheduleOn', section: 'Queue', type: 'toggle', default: false, only: 'desktop', label: 'Only download between set times', help: 'Waiting downloads start when the window opens. Running ones are not interrupted.' },
    { key: 'scheduleFrom', section: 'Queue', type: 'time', default: '01:00', only: 'desktop', label: 'Start at' },
    { key: 'scheduleTo', section: 'Queue', type: 'time', default: '07:00', only: 'desktop', label: 'Stop starting new downloads at' },

    { key: 'ytdlpAutoUpdate', section: 'yt-dlp', type: 'toggle', default: true, label: 'Keep yt-dlp up to date (checks weekly)' },
    { key: 'cookiesFromBrowser', section: 'yt-dlp', type: 'select', options: COOKIE_BROWSERS, default: 'off', label: 'Use browser cookies', help: 'For age-restricted or members-only videos.' },

    { key: 'style', section: 'Look', type: 'segmented', options: STYLES, default: 'clean', label: 'Style' },
    { key: 'theme', section: 'Look', type: 'segmented', options: THEMES, default: 'system', label: 'Theme' },
    { key: 'navBar', section: 'Look', type: 'segmented', options: NAV_BARS, default: 'top', label: 'Navigation buttons' },
    { key: 'accent', section: 'Look', type: 'accent', options: ACCENTS, default: 'violet', label: 'Accent color' },
    { key: 'customAccent', section: 'Look', type: 'color', default: '#8b6bff', label: 'Custom color', hidden: true },

    { key: 'termsAccepted', type: 'number', min: 0, max: 1000, step: 1, default: 0, hidden: true },
    // Version whose "what's new" the user has seen; '' on a fresh install.
    { key: 'lastSeenVersion', type: 'text', default: '', maxLength: 20, hidden: true },
    // Remembered quality per website: { youtube: '720', soundcloud: 'audio' }.
    { key: 'siteFormats', type: 'map', default: {}, hidden: true },
    // Named combinations: [{ id, name, format, audioFormat ('' = your default), embedSubs, embedThumbnail }].
    { key: 'presets', type: 'presets', default: [], hidden: true },
  ]

  const BY_KEY = Object.fromEntries(FIELDS.map(field => [field.key, field]))

  function defaults() {
    const copy = value => (Array.isArray(value) ? [...value] : typeof value === 'object' ? { ...value } : value)
    return Object.fromEntries(FIELDS.map(field => [field.key, copy(field.default)]))
  }

  // Returns [value, error]. Values from files and other processes are
  // untrusted, so every type is checked strictly.
  function validateField(field, value) {
    switch (field.type) {
      case 'toggle':
        return typeof value === 'boolean' ? [value] : [field.default, 'must be on or off']
      case 'select':
      case 'segmented':
      case 'accent':
        return field.options.some(([key]) => key === value) ? [value] : [field.default, 'is not one of the choices']
      case 'number': {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
        if (typeof n !== 'number' || !Number.isFinite(n)) return [field.default, 'must be a number']
        if (n < field.min || n > field.max) return [field.default, `must be between ${field.min} and ${field.max}`]
        return [field.step >= 1 ? Math.round(n) : n]
      }
      case 'color':
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? [value.toLowerCase()] : [field.default, 'must be a color like #8b6bff']
      case 'folder':
        if (value === '') return ['']
        // Absolute Windows (C:\…, \\server\share) or POSIX path, no control chars.
        return typeof value === 'string' && value.length < 260 && !/[\u0000-\u001f"<>|?*]/.test(value.replace(/^[A-Za-z]:/, '')) && /^([A-Za-z]:[\\/]|\\\\|\/)/.test(value)
          ? [value]
          : [field.default, 'must be a full folder path']
      case 'template': {
        const error = typeof value === 'string' ? templateModule().validate(value) : 'must be text'
        return error ? [field.default, error] : [value.trim()]
      }
      case 'time':
        return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? [value] : [field.default, 'must be a time like 07:30']
      case 'presets': {
        if (!Array.isArray(value) || value.length > MAX_PRESETS) return [[], 'is not a list of presets']
        const clean = []
        for (const item of value) {
          const ok =
            item &&
            typeof item === 'object' &&
            /^[a-z0-9]{1,12}$/.test(item.id) &&
            typeof item.name === 'string' &&
            item.name.trim().length >= 1 &&
            item.name.length <= 24 &&
            !/[\u0000-\u001f]/.test(item.name) &&
            FORMATS.some(([key]) => key === item.format) &&
            (item.audioFormat === '' || AUDIO_FORMATS.some(([key]) => key === item.audioFormat)) &&
            typeof item.embedSubs === 'boolean' &&
            typeof item.embedThumbnail === 'boolean'
          if (!ok) return [[], 'has a preset that is not valid']
          clean.push({ id: item.id, name: item.name.trim(), format: item.format, audioFormat: item.audioFormat, embedSubs: item.embedSubs, embedThumbnail: item.embedThumbnail })
        }
        return [clean]
      }
      case 'map': {
        const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null
        const ok = entries && entries.length <= 40 && entries.every(([site, format]) => /^[a-z0-9-]{1,30}$/.test(site) && FORMATS.some(([key]) => key === format))
        return ok ? [Object.fromEntries(entries)] : [{}, 'is not a list of sites and formats']
      }
      case 'text':
        if (field.key === 'lastSeenVersion') {
          return typeof value === 'string' && /^[0-9A-Za-z.\-]{0,20}$/.test(value) ? [value] : [field.default, 'is not a version']
        }
        if (field.key === 'subsLang') {
          return typeof value === 'string' && /^([a-z]{2,3}(-[A-Za-z0-9]{2,4})?|all)$/.test(value.trim())
            ? [value.trim()]
            : [field.default, 'must be a language code like en or pt-BR']
        }
        return typeof value === 'string' && value.length <= (field.maxLength ?? 200) ? [value] : [field.default, 'is too long']
      default:
        return [field.default, 'is unknown']
    }
  }

  // Looked up lazily so the two files can load in any order.
  function templateModule() {
    return typeof module === 'object' && module.exports ? require('./filename-template.js') : self.YoinksTemplate
  }

  /**
   * Merge `patch` into `current` (or defaults). Unknown keys are ignored.
   * Returns { settings, errors } where errors maps key -> message; invalid
   * values keep the current value.
   */
  function validate(patch, current = defaults()) {
    const base = { ...defaults(), ...current }
    const settings = { ...base }
    const errors = {}
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { settings, errors: { _: 'Settings must be an object.' } }
    for (const [key, value] of Object.entries(patch)) {
      const field = BY_KEY[key]
      if (!field) continue
      const [clean, error] = validateField(field, value)
      if (error) {
        errors[key] = `${field.label ?? key} ${error}.`
        settings[key] = base[key]
      } else settings[key] = clean
    }
    return { settings, errors }
  }

  /** Clean a whole stored object (e.g. settings.json), dropping bad values. */
  function sanitize(stored) {
    return validate(stored ?? {}, defaults()).settings
  }

  return { TERMS_VERSION, FIELDS, BY_KEY, FORMATS, AUDIO_FORMATS, COOKIE_BROWSERS, FOLDER_BY, MAX_PRESETS, defaults, validate, sanitize }
})
