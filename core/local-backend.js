'use strict'

// The controller's backend for the desktop app: sessions run in-process
// instead of in a native-messaging helper. Same Session class, same checks.

const { Session } = require('./session')

/**
 * @param {{ pickFolder?: (current: string) => Promise<string|null> }} [options]
 */
function createLocalBackend(options = {}) {
  return {
    connect({ onMessage }) {
      const session = new Session(message => onMessage(message), options)
      return {
        post: message => session.handle(message),
        close: () => session.close(),
      }
    },

    // One request, one reply ('status' updates along the way are ignored).
    request(message) {
      return new Promise((resolve, reject) => {
        const session = new Session(reply => {
          if (reply.type === 'status') return
          session.close()
          if (reply.type === 'error') reject(Object.assign(new Error(reply.message), { code: reply.code }))
          else resolve(reply)
        }, options)
        session.handle(message)
      })
    },
  }
}

module.exports = { createLocalBackend }
