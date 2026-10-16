/*
 * "Only download between set times": is the download window open now?
 * Windows can cross midnight (22:00 to 06:00). Equal start and end mean
 * "always open". Plain script / CommonJS, same rules as the Android app.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksSchedule = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  function minutesOf(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''))
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }

  /** True when new downloads may start at `now` (a Date). Off means always. */
  function isOpen(settings, now = new Date()) {
    if (!settings.scheduleOn) return true
    const from = minutesOf(settings.scheduleFrom)
    const to = minutesOf(settings.scheduleTo)
    if (from === null || to === null || from === to) return true
    const t = now.getHours() * 60 + now.getMinutes()
    return from < to ? t >= from && t < to : t >= from || t < to
  }

  /** Status line while the window is closed. Says "tomorrow" when today's window has already ended. */
  function waitLabel(settings, now = new Date()) {
    const from = settings.scheduleFrom
    const fromMin = minutesOf(from)
    const toMin = minutesOf(settings.scheduleTo)
    const t = now.getHours() * 60 + now.getMinutes()
    const tomorrow = fromMin != null && toMin != null && fromMin < toMin && t >= toMin
    return tomorrow ? `Waiting until ${from} tomorrow` : `Waiting until ${from}`
  }

  return { isOpen, minutesOf, waitLabel }
})
