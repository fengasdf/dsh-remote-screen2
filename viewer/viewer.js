// Browser viewer: a Guacamole client talking to the host plugin's WebSocket
// bridge, which performs the guacd handshake and relays the RDP session.

const Guacamole = window.Guacamole

const stage = document.getElementById('stage')
const displayHost = document.getElementById('display')
const statusEl = document.getElementById('status')
const dot = document.getElementById('dot')
const titleEl = document.getElementById('title')
const targetEl = document.getElementById('target')
const reconnectBtn = document.getElementById('reconnect')
const fullscreenBtn = document.getElementById('fullscreen')
const closeBtn = document.getElementById('close')
const hint = document.getElementById('hint')
const hintOk = document.getElementById('hint-ok')
const mode = new URLSearchParams(location.search).get('protocol') === 'vnc' ? 'vnc' : 'rdp'

if (mode === 'vnc' && hint) {
  const hintTitle = hint.querySelector('.hint-title')
  const hintBody = hint.querySelector('.hint-body')
  if (hintTitle) hintTitle.textContent = '控制台镜像（VNC）'
  if (hintBody) {
    hintBody.textContent =
      '先点一下画面，键盘鼠标就会发送到远端；这里看到的就是 VM 窗口里的同一个桌面，不需要再登录。'
  }
}

function showHint() {
  if (hint) hint.classList.add('visible')
}

function hideHint(focusCanvas) {
  if (!hint || !hint.classList.contains('visible')) return
  hint.classList.remove('visible')
  if (focusCanvas) {
    try {
      window.focus()
      displayHost.focus()
    } catch {
      /* ignore */
    }
  }
}

hintOk.addEventListener('click', () => hideHint(true))
displayHost.addEventListener('pointerdown', () => hideHint(false))
document.addEventListener('keydown', () => hideHint(false), true)

let machine = null
let client = null
let keyboard = null
let mouse = null
let connectedOnce = false
let connectedAt = 0

function setStatus(text, tone = 'connecting') {
  statusEl.textContent = text
  statusEl.title = text
  statusEl.classList.toggle('bad', tone === 'error')
  dot.className = `dot ${tone}`
}

// A session that ends right after login usually means the remote refused to
// start a desktop (a local graphical session already owns the user, or no
// session manager could start), not that the password was wrong.
function dropped() {
  const quick = connectedAt > 0 && Date.now() - connectedAt < 20000
  setStatus(
    quick
      ? '刚登录就断开：远端可能已有本地图形会话占用同一用户，或 xrdp 桌面环境无法启动'
      : '会话已结束',
    'error',
  )
}

function fitDisplay() {
  if (!client) return
  const display = client.getDisplay()
  const width = display.getWidth()
  const height = display.getHeight()
  if (!width || !height) return
  const rect = stage.getBoundingClientRect()
  const scale = Math.min((rect.width - 20) / width, (rect.height - 20) / height, 1)
  display.scale(Math.max(scale, 0.1))
}

function scaledSize() {
  const rect = stage.getBoundingClientRect()
  const width = Math.max(640, Math.min(3840, Math.floor((rect.width || 1280) - 24)))
  const height = Math.max(480, Math.min(2160, Math.floor((rect.height || 800) - 24)))
  return { width: width - (width % 2), height: height - (height % 2) }
}

// The window around this page can be dragged or resized; resize the remote
// desktop with it (guacd's display-update resize) and fall back to scaling the
// display when the server cannot change size.
let resizeTimer = null
function requestResize() {
  if (!client) return
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!client) return
    const { width, height } = scaledSize()
    try {
      client.sendSize(width, height)
    } catch (error) {
      console.warn('[remote-desktop] resize failed:', error)
    }
    fitDisplay()
  }, 220)
}
window.addEventListener('resize', requestResize)

function attachInput() {
  keyboard = new Guacamole.Keyboard(document)
  keyboard.onkeydown = (keysym) => {
    client.sendKeyEvent(1, keysym)
    return false
  }
  keyboard.onkeyup = (keysym) => {
    client.sendKeyEvent(0, keysym)
    return false
  }

  mouse = new Guacamole.Mouse(displayHost)
  const send = (state) => client.sendMouseState(state, true)
  mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = send
  mouse.onmousewheel = (state) => client.sendMouseState(state, true)
}

function connect() {
  if (client) return
  const { width, height } = scaledSize()
  // The parent passes an absolute ws:// address built from the host's HTTP
  // origin; the app page itself lives on `dsh-app://app`, where the relative
  // form cannot become a WebSocket URL.
  const wsAddress = new URLSearchParams(location.search).get('ws')
  const tunnel = new Guacamole.WebSocketTunnel(wsAddress || '/remote-desktop/ws')
  client = new Guacamole.Client(tunnel)
  const display = client.getDisplay()
  displayHost.appendChild(display.getElement())
  display.onresize = (w, h) => {
    fitDisplay()
    statusEl.textContent =
      mode === 'vnc'
        ? `已连接 ${w}×${h} · 控制台镜像`
        : `已连接 ${w}×${h} · 点画面后输入 xrdp 账号密码`
  }
  window.addEventListener('resize', fitDisplay)

  client.onstatechange = (state) => {
    if (state === Guacamole.Client.State.CONNECTED) {
      connectedOnce = true
      connectedAt = Date.now()
      reconnectBtn.disabled = false
      showHint()
      setStatus(mode === 'vnc' ? '已连接 · 控制台镜像' : '已连接 · 点画面后输入 xrdp 账号密码', 'connected')
    } else if (state === Guacamole.Client.State.WAITING) {
      setStatus('等待远端桌面…', 'connecting')
    } else if (state === Guacamole.Client.State.DISCONNECTED) {
      dropped() 
      reconnectBtn.disabled = false
    }
  }
  client.onerror = (status) => {
    const message = status && status.message ? status.message : '未知错误'
    setStatus(`连接失败：${message}${status && status.code ? ` (${status.code})` : ''}`, 'error')
  }
  client.ondisconnect = () => dropped()

  attachInput()
  setStatus('正在建立会话…', 'connecting')
  client.connect(`machine=${encodeURIComponent(machine.id)}&width=${width}&height=${height}&protocol=${mode}`)
}

async function boot() {
  const id = new URLSearchParams(location.search).get('machine')
  try {
    const response = await fetch('/remote-desktop/machines', { cache: 'no-store' })
    const body = await response.json()
    machine = (body.machines || []).find((entry) => entry.id === id)
    if (!machine) throw new Error(id ? `未找到机器 ${id}` : '缺少机器参数')
  } catch (error) {
    setStatus(`无法加载机器列表：${error.message || error}`, 'error')
    return
  }
  titleEl.textContent = `远程桌面 · ${machine.name}`
  targetEl.textContent = `${machine.username ? `${machine.username}@` : ''}${machine.host}:${machine.rdpPort}`
  document.title = `远程桌面 · ${machine.name}`
  connect()
}

reconnectBtn.addEventListener('click', () => {
  location.reload()
})

fullscreenBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch (error) {
    setStatus(`全屏不可用：${error.message || error}`, 'error')
  }
})

closeBtn.addEventListener('click', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'remote-desktop-close' }, window.location.origin)
    return
  }
  window.close()
})

window.addEventListener('beforeunload', () => {
  try {
    client?.disconnect()
  } catch {
    /* ignore */
  }
})

boot()
