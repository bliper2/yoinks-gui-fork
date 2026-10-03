/*
 * What Yoinks knows about each supported site: how to recognize a media page,
 * whether it is music (audio by default, clean tags, square cover art),
 * whether a link is a whole playlist/album, and which yt-dlp extras help.
 * Any other link still goes to yt-dlp's generic support.
 * Plain script in the extension (popup, background, content scripts),
 * CommonJS in Node (engine and helper).
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YoinksSites = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const SITES = [
    {
      id: 'youtube-music',
      name: 'YouTube Music',
      host: /^music\.youtube\.com$/,
      media: /^\/(watch|playlist|browse)\b/,
      playlist: url => url.pathname === '/playlist' || url.pathname.startsWith('/browse/'),
      music: true,
    },
    {
      id: 'youtube',
      name: 'YouTube',
      host: /^((www|m)\.)?youtube\.com$|^youtu\.be$/,
      media: /^\/(watch|shorts\/|playlist|live\/)|^\/[\w-]{11}$/,
      playlist: url => url.pathname === '/playlist',
      music: false,
    },
    {
      id: 'spotify',
      name: 'Spotify',
      host: /^open\.spotify\.com$/,
      media: /^\/(intl-[\w-]+\/)?(track|album|playlist)\/[A-Za-z0-9]{22}/,
      playlist: url => /\/(album|playlist)\//.test(url.pathname),
      music: true,
      spotify: true,
    },
    {
      id: 'soundcloud',
      name: 'SoundCloud',
      host: /^(m\.)?soundcloud\.com$/,
      // /artist/track or /artist/sets/playlist, but not /discover, /you, …
      media: /^\/(?!discover|you|search|upload|charts|stream|feed|messages|notifications|settings|pages|terms|imprint|jobs|mobile|people|tags|popular)[^/]+\/(sets\/)?[^/]+\/?$/,
      playlist: url => /\/sets\//.test(url.pathname),
      music: true,
    },
    {
      id: 'bandcamp',
      name: 'Bandcamp',
      host: /^[\w-]+\.bandcamp\.com$/,
      media: /^\/(track|album)\//,
      playlist: url => url.pathname.startsWith('/album/'),
      music: true,
    },
    { id: 'tiktok', name: 'TikTok', host: /^(www\.)?tiktok\.com$/, media: /^\/@[^/]+\/(video|photo)\/\d+/, music: false },
    // Posts open as /reel/ID or, from a profile, /username/reel/ID.
    { id: 'instagram', name: 'Instagram', host: /^(www\.)?instagram\.com$/, media: /^\/([\w.]+\/)?(p|reel|reels|tv)\/[\w-]+/, music: false },
    { id: 'x', name: 'X', host: /^(www\.|mobile\.)?(x|twitter)\.com$/, media: /^\/[^/]+\/status\/\d+/, music: false },
    { id: 'vimeo', name: 'Vimeo', host: /^(www\.|player\.)?vimeo\.com$/, media: /^\/(video\/)?\d+|^\/channels\/[^/]+\/\d+/, music: false },
    { id: 'reddit', name: 'Reddit', host: /^(www|old|new)\.reddit\.com$/, media: /^\/(r|user)\/[^/]+\/comments\/\w+/, music: false },
    { id: 'facebook', name: 'Facebook', host: /^(www|m|web)\.facebook\.com$|^fb\.watch$/, media: /^\/(watch\/?$|reel\/\d+|[^/]+\/videos\/|share\/[vr]\/)/, music: false },
    { id: 'dailymotion', name: 'Dailymotion', host: /^(www\.)?dailymotion\.com$/, media: /^\/video\/\w+/, music: false },
    { id: 'streamable', name: 'Streamable', host: /^streamable\.com$/, media: /^\/[a-z0-9]{5,8}$/i, music: false },
    { id: 'rumble', name: 'Rumble', host: /^rumble\.com$/, media: /^\/v[\w-]+\.html/, music: false },
    {
      id: 'twitch',
      name: 'Twitch',
      host: /^(www\.|m\.|clips\.)?twitch\.tv$/,
      // VODs and clips; a channel page is a live stream, which never ends.
      media: /^\/videos\/\d+|^\/[^/]+\/clip\/[\w-]+/,
      music: false,
      // VODs are HLS: fetching several fragments at once is much faster.
      extraArgs: ['--concurrent-fragments', '4'],
    },
  ]

  function parse(url) {
    try {
      const u = new URL(url)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
    } catch {
      return null
    }
  }

  /** The site entry for a link, or null for "any other site". */
  function siteFor(url) {
    const u = parse(url)
    return u ? (SITES.find(site => site.host.test(u.hostname)) ?? null) : null
  }

  /** True for pages worth looking up as soon as the popup opens. */
  function isMediaPage(url) {
    const u = parse(url)
    const site = u && siteFor(url)
    if (!site) return false
    if (site.id === 'youtube' && u.pathname === '/watch') return u.searchParams.has('v')
    if (site.id === 'youtube-music' && u.pathname === '/watch') return u.searchParams.has('v')
    if (site.id === 'youtube-music' && u.pathname === '/playlist') return u.searchParams.has('list')
    if (site.id === 'twitch' && u.hostname === 'clips.twitch.tv') return u.pathname.length > 1
    if (site.id === 'facebook') {
      if (u.hostname === 'fb.watch') return u.pathname.length > 1
      if (u.pathname.replace(/\/$/, '') === '/watch') return u.searchParams.has('v')
      return /^\/(reel\/\d+|[^/]+\/videos\/|share\/[vr]\/)/.test(u.pathname)
    }
    return site.media.test(u.pathname)
  }

  /** The link itself is a playlist/album (not a video that sits in one). */
  function isPlaylistLink(url) {
    const u = parse(url)
    const site = u && siteFor(url)
    return Boolean(site?.playlist?.(u))
  }

  /** A YouTube video opened from a playlist: offer "whole playlist instead". */
  function hasPlaylistParam(url) {
    const u = parse(url)
    const site = u && siteFor(url)
    return Boolean(site && (site.id === 'youtube' || site.id === 'youtube-music') && u.pathname === '/watch' && u.searchParams.has('list'))
  }

  /** Same video, ignoring timestamps and tracking params (for YouTube). */
  function sameMedia(a, b) {
    if (a === b) return true
    const ua = parse(a)
    const ub = parse(b)
    if (!ua || !ub) return false
    const id = u => (u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v'))
    if (/youtu/.test(ua.hostname) && /youtu/.test(ub.hostname)) return id(ua) !== null && id(ua) === id(ub)
    return ua.origin + ua.pathname.replace(/\/$/, '') === ub.origin + ub.pathname.replace(/\/$/, '')
  }

  /**
   * The video/track links among `hrefs` (a page's anchors), without
   * duplicates: "Yoink all videos on this page". Playlist context and
   * tracking parameters are dropped so one video is not listed twice.
   */
  function mediaLinks(hrefs, limit = 300) {
    const found = new Set()
    for (const href of hrefs) {
      const u = parse(href)
      if (!u || !isMediaPage(u.href)) continue
      u.hash = ''
      for (const key of ['list', 'index', 'pp', 'si', 'feature', 't']) u.searchParams.delete(key)
      found.add(u.href)
      if (found.size >= limit) break
    }
    return [...found]
  }

  const isMusic = url => Boolean(siteFor(url)?.music)
  const isSpotify = url => Boolean(siteFor(url)?.spotify) && isMediaPage(url)

  return { SITES, siteFor, isMediaPage, isPlaylistLink, hasPlaylistParam, sameMedia, mediaLinks, isMusic, isSpotify }
})
