'use strict'

// Extension background worker: plugs the shared controller
// (shared/controller.js) into Chrome APIs. Each job is one native helper
// process (host/host.js) on its own port; an open port also keeps this worker
// alive. Pages (popup, settings tab), the in-page buttons and the context
// menu only send commands here.

importScripts('shared/settings-schema.js', 'shared/filename-template.js', 'shared/formats.js', 'shared/sites.js', 'shared/controller.js')

const HOST_NAME = 'com.yoinks.host'

function hostError(reason = '') {
  return /not found|forbidden|not allowed/i.test(reason)
    ? 'The Yoinks helper is not installed. In the yoinks-gui folder run "npm run extension:install", then restart the browser.'
    : `The Yoinks helper stopped. ${reason}`.trim()
}

// ---------- backend: the native helper ----------

const backend = {
  connect({ onMessage, onClose }) {
    const port = chrome.runtime.connectNative(HOST_NAME)
    let closedByUs = false
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(() => {
      if (!closedByUs) onClose(hostError(chrome.runtime.lastError?.message))
    })
    return {
      post: message => port.postMessage(message),
      close: () => {
        closedByUs = true
        port.disconnect()
      },
    }
  },

  // A port rather than sendNativeMessage: an open port keeps this worker
  // alive while, e.g., the folder dialog waits on the user.
  request(message) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative(HOST_NAME)
      port.onMessage.addListener(reply => {
        if (reply?.type === 'status') return
        port.disconnect()
        if (reply?.type === 'error') reject(new Error(reply.message))
        else resolve(reply)
      })
      port.onDisconnect.addListener(() => reject(new Error(hostError(chrome.runtime.lastError?.message))))
      port.postMessage(message)
    })
  },
}

// ---------- storage, notifications ----------

const storage = {
  load: () => chrome.storage.local.get(['history', 'settings']),
  save: partial => chrome.storage.local.set(partial),
}

function notify({ id, title, message, target }) {
  if (target) notificationTargets.set(id, target)
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    ...(target ? { buttons: [{ title: 'Show in folder' }] } : {}),
  })
}

const notificationTargets = new Map()

function onNotification(id) {
  chrome.notifications.clear(id)
  const target = notificationTargets.get(id) ?? controller.historyEntry(id)?.filepath
  if (target) controller.command({ type: 'file:reveal', filepath: target })
  else openPopup()
}
chrome.notifications.onClicked.addListener(onNotification)
chrome.notifications.onButtonClicked.addListener(onNotification)

// ---------- UI pages ----------

const pages = new Set()

function onState(view) {
  for (const port of pages) port.postMessage({ type: 'state', view })
  updateBadge(view)
}

function updateBadge(view) {
  const active = view.queue.filter(job => job.phase === 'downloading')
  let text = ''
  if (active.length === 1) {
    const percent = percentOf(active[0])
    text = percent === null ? '…' : `${percent}%`
  } else if (active.length > 1) text = String(active.length)
  else if (view.queue.some(job => job.phase === 'failed' || job.phase === 'review')) text = '!'
  else if (view.lookup?.phase === 'probing' || view.queue.some(job => job.phase === 'probing')) text = '…'
  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color: text === '!' ? '#e5484d' : '#7c5cff' })
}

function percentOf(job) {
  const p = job.progress
  const fraction = job.processing ? 1 : p?.totalBytes ? Math.min(1, p.downloadedBytes / p.totalBytes) : null
  if (job.item) return Math.floor(((job.item.index - 1 + (fraction ?? 0)) / job.item.count) * 100)
  return fraction === null ? null : Math.min(99, Math.floor(fraction * 100))
}

// In-page buttons show the state of jobs they started.
function onJobUpdate(job) {
  const tabId = job.source?.tabId
  if (typeof tabId !== 'number') return
  chrome.tabs
    .sendMessage(tabId, {
      type: 'yoinks:job',
      job: { id: job.id, url: job.url, phase: job.phase, percent: percentOf(job), error: job.error?.message ?? null },
    })
    .catch(() => {}) // tab closed or navigated away
}

const controller = YoinksController.create({ backend, storage, notify, onState, onJobUpdate, platform: 'extension' })

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'yoinks-ui' || port.sender?.id !== chrome.runtime.id) return
  pages.add(port)
  port.onDisconnect.addListener(() => pages.delete(port))
  port.onMessage.addListener(message => controller.command(message))
  controller.ready.then(() => {
    port.postMessage({ type: 'state', view: controller.view() })
    controller.command({ type: 'settings:refresh' })
  })
})

async function openPopup() {
  try {
    await chrome.action.openPopup()
  } catch {
    // No focused window, or not allowed right now: the badge still shows progress.
  }
}

// ---------- in-page buttons ----------

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return
  const source = { tabId: sender.tab.id }
  if (message?.type === 'page:quick') {
    controller.command({ type: 'quick', url: message.url, format: message.format, clip: message.clip ?? null, source })
  } else if (message?.type === 'page:choose') {
    controller.command({ type: 'lookup', url: message.url, playlist: message.playlist === true, source }).then(openPopup)
  } else if (message?.type === 'page:state') {
    // A button (re)loaded: tell it about a job already running for its page.
    const view = controller.view()
    const job = view.queue.find(j => j.source?.tabId === sender.tab.id && YoinksSites.sameMedia(j.url, message.url))
    reply(job ? { id: job.id, url: job.url, phase: job.phase, percent: percentOf(job), error: job.error?.message ?? null } : null)
  }
})

// ---------- context menu ----------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'yoink-link', title: 'Yoink link…', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'yoink-link-audio', title: 'Yoink link as audio', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'yoink-page', title: 'Yoink this page…', contexts: ['page', 'video', 'audio'] })
  })
  // First run: show the terms (and settings) once.
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html?view=terms') })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === 'yoink-page' ? info.pageUrl : info.linkUrl
  if (!/^https?:/.test(url ?? '')) return
  const source = tab?.id >= 0 ? { tabId: tab.id } : null
  if (info.menuItemId === 'yoink-link-audio') controller.command({ type: 'quick', url, format: 'audio', source: null })
  else controller.command({ type: 'lookup', url, source }).then(openPopup)
})
