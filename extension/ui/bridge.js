/*
 * How the UI talks to the controller. The same UI runs in two places:
 * - extension pages (popup, settings tab): a port to background.js
 * - the desktop app: window.yoinksDesktop from preload.js (IPC to main)
 * Views only use this object, never chrome.* or Electron directly.
 */
;(function (root) {
  'use strict'

  function extensionBridge() {
    const port = chrome.runtime.connect({ name: 'yoinks-ui' })
    const listeners = []
    // The first state can arrive before the app script has subscribed
    // (the parser may yield between scripts), so replay the latest one.
    let latest = null
    port.onMessage.addListener(message => {
      if (message.type !== 'state') return
      latest = message.view
      listeners.forEach(fn => fn(latest))
    })
    const params = new URLSearchParams(location.search)
    return {
      platform: 'extension',
      // Opened from the toolbar (small popup) vs. as a tab (settings, batch).
      isPopup: !params.has('view'),
      initialView: params.get('view'),
      send: command => port.postMessage(command),
      onState: fn => {
        listeners.push(fn)
        if (latest) fn(latest)
      },
      readText: name => fetch(chrome.runtime.getURL(`legal/${name}.md`)).then(r => r.text()),
      openExternal: url => chrome.tabs.create({ url }),
      openFullPage: view => chrome.tabs.create({ url: chrome.runtime.getURL(`app.html?view=${encodeURIComponent(view)}`) }),
      async shortcut() {
        const commands = await chrome.commands.getAll()
        return commands.find(c => c.name === '_execute_action')?.shortcut || null
      },
      // Firefox/Waterfox can't open about: pages from tabs.create; it has its own call.
      openShortcutSettings: () => (chrome.commands.openShortcutSettings ? chrome.commands.openShortcutSettings() : chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })),
      async activeTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        return tab ?? null
      },
      async currentTime(tabId) {
        try {
          return await chrome.tabs.sendMessage(tabId, { type: 'currentTime' })
        } catch {
          return null // no content script on that page
        }
      },
      version: chrome.runtime.getManifest().version,
    }
  }

  function desktopBridge() {
    const api = root.yoinksDesktop
    return {
      platform: 'desktop',
      isPopup: false,
      initialView: null,
      send: api.send,
      onState: api.onState,
      readText: api.readLegal,
      openExternal: api.openExternal,
      openFullPage: null,
      shortcut: async () => null,
      openShortcutSettings: null,
      activeTab: async () => null,
      currentTime: async () => null,
      window: { minimize: api.minimize, close: api.close },
      pathOf: api.pathOf,
      onClipboard: api.onClipboard,
      extensionInfo: api.extensionInfo,
      openPath: api.openPath,
      version: api.version,
    }
  }

  root.YoinksBridge = root.yoinksDesktop ? desktopBridge() : extensionBridge()
})(typeof self !== 'undefined' ? self : this)
