'use strict'

// A fake download engine for the controller: records what the controller
// sends to each job session and lets a test play the replies back.

const Controller = require('../extension/shared/controller.js')
const Schema = require('../extension/shared/settings-schema.js')

function makeController({ platform = 'extension', settings = {}, reply = {} } = {}) {
  const channels = []
  let current = { ...Schema.defaults(), termsAccepted: Schema.TERMS_VERSION, ...settings }
  const requests = []

  const backend = {
    connect(handlers) {
      const channel = { posts: [], closed: false, handlers, post: message => channel.posts.push(message), close: () => (channel.closed = true) }
      channels.push(channel)
      return channel
    },
    async request(message) {
      requests.push(message)
      if (reply[message.type]) return reply[message.type](message)
      if (message.type === 'settings:get') return { type: 'settings', settings: current, errors: {} }
      if (message.type === 'settings:set') {
        const result = Schema.validate(message.patch, current)
        current = result.settings
        return { type: 'settings', settings: current, errors: result.errors }
      }
      throw new Error(`unexpected request ${message.type}`)
    },
  }

  const notifications = []
  const controller = Controller.create({ backend, storage: { load: async () => ({}), save() {} }, notify: n => notifications.push(n), platform })
  const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))
  const send = (channel, message) => channel.handlers.onMessage(message)
  const lastChannel = () => channels.at(-1)
  return { controller, channels, requests, notifications, tick, send, lastChannel, settings: () => current }
}

const MEDIA = (extra = {}) => ({
  type: 'probed',
  kind: 'media',
  title: 'A video',
  uploader: 'someone',
  duration: 60,
  site: 'youtube',
  choices: [
    { kind: 'video', label: '1080p', height: 1080, ext: 'mp4' },
    { kind: 'video', label: '720p', height: 720, ext: 'mp4' },
    { kind: 'audio', label: 'Audio only', ext: 'mp3' },
  ],
  defaultIndex: 0,
  ...extra,
})

module.exports = { makeController, MEDIA }
