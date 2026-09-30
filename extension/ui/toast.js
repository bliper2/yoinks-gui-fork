/*
 * Toast messages. The controller keeps a short list of toasts (with ids) in
 * its state; this shows each new one once, then hides it.
 */
;(function (root) {
  'use strict'
  const { h, icon } = root.YoinksDom

  let container = null
  let lastSeen = null

  function ensureContainer() {
    if (!container) {
      container = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
      document.body.append(container)
    }
    return container
  }

  function show({ kind = 'info', text }) {
    const node = h(
      'div',
      { class: `toast toast-${kind}` },
      icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', { size: 16 }),
      h('span', { text }),
      h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => node.remove() }, icon('close', { size: 14 })),
    )
    ensureContainer().append(node)
    setTimeout(() => node.classList.add('leaving'), kind === 'error' ? 7000 : 4000)
    setTimeout(() => node.remove(), kind === 'error' ? 7400 : 4400)
  }

  /** Show toasts from state that haven't been shown in this page yet. */
  function sync(toasts) {
    // On first state, don't replay old toasts.
    if (lastSeen === null) {
      lastSeen = toasts.at(-1)?.id ?? 0
      return
    }
    for (const toast of toasts) {
      if (toast.id > lastSeen) {
        show(toast)
        lastSeen = toast.id
      }
    }
  }

  root.YoinksToast = { show, sync }
})(typeof self !== 'undefined' ? self : this)
