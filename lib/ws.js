// Minimal RFC 6455 server-side WebSocket for one upgraded socket.
//
// The host webserver hands us the raw socket and the already-read `head`
// buffer; we own the handshake and the framing from there. Only the pieces a
// binary RDP relay needs are implemented: continuation frames, ping/pong and
// close. No extensions, no compression, no subprotocols.

import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE = 32 * 1024 * 1024

/**
 * Complete the upgrade handshake and return a connection.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head bytes the HTTP parser already consumed
 * @returns {WsConnection | null}
 */
export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string' || key.length === 0) {
    socket.destroy()
    return null
  }
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy()
    return null
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  const requested = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const protocol = requested.includes('guacamole') ? 'guacamole' : requested[0]
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : '') +
      '\r\n',
  )
  return new WsConnection(socket, head)
}

function encodeFrame(opcode, payload) {
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | opcode // FIN + opcode
  return Buffer.concat([header, payload])
}

export class WsConnection extends EventEmitter {
  constructor(socket, head) {
    super()
    this.socket = socket
    this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0)
    this.closed = false
    this.fragment = null
    this.fragmentOpcode = 0
    socket.setNoDelay(true)
    socket.on('data', (chunk) => {
      if (this.closed) return
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
      this.#drain()
    })
    socket.on('close', () => this.#finish())
    socket.on('error', (error) => {
      this.emit('error', error)
      this.#finish()
    })
    if (this.buffer.length) queueMicrotask(() => this.#drain())
  }

  send(data) {
    if (this.closed) return false
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
    return this.socket.write(encodeFrame(0x2, payload))
  }

  sendText(text) {
    if (this.closed) return false
    return this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
  }

  close(code = 1000) {
    if (this.closed) return
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code, 0)
    try {
      this.socket.write(encodeFrame(0x8, payload))
    } catch {
      // the peer may already be gone
    }
    this.socket.end()
  }

  destroy() {
    this.closed = true
    this.socket.destroy()
  }

  #finish() {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }

  #drain() {
    while (!this.closed) {
      const chunk = this.#readFrame()
      if (!chunk) return
      this.#handleFrame(chunk)
    }
  }

  #readFrame() {
    const buffer = this.buffer
    if (buffer.length < 2) return null
    const first = buffer[0]
    const second = buffer[1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < offset + 2) return null
      length = buffer.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      if (buffer.length < offset + 8) return null
      const value = buffer.readBigUInt64BE(offset)
      if (value > BigInt(MAX_MESSAGE)) {
        this.close(1009)
        return null
      }
      length = Number(value)
      offset += 8
    }
    if (length > MAX_MESSAGE) {
      this.close(1009)
      return null
    }
    let mask = null
    if (masked) {
      if (buffer.length < offset + 4) return null
      mask = buffer.subarray(offset, offset + 4)
      offset += 4
    }
    if (buffer.length < offset + length) return null
    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    this.buffer = buffer.subarray(offset + length)
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3]
    }
    return { fin, opcode, payload }
  }

  #handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case 0x0: // continuation
        if (!this.fragment) return
        this.fragment = Buffer.concat([this.fragment, payload])
        if (fin) {
          const message = this.fragment
          const messageOpcode = this.fragmentOpcode
          this.fragment = null
          this.fragmentOpcode = 0
          this.#emitMessage(messageOpcode, message)
        }
        break
      case 0x1: // text
      case 0x2: // binary
        if (!fin) {
          this.fragment = Buffer.from(payload)
          this.fragmentOpcode = opcode
          break
        }
        this.#emitMessage(opcode, payload)
        break
      case 0x8: // close
        this.close(1000)
        break
      case 0x9: // ping
        if (!this.closed) this.socket.write(encodeFrame(0xa, payload))
        break
      case 0xa: // pong
        break
      default:
        break
    }
  }

  #emitMessage(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload, true)
    else this.emit('message', payload, false)
  }
}
