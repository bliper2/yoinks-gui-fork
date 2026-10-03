/*
 * Where the Yoink buttons go on each site, and how they look there.
 * Sites with a clear action row get a native-looking button in it; the rest
 * (Instagram, X, Vimeo, Twitch, Spotify, single TikTok pages) get a small
 * floating button on media pages. A site can have more than one slot —
 * SoundCloud has one on track pages and one in the player bar. A slot with
 * `items` mounts one button per item, e.g. every video in TikTok's feed.
 * These sites are single-page apps that re-render, so each button is
 * re-attached whenever it goes missing or its track/video changes.
 * Uses shared/sites.js and content/button.js (loaded before this file).
 */
;(function () {
  'use strict'

  const Sites = self.YoinksSites
  const Button = self.YoinksPageButton

  const $ = selector => document.querySelector(selector)
  const pageUrl = () => location.href
  const watchPage = () => location.pathname === '/watch' && new URLSearchParams(location.search).has('v')

  // The playlist YouTube Music is playing from ("Playing from …" in Up Next).
  // Radio mixes (RD…, except curated RDCLAK… lists) are endless and can't be
  // opened as a playlist, so they get no "Yoink all".
  function ytmPlaylist() {
    const list = new URLSearchParams(location.search).get('list')
    if (!list || !/^[\w-]+$/.test(list) || (/^RD/.test(list) && !/^RDCLAK/.test(list))) return null
    return `https://music.youtube.com/playlist?list=${list}`
  }

  // The track in SoundCloud's bottom player bar, without "?in=playlist" noise.
  function soundcloudPlaying() {
    const href = $('.playbackSoundBadge__titleLink')?.getAttribute('href')
    if (!href) return null
    const u = new URL(href, location.origin)
    return u.origin + u.pathname
  }

  // A TikTok feed item's own link. The feed never changes the address bar, so
  // it is rebuilt from the video id (player element) and author (avatar link).
  function tiktokVideoUrl(item) {
    const id =
      item.querySelector('[id^="xgwrapper-"]')?.id.split('-').pop() ??
      item.querySelector('[data-more-menu-item-id]')?.getAttribute('data-more-menu-item-id')
    if (!/^\d{15,21}$/.test(id ?? '')) return null
    const author = item.querySelector('[data-e2e="video-author-avatar"]')?.closest('a')?.getAttribute('href')?.match(/^\/@([\w.-]+)/)?.[1] ?? ''
    return `https://www.tiktok.com/@${author}/video/${id}`
  }

  const FLOATING = {
    when: () => Sites.isMediaPage(location.href),
    url: pageUrl,
    target: () => document.body,
    insert: (body, host) => body.append(host),
    native: () => null,
    variant: 'floating',
  }

  // Each slot: when it applies, the link it downloads, where it mounts and
  // which native button it copies its look from.
  // variant: pill (action row) | icon (tight player bars) | text (link rows) |
  //          action (feed side column) | floating
  const SLOTS = {
    youtube: [
      {
        when: watchPage,
        url: pageUrl,
        target: () => $('ytd-watch-metadata #top-level-buttons-computed') ?? $('ytd-watch-metadata #actions-inner'),
        insert: (row, host) => row.prepend(host),
        native: row => row.querySelector('button'),
        variant: 'pill',
        gap: '0 8px 0 0',
      },
    ],
    'youtube-music': [
      {
        when: watchPage,
        url: pageUrl,
        // YouTube Music has two player bars; only one is on screen at a time.
        target: () =>
          [...document.querySelectorAll('ytmusic-player-bar .middle-controls-buttons')].find(el => el.getBoundingClientRect().width > 0) ??
          $('ytmusic-player-bar:not(#top-player-bar) .middle-controls-buttons'),
        insert: (row, host) => row.append(host),
        native: row => row.querySelector('button'),
        variant: 'icon',
        menuUp: true, // the player bar sits at the bottom of the window
      },
      {
        // "Yoink all" next to Save in the Up Next panel: the whole playlist.
        when: () => watchPage() && Boolean(ytmPlaylist()),
        url: ytmPlaylist,
        target: () => $('ytmusic-queue-header-renderer #buttons'),
        insert: (row, host) => row.prepend(host),
        native: row => row.querySelector('ytmusic-chip-cloud-chip-renderer a'),
        variant: 'pill',
        playlist: true,
        gap: '0 8px 0 0',
      },
    ],
    soundcloud: [
      {
        when: () => Sites.isMediaPage(location.href),
        url: pageUrl,
        target: () => $('.listenEngagement .sc-button-group'),
        insert: (row, host) => row.append(host),
        native: row => row.querySelector('.sc-button'),
        variant: 'pill',
        gap: '0 0 0 4px',
      },
      {
        // Quick download of whatever is playing, on every SoundCloud page.
        when: () => Boolean(soundcloudPlaying()),
        url: soundcloudPlaying,
        target: () => $('.playbackSoundBadge__actions') ?? $('.playControls__soundBadge'),
        insert: (row, host) => row.append(host),
        native: row => row.querySelector('.sc-button'),
        variant: 'icon',
        menuUp: true,
      },
    ],
    bandcamp: [
      {
        when: () => Sites.isMediaPage(location.href),
        url: pageUrl,
        target: () => $('.share-collect-controls ul'),
        insert: (row, host) => {
          const li = document.createElement('li')
          li.dataset.yoinks = ''
          li.append(host)
          row.append(li)
        },
        native: row => row.querySelector('.share-embed-label button, button, a'),
        variant: 'text',
      },
    ],
    tiktok: [
      {
        // For You / Following feed: a Yoink action in every video's side column.
        items: () => document.querySelectorAll('[data-e2e="recommend-list-item-container"]'),
        url: tiktokVideoUrl,
        target: item => item.querySelector('[data-e2e="like-icon"]')?.closest('section'),
        // After like/comment/save/share, before the spinning music disc.
        insert: (bar, host) => bar.insertBefore(host, bar.querySelector(':scope > a')),
        native: bar => bar.querySelector('[data-e2e="like-icon"] span > div'),
        variant: 'action',
        menuLeft: true,
      },
      FLOATING, // a single video's own page
    ],
  }

  const site = Sites.siteFor(location.href)
  if (!site) return

  function mediaElement() {
    return $('video.html5-main-video') ?? $('video') ?? $('audio')
  }

  function removeHost(host) {
    if (host.parentElement?.dataset.yoinks !== undefined) host.parentElement.remove()
    else host.remove()
  }

  /** Create, place and style a button for `url`; resume its running job. */
  function mount(place, target, url, getUrl, getTime) {
    const button = Button.create({
      variant: place.variant,
      getUrl,
      getTime,
      music: site.music,
      spotify: Boolean(site.spotify),
      playlist: Boolean(place.playlist),
      menuUp: place.menuUp || place.variant === 'floating',
      menuLeft: Boolean(place.menuLeft),
    })
    if (place.gap) button.host.style.margin = place.gap
    place.insert(target, button.host)
    button.copyStyle(place.native(target))
    // Pick up a download that was already running for this link.
    chrome.runtime
      .sendMessage({ type: 'page:state', url })
      .then(job => job && button.host.isConnected && button.update(job))
      .catch(() => {})
    return button
  }

  /** One mounted button and the link it belongs to. */
  function createSlot(place) {
    let button = null
    let mountedUrl = null
    let mountedTarget = null

    function remove() {
      const host = button?.host
      button = null
      mountedUrl = null
      mountedTarget = null
      if (host) removeHost(host)
    }

    function ensure() {
      if (!place.when()) return remove()
      const url = place.url()
      // A new video/track in the same spot: start fresh (idle state).
      if (button && !Sites.sameMedia(mountedUrl, url)) remove()
      // Still in the right place (the site may have swapped containers)?
      if (button?.host.isConnected && place.target() !== mountedTarget) remove()
      if (button?.host.isConnected) {
        // Follow the site's light/dark switch.
        button.copyStyle(place.native(mountedTarget))
        return
      }
      const target = place.target()
      if (!target) return
      button = mount(place, target, url, place.url, () => mediaElement()?.currentTime ?? null)
      mountedUrl = url
      mountedTarget = target
    }

    function update(job) {
      if (button && Sites.sameMedia(job.url, mountedUrl)) button.update(job)
    }

    return { ensure, update }
  }

  /** One button per item (feeds). Feeds recycle their elements, so each
   *  button is dropped when its item leaves or shows another video. */
  function createListSlot(place) {
    const mounted = new Map() // item element -> { button, url }

    function ensure() {
      for (const [item, entry] of mounted) {
        if (item.isConnected && entry.button.host.isConnected && place.url(item) === entry.url) continue
        removeHost(entry.button.host)
        mounted.delete(item)
      }
      for (const item of place.items()) {
        if (mounted.has(item)) continue
        const url = place.url(item)
        const target = url && place.target(item)
        if (!target) continue
        const button = mount(place, target, url, () => place.url(item) ?? url, () => item.querySelector('video')?.currentTime ?? null)
        mounted.set(item, { button, url })
      }
    }

    function update(job) {
      for (const { button, url } of mounted.values()) if (Sites.sameMedia(job.url, url)) button.update(job)
    }

    return { ensure, update }
  }

  const slots = (SLOTS[site.id] ?? [FLOATING]).map(place => (place.items ? createListSlot(place) : createSlot(place)))
  const ensureAll = () => slots.forEach(slot => slot.ensure())

  // Batch DOM churn. A timer, not requestAnimationFrame: rAF never fires in
  // background tabs, where autoplay still re-renders the page.
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      ensureAll()
    }, 200)
  }).observe(document.documentElement, { childList: true, subtree: true })
  addEventListener('yt-navigate-finish', ensureAll)
  addEventListener('popstate', ensureAll)
  ensureAll()

  // "Yoink all videos on this page": every link here that points at a video or
  // track of a supported site (a channel, playlist, search or profile page).
  const collectLinks = () => Sites.mediaLinks([...document.querySelectorAll('a[href]')].map(a => a.href))

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'yoinks:job') slots.forEach(slot => slot.update(message.job))
    else if (message?.type === 'currentTime') reply({ url: location.href, time: mediaElement()?.currentTime ?? null })
    else if (message?.type === 'collectLinks') reply({ urls: collectLinks() })
  })
})()
