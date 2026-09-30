/*
 * Turns raw yt-dlp / ffmpeg / system errors into plain-English messages.
 * Used by the engine (main/ytdlp.js), so the desktop app and the extension
 * show the same wording. Each result says whether retrying could help, which
 * the download queue uses for automatic retries.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksErrors = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // Checked in order; first match wins.
  const RULES = [
    { code: 'drm', test: /\bDRM\b|drm.?protected/i, retryable: false, message: 'This content is DRM-protected. Yoinks does not bypass DRM, so it cannot be downloaded.' },
    { code: 'cookies', test: /could not (copy|find|decrypt).*cookie|cookies? database|failed to decrypt|cookies from browser/i, retryable: false, message: 'Could not read cookies from the browser chosen in Settings. Close that browser completely and try again, or choose Firefox.' },
    { code: 'age', test: /confirm your age|age.?restricted|inappropriate for some users/i, retryable: false, message: 'This video is age-restricted. Turn on “Use browser cookies” in Settings (while signed in to the site) to download it.' },
    { code: 'bot', test: /confirm you.?re not a bot|sign in to confirm/i, retryable: false, message: 'The site wants to check you are not a bot. Wait a while, or turn on “Use browser cookies” in Settings.' },
    { code: 'members', test: /members.?only|join this channel|channel.?s members|premium members|subscriber.?only/i, retryable: false, message: 'This is for members or subscribers only. Turn on “Use browser cookies” in Settings if you have access.' },
    { code: 'private', test: /private video|this video is private|is private/i, retryable: false, message: 'This video is private.' },
    { code: 'login', test: /login required|log in|sign in to view|requires authentication|rate-limit reached or login|empty media response/i, retryable: false, message: 'The site needs you to be signed in. Turn on “Use browser cookies” in Settings.' },
    { code: 'region', test: /not (made this video )?available in your country|geo.?restrict|not available from your location/i, retryable: false, message: 'This video is blocked in your country.' },
    { code: 'copyright', test: /copyright/i, retryable: false, message: 'This video was taken down for copyright reasons.' },
    { code: 'live', test: /premieres in|live event will begin|this live event|is not currently live|upcoming live/i, retryable: false, message: 'This live stream or premiere has not started yet.' },
    { code: 'removed', test: /video (is )?unavailable|video is not available|has been removed|no longer available|does not exist|not found \(404\)|HTTP Error 404/i, retryable: false, message: 'This video is unavailable. It may have been removed.' },
    { code: 'unsupported', test: /unsupported url|no suitable extractor/i, retryable: false, message: 'This link is not supported. Try the link of the video page itself.' },
    { code: 'format', test: /requested format is not available|no video formats found/i, retryable: false, message: 'That format is not available for this video. Pick another one.' },
    { code: 'ffmpeg', test: /ffmpeg.*not (found|installed)|ffprobe.*not found/i, retryable: false, message: 'ffmpeg is missing. Put ffmpeg.exe next to the app (it ships with Yoinks).' },
    { code: 'disk', test: /no space left|ENOSPC|disk (is )?full/i, retryable: false, message: 'The disk is full.' },
    { code: 'folder', test: /permission denied|EACCES|EPERM|access is denied|unable to open for writing/i, retryable: false, message: 'Yoinks cannot write to the download folder. Choose another folder in Settings.' },
    { code: 'ratelimit', test: /HTTP Error 429|too many requests/i, retryable: true, message: 'The site is limiting downloads right now. Try again in a few minutes.' },
    { code: 'forbidden', test: /HTTP Error 403|forbidden/i, retryable: true, message: 'The site refused the download (error 403). Updating yt-dlp in Settings usually fixes this.' },
    { code: 'network', test: /timed out|timeout|connection (reset|refused|aborted)|getaddrinfo|ENOTFOUND|ECONNRESET|unable to download (webpage|json)|network is unreachable|fetch failed|SSL/i, retryable: true, message: 'Network problem. Check your connection and try again.' },
  ]

  /**
   * @param {string} raw  yt-dlp stderr, an Error message, or similar.
   * @returns {{code: string, message: string, retryable: boolean, detail: string}}
   */
  function friendly(raw) {
    const text = String(raw ?? '')
    const detail = lastErrorLine(text)
    for (const rule of RULES) {
      if (rule.test.test(text)) return { code: rule.code, message: rule.message, retryable: rule.retryable, detail }
    }
    return { code: 'unknown', message: detail || 'Something went wrong.', retryable: true, detail }
  }

  // The last "ERROR:" line without yt-dlp's "[extractor] id:" prefix.
  function lastErrorLine(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
    const errors = lines.filter(line => line.startsWith('ERROR:'))
    const line = errors.at(-1) ?? lines.at(-1) ?? ''
    return line.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 300)
  }

  return { friendly }
})
