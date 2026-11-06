// Reachability probe for one saved machine's RDP endpoint.
//
// Performs the same X.224 negotiation a real client does, then a TLS handshake
// when the server selects TLS. It is read-only on the server: xrdp logs a
// connection that is closed before authentication.

import net from 'node:net'
import tls from 'node:tls'

const TIMEOUT_MS = 6000

function negotiationRequest(requestedProtocols) {
  const request = Buffer.alloc(19)
  Buffer.from('03000013', 'hex').copy(request, 0) // TPKT
  Buffer.from('0ee00000000000', 'hex').copy(request, 4) // X.224 Connection Request
  Buffer.from('01000800', 'hex').copy(request, 11) // RDP Negotiation Request
  request.writeUInt32LE(requestedProtocols, 15)
  return request
}

function withTimeout(promise, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Check that a plain TCP port accepts a connection.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ reachable: boolean, error: string | null }>}
 */
export function probeTcp(host, port) {
  return withTimeout(
    new Promise((resolve) => {
      const socket = net.connect({ host, port })
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve({ reachable: !error, error: error || null })
      }
      socket.once('connect', () => finish(null))
      socket.once('error', (error) => finish(error.code || error.message))
    }),
    `probe ${host}:${port}`,
  ).catch((error) => ({ reachable: false, error: error.message }))
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ reachable: boolean, tls: boolean, protocol: number | null, certCN: string | null, error: string | null }>}
 */
export function probeRdp(host, port) {
  return withTimeout(
    new Promise((resolve) => {
      const result = { reachable: false, tls: false, protocol: null, certCN: null, error: null }
      const socket = net.connect({ host, port })
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(result)
      }
      socket.once('error', (error) => {
        result.error = error.code || error.message
        finish()
      })
      socket.once('connect', () => {
        result.reachable = true
        socket.write(negotiationRequest(0x03))
      })
      let buffered = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buffered = Buffer.concat([buffered, chunk])
        if (buffered.length < 19) return
        result.protocol = buffered.readUInt32LE(15)
        socket.removeAllListeners('data')
        if (result.protocol !== 1 && result.protocol !== 2) {
          finish()
          return
        }
        const secure = tls.connect(
          { socket, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false },
          () => {
            const cert = secure.getPeerCertificate(true)
            result.tls = true
            result.certCN = cert?.subject?.CN || null
            secure.destroy()
            finish()
          },
        )
        secure.once('error', (error) => {
          result.error = `TLS: ${error.message}`
          finish()
        })
      })
    }),
    `probe ${host}:${port}`,
  ).catch((error) => ({
    reachable: false,
    tls: false,
    protocol: null,
    certCN: null,
    error: error.message,
  }))
}
