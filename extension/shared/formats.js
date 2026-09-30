/*
 * Picking an entry from a format list by a wanted format ('best', '1080',
 * 'audio', …). Used by the engine (host default) and the queue controller
 * (batch, quick buttons, retries). Plain script / CommonJS.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksFormats = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  /**
   * Index of the best choice for `format`: audio -> the audio entry; a
   * height -> the tallest video that fits (else the smallest video);
   * 'best' -> the tallest video. -1 if nothing fits.
   */
  function pickChoice(choices, format) {
    if (!Array.isArray(choices) || !choices.length) return -1
    if (format === 'audio') return choices.findIndex(c => c.kind === 'audio')
    const videos = choices.map((c, i) => ({ ...c, i })).filter(c => c.kind === 'video')
    if (!videos.length) return choices.findIndex(c => c.kind === 'audio')
    if (!format || format === 'best') return videos[0].i
    const cap = Number(format)
    return (videos.find(c => c.height && c.height <= cap) ?? videos.at(-1)).i
  }

  /** The wanted-format string that reproduces a choice (for retries). */
  function formatOf(choice) {
    if (!choice) return 'best'
    if (choice.kind === 'audio') return 'audio'
    return choice.height ? String(choice.height) : 'best'
  }

  return { pickChoice, formatOf }
})
