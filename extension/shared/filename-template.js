/*
 * File name templates like "{artist} - {title}".
 * - validate(): used by the settings schema (and so by every writer).
 * - preview(): the live example on the settings page.
 * - toYtdlp(): the yt-dlp output template the engine passes with -o.
 * Plain script in the extension, CommonJS in Node.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksTemplate = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // token -> yt-dlp field expression, and the sample value for previews.
  const TOKENS = {
    title: { ytdlp: '%(title).120B', sample: 'Never Gonna Give You Up' },
    artist: { ytdlp: '%(artist,creator,uploader|Unknown artist)s', sample: 'Rick Astley' },
    album: { ytdlp: '%(album|Unknown album)s', sample: 'Whenever You Need Somebody' },
    track: { ytdlp: '%(track,title).120B', sample: 'Never Gonna Give You Up' },
    uploader: { ytdlp: '%(uploader,channel|Unknown)s', sample: 'Rick Astley' },
    date: { ytdlp: '%(upload_date>%Y-%m-%d|)s', sample: '1987-11-12' },
    year: { ytdlp: '%(release_year,upload_date>%Y|)s', sample: '1987' },
    id: { ytdlp: '%(id)s', sample: 'dQw4w9WgXcQ' },
  }

  // Characters Windows forbids in file names; "%" would clash with yt-dlp.
  const FORBIDDEN = /[<>:"/\\|?*%\u0000-\u001f]/
  const PART = /\{([a-z]+)\}/g

  function validate(template) {
    const t = String(template ?? '').trim()
    if (!t) return 'cannot be empty'
    if (t.length > 120) return 'is too long (120 characters max)'
    const unknown = [...t.matchAll(PART)].map(m => m[1]).filter(name => !TOKENS[name])
    if (unknown.length) return `has an unknown part {${unknown[0]}}`
    if (!PART.test(t)) return 'needs at least one part like {title}'
    PART.lastIndex = 0
    const literal = t.replace(PART, '')
    if (FORBIDDEN.test(literal)) return 'cannot contain < > : " / \\ | ? * or %'
    if (/[{}]/.test(literal)) return 'has an unmatched { or }'
    if (/[. ]$/.test(t)) return 'cannot end with a dot or space'
    return null
  }

  function render(template, values) {
    return template.trim().replace(PART, (_, name) => values[name] ?? '')
  }

  /**
   * Example file name, e.g. for "{artist} - {title}" and ext "mp3":
   * "Rick Astley - Never Gonna Give You Up.mp3". With playlist options the
   * folder and number are shown too.
   */
  function preview(template, { ext = 'mp4', playlist = false, folder = true, numbered = true, folderBy = 'none' } = {}) {
    const error = validate(template)
    if (error) return { error: `File name ${error}.` }
    const sample = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, v.sample]))
    let name = `${render(template, sample)}.${ext}`
    if (playlist && numbered) name = `001 - ${name}`
    if (playlist && folder) name = `My Playlist\\${name}`
    if (folderBy === 'uploader') name = `Rick Astley\\${name}`
    else if (folderBy === 'site') name = `Youtube\\${name}`
    return { name }
  }

  /** yt-dlp output template (relative to the download folder). */
  const FOLDER_BY = {
    uploader: '%(uploader,channel|Unknown).60B',
    site: '%(extractor_key|Other)s',
  }

  function toYtdlp(template, { playlist = false, folder = true, numbered = true, folderBy = 'none' } = {}) {
    const error = validate(template)
    // Settings are validated on write; fall back to the default if a stale
    // value slips through rather than passing junk to yt-dlp.
    const t = error ? '{title}' : template.trim()
    let out = t.replace(PART, (_, name) => TOKENS[name].ytdlp) + '.%(ext)s'
    if (playlist && numbered) out = `%(playlist_index)03d - ${out}`
    if (playlist && folder) out = `%(playlist_title,playlist|Playlist).80B/${out}`
    if (FOLDER_BY[folderBy]) out = `${FOLDER_BY[folderBy]}/${out}`
    return out
  }

  return { TOKENS, validate, preview, toYtdlp }
})
