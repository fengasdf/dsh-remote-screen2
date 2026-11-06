// Bridge one browser WebSocket to one guacd RDP session.
//
// The browser never talks to guacd directly: this module performs the guacd
// handshake (select -> args -> connect) with the settings of the selected
// machine, forwards the ready connection id to the browser (the instruction
// that opens a Guacamole.WebSocketTunnel), and then relays instructions in both
// directions. Display instructions are forwarded verbatim; only the handshake
// is parsed.

import net from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { GuacParser, encodeInstruction } from './guac-protocol.js'

const HANDSHAKE_TIMEOUT_MS = 20000

function errorInstruction(message) {
  return encodeInstruction(['error', message, 'CONNECTION_ERROR'])
}

/**
 * @param {import('./ws.js').WsConnection} ws
 * @param {{ host: string, rdpPort: number, vncPort: number, guacdPort: number }} machine
 * @param {{ width: number, height: number, dpi?: number, protocol?: 'rdp' | 'vnc' }} options
 */
export function handleGuacConnection(ws, machine, options) {
  const width = options.width
  const height = options.height
  const dpi = options.dpi || 96
  // rdp: xrdp starts its own desktop session. vnc: mirror the console display
  // through x11vnc, so the browser shows exactly what the VM window shows.
  const protocol = options.protocol === 'vnc' ? 'vnc' : 'rdp'
  const decoder = new StringDecoder('utf8')
  const pending = []
  let ready = false
  let closed = false

  const socket = net.connect({ host: machine.host, port: machine.guacdPort })
  socket.setNoDelay(true)

  const fail = (message) => {
    if (closed) return
    closed = true
    try {
      ws.sendText(errorInstruction(message))
    } catch {
      /* ignore */
    }
    try {
      ws.close(1011)
    } catch {
      /* ignore */
    }
    socket.destroy()
  }

  const timer = setTimeout(() => fail('guacd handshake timed out'), HANDSHAKE_TIMEOUT_MS)

  const settings =
    protocol === 'vnc'
      ? {
          hostname: '127.0.0.1',
          port: String(machine.vncPort || 5900),
          password: '',
          width: String(width),
          height: String(height),
          dpi: String(dpi),
          'read-only': 'false',
          'color-depth': '32',
          cursor: 'local',
        }
      : {
          hostname: '127.0.0.1',
          port: String(machine.rdpPort),
          username: '',
          password: '',
          width: String(width),
          height: String(height),
          dpi: String(dpi),
          security: 'any',
          'ignore-cert': 'true',
          'enable-drive': 'false',
          'create-drive-path': 'false',
          'disable-audio': 'true',
          'enable-clipboard': 'true',
          'disable-printing': 'true',
          'resize-method': 'display-update',
          'color-depth': '32',
        }

  const sendToGuacd = (elements) => socket.write(encodeInstruction(elements))

  const parser = new GuacParser((opcode, params, raw) => {
    if (opcode === 'args') {
      let version = '1_0_0'
      const values = params.map((name) => {
        if (name.startsWith('VERSION_')) {
          const offered = name.substring('VERSION_'.length)
          version = offered === '1_0_0' || offered === '1_1_0' ? offered : '1_1_0'
          return `VERSION_${version}`
        }
        const value = settings[name]
        return value === undefined || value === null ? '' : String(value)
      })
      sendToGuacd(['size', String(width), String(height), String(dpi)])
      sendToGuacd(['audio', 'audio/L16'])
      sendToGuacd(['video'])
      sendToGuacd(['image', 'image/png', 'image/jpeg'])
      if (version === '1_1_0') sendToGuacd(['timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'])
      sendToGuacd(['connect', ...values])
      return
    }
    if (opcode === 'ready') {
      clearTimeout(timer)
      ready = true
      const id = params[0] || ''
      ws.sendText(encodeInstruction(['', id]))
      for (const message of pending) socket.write(message)
      pending.length = 0
      return
    }
    // Any other instruction (including guacd errors) belongs to the client.
    ws.sendText(raw)
  })

  socket.on('connect', () => {
    sendToGuacd(['select', protocol])
  })

  socket.on('data', (chunk) => {
    parser.receive(decoder.write(chunk))
  })

  socket.on('error', (error) => {
    clearTimeout(timer)
    fail(`guacd connection failed: ${error.code || error.message}`)
  })

  socket.on('close', () => {
    clearTimeout(timer)
    if (closed) return
    closed = true
    try {
      ws.close(1000)
    } catch {
      /* ignore */
    }
  })

  ws.on('message', (data, isText) => {
    if (closed) return
    const message = isText ? data.toString('utf8') : data.toString('utf8')
    if (process.env.DSH_RD_DEBUG) console.log('[rd] ws->guacd', JSON.stringify(message.slice(0, 80)))
    // The Guacamole client sends tunnel-internal keep-alive pings with an empty
    // opcode; guacd has no business seeing them.
    if (message.startsWith('0.,')) return
    if (ready) socket.write(message)
    else pending.push(message)
  })

  ws.on('close', () => {
    closed = true
    clearTimeout(timer)
    socket.end()
    socket.destroy()
  })

  ws.on('error', () => {
    closed = true
    socket.destroy()
  })
}
