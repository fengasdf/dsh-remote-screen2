// Host half of the remote-desktop plugin.
//
// Serves the viewer page and the Guacamole JavaScript client out of this
// package, lists the SSH machines saved by dsh-remote, probes their RDP and
// guacd endpoints, and bridges one browser session to guacd, which speaks
// plain RDP to xrdp over TLS. Nothing is installed on the remote host by this
// plugin; guacd is the only expected service there (see the README).
//
// Routes are exact registrations on the bare web server, outside the `/api`
// fence: that fence belongs to dsh-client-connection and answers 404 for paths
// it does not own, and exact routes win over it.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptWebSocket } from './lib/ws.js'
import { handleGuacConnection } from './lib/guacd-bridge.js'
import { findMachine, loadMachines } from './lib/machines.js'
import { probeRdp, probeTcp } from './lib/probe.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const viewerRoot = path.join(here, 'viewer')

export const inject = ['webServer']

const BASE = '/remote-desktop'

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

export function apply(ctx) {
  const webServer = ctx.webServer

  const serveFile = (file, type) => async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    try {
      const body = await readFile(path.join(viewerRoot, file))
      response.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': body.length,
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`asset missing: ${file}`)
    }
  }

  const machines = (request, response) => {
    let origin = ''
    try {
      origin = webServer.getOrigin()
    } catch {
      /* before the listener is bound */
    }
    json(response, 200, { origin, machines: loadMachines() })
  }

  const probe = async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const machine = findMachine(url.searchParams.get('machine'))
    if (!machine) {
      json(response, 404, { error: 'unknown machine' })
      return
    }
    const [rdp, guacd] = await Promise.all([
      probeRdp(machine.host, machine.rdpPort),
      probeTcp(machine.host, machine.guacdPort),
    ])
    json(response, 200, { machine: machine.id, rdp, guacd })
  }

  const upgrade = (req, socket, head) => {
    try {
      const origin = webServer.getOrigin()
      const url = new URL(req.url, origin)
      if (url.pathname !== `${BASE}/ws`) {
        socket.destroy()
        return
      }
      const requestOrigin = req.headers.origin
      if (typeof requestOrigin === 'string' && requestOrigin.length > 0 && requestOrigin !== origin) {
        socket.destroy()
        return
      }
      const machine = findMachine(url.searchParams.get('machine'))
      if (!machine) {
        socket.destroy()
        return
      }
      const width = clamp(url.searchParams.get('width'), 640, 3840, 1280)
      const height = clamp(url.searchParams.get('height'), 480, 2160, 800)
      const protocol = url.searchParams.get('protocol') === 'vnc' ? 'vnc' : 'rdp'
      const connection = acceptWebSocket(req, socket, head)
      if (!connection) return
      handleGuacConnection(connection, machine, { width, height, dpi: 96, protocol })
    } catch (error) {
      console.warn('[remote-desktop] upgrade failed:', error?.message || error)
      socket.destroy()
    }
  }

  const routes = [
    [`${BASE}/machines`, machines],
    [`${BASE}/probe`, probe],
    [`${BASE}/viewer.html`, serveFile('index.html', 'text/html; charset=utf-8')],
    [`${BASE}/viewer.js`, serveFile('viewer.js', 'text/javascript; charset=utf-8')],
    [`${BASE}/guacamole.js`, serveFile('guacamole.js', 'text/javascript; charset=utf-8')],
    [`${BASE}/GUACAMOLE-LICENSE`, serveFile('GUACAMOLE-LICENSE', 'text/plain; charset=utf-8')],
  ]

  for (const [pathname, handler] of routes) {
    ctx.effect(
      () => webServer.register({ kind: 'exact', path: pathname, handler }),
      `remote-desktop: ${pathname}`,
    )
  }
  ctx.effect(
    () => webServer.registerUpgrade({ path: `${BASE}/ws`, handler: upgrade }),
    'remote-desktop: websocket route',
  )
}
