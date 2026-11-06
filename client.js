// Client half of the remote-desktop plugin.
//
// A sidebar entry opens a `main` page: it lists the SSH machines saved by
// dsh-remote and the desktop sessions that are currently open, and it opens
// new sessions. The windows themselves live in a module-level store rendered
// through the root `shell.overlay` slot, so switching conversations or panels
// never closes them; several sessions can stay open at once, each can be
// shown/hidden, and disconnecting is an explicit choice.

window.__ModuleLoader__.load({
  id: 'dsh-remote-screen',
  factory(require) {
    const React = require('react')
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()
    const h = React.createElement
    const NS = 'remote-desktop'

    const DICT = {
      zh: {
        nav: '远程桌面',
        title: '远程桌面',
        subtitle: '从已保存的 SSH 机器里选一台，在应用内的独立浮窗中打开 RDP 桌面（TLS 直连 xrdp）。',
        refresh: '刷新',
        open: '打开桌面',
        openMirror: '镜像控制台',
        modeRdp: '独立桌面',
        modeVnc: '控制台镜像',
        show: '显示',
        passwordHint: '账号密码在远端的 xrdp 登录画面里输入，本插件不保存密码。若登录后立刻黑屏/断开，通常是远端同一用户已有本地图形会话或 xrdp 桌面环境起不来；可给 xrdp 配置轻量桌面（如 XFCE）。',
        empty: '还没有保存的 SSH 机器。先在「设置 → 远程工作区」里连接一台机器，再回到这里。',
        loading: '正在读取机器列表…',
        loadFailed: '读取机器列表失败：',
        stateChecking: '检测中…',
        stateReady: '网关就绪',
        statePlain: 'RDP 未加密',
        stateDown: '不可达',
        stateNoGateway: '缺 guacd',
        stateUnknown: '未知',
        popupBlocked: '',
        remote: '远端',
        rdp: 'RDP',
        probeError: '检测失败：',
        viewerTitle: '远程桌面',
        closeViewer: '关闭',
        maximize: '最大化',
        restore: '还原',
        listTitle: '已打开的桌面',
        listRunning: '窗口打开',
        listHidden: '窗口已关闭',
        showWindow: '显示窗口',
        menuShow: '显示窗口',
        menuHide: '仅关闭窗口',
        menuDisconnect: '断开连接',
        confirmTitle: '关闭桌面窗口？',
        confirmBody: '仅关闭窗口会保持远端连接（可在列表里重新显示）；断开连接会结束这次 xrdp 会话。',
        confirmKeep: '仅关闭窗口',
        confirmDisconnect: '断开连接并关闭',
        cancel: '取消',
      },
      en: {
        nav: 'Remote desktop',
        title: 'Remote desktop',
        subtitle: 'Pick a saved SSH machine and open its RDP desktop in a floating window inside the app (TLS to xrdp).',
        refresh: 'Refresh',
        open: 'Open desktop',
        openMirror: 'Mirror console',
        modeRdp: 'Session',
        modeVnc: 'Console mirror',
        show: 'Show',
        passwordHint: 'Sign in on the remote xrdp login screen; this plugin never stores the password. If the session drops right after login, the remote probably already has a local graphical session for that user, or its desktop session cannot start; a lightweight desktop such as XFCE for xrdp fixes it.',
        empty: 'No saved SSH machine yet. Connect one under Settings → Remote workspaces first.',
        loading: 'Loading machines…',
        loadFailed: 'Could not load machines: ',
        stateChecking: 'Checking…',
        stateReady: 'Gateway ready',
        statePlain: 'RDP without TLS',
        stateDown: 'Unreachable',
        stateNoGateway: 'No guacd',
        stateUnknown: 'Unknown',
        popupBlocked: '',
        remote: 'Remote',
        rdp: 'RDP',
        probeError: 'Probe failed: ',
        viewerTitle: 'Remote desktop',
        closeViewer: 'Close',
        maximize: 'Maximize',
        restore: 'Restore',
        listTitle: 'Open desktops',
        listRunning: 'Window open',
        listHidden: 'Window closed',
        showWindow: 'Show window',
        menuShow: 'Show window',
        menuHide: 'Close window only',
        menuDisconnect: 'Disconnect',
        confirmTitle: 'Close the desktop window?',
        confirmBody: 'Closing the window keeps the remote connection (show it again from the list); disconnecting ends this xrdp session.',
        confirmKeep: 'Close window only',
        confirmDisconnect: 'Disconnect and close',
        cancel: 'Cancel',
      },
    }

    let t = (key) => (DICT.zh[key] !== undefined ? DICT.zh[key] : DICT.en[key] !== undefined ? DICT.en[key] : key)

    function wireLocale(ctx) {
      try {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
        ctx.effect(() => locale.register(NS, DICT), 'remote-desktop: locale')
        const bound = locale.bind(NS)
        t = (key) => {
          const translated = bound(key)
          if (translated !== key) return translated
          return DICT.zh[key] !== undefined ? DICT.zh[key] : DICT.en[key] !== undefined ? DICT.en[key] : key
        }
      } catch {
        /* keep the local dictionary */
      }
    }

    const styles = `
      .rd-page { height: 100%; overflow: auto; padding: 28px 24px 40px; box-sizing: border-box; }
      .rd-inner { max-width: 860px; margin: 0 auto; }
      .rd-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 22px; }
      .rd-mark { width: 40px; height: 40px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 14%, transparent);
        color: var(--dsw-alias-brand-primary, #4c8dff); }
      .rd-head h1 { margin: 0 0 4px; font-size: 19px; line-height: 1.3; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8ee); }
      .rd-head p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #98a2b3); }
      .rd-actions { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
      .rd-btn { appearance: none; font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer;
        border: 1px solid var(--dsw-alias-border-l1, #2a2e37); background: transparent; color: var(--dsw-alias-label-secondary, #98a2b3); }
      .rd-btn:hover { background: var(--dsw-alias-bg-layer-2, #1d2027); color: var(--dsw-alias-label-primary, #e6e8ee); }
      .rd-btn.primary { background: var(--dsw-alias-brand-primary, #4c8dff); border-color: transparent; color: #fff; font-size: 12.5px; padding: 6px 13px; }
      .rd-btn.primary:hover { filter: brightness(1.06); }
      .rd-btn.danger { color: #ff8f87; border-color: #5a2a2c; }
      .rd-btn.danger:hover { background: #2a1b1c; }
      .rd-list { display: flex; flex-direction: column; gap: 10px; }
      .rd-card { display: flex; align-items: center; gap: 14px; padding: 13px 15px; border-radius: 11px;
        border: 1px solid var(--dsw-alias-border-l1, #2a2e37); background: var(--dsw-alias-bg-layer-1, #16181d); }
      .rd-card-main { min-width: 0; flex: 1; }
      .rd-name { font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8ee); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rd-meta { margin-top: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary, #98a2b3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rd-badge { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; white-space: nowrap; border: 1px solid transparent;
        color: var(--dsw-alias-label-secondary, #98a2b3); background: var(--dsw-alias-bg-layer-2, #1d2027); }
      .rd-badge.ok { color: var(--dsw-alias-state-success-primary, #3fb950); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 12%, transparent); }
      .rd-badge.warn { color: var(--dsw-alias-state-warn-primary, #d6a13a); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d6a13a) 14%, transparent); }
      .rd-badge.bad { color: var(--dsw-alias-state-error-primary, #f85149); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #f85149) 12%, transparent); }
      .rd-note { margin: 18px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #7d8594); }
      .rd-empty { border: 1px dashed var(--dsw-alias-border-l2, #39404d); border-radius: 11px; padding: 22px; font-size: 13px;
        line-height: 1.7; color: var(--dsw-alias-label-secondary, #98a2b3); }
      .rd-error { color: var(--dsw-alias-state-error-primary, #f85149); font-size: 12.5px; }
      .rd-spacer { flex: 1; }
      .rd-section-title { margin: 24px 0 10px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8ee); }
      .rd-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 9px;
        border: 1px solid var(--dsw-alias-border-l1, #2a2e37); background: var(--dsw-alias-bg-layer-1, #16181d); cursor: context-menu; }
      .rd-row:hover { border-color: var(--dsw-alias-border-l2, #39404d); }
      .rd-row-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8ee);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rd-win { position: fixed; z-index: 60; display: flex; flex-direction: column; background: #0b0c0f;
        pointer-events: auto;
        border: 1px solid var(--dsw-alias-border-l2, #3a4150); border-radius: 10px; overflow: hidden;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
      .rd-win.maximized { border-radius: 0; border-color: transparent; }
      .rd-win-bar { display: flex; align-items: center; gap: 8px; height: 36px; flex: none; padding: 0 6px 0 11px;
        background: #14161b; border-bottom: 1px solid #23262e; color: #e7e9ee; font-size: 12.5px;
        cursor: move; user-select: none; }
      .rd-win-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rd-win-btn { appearance: none; border: 0; background: transparent; color: #a8b0bd; width: 26px; height: 24px;
        border-radius: 5px; cursor: pointer; font-size: 13px; line-height: 1; }
      .rd-win-btn:hover { background: #262b34; color: #fff; }
      .rd-win-body { position: relative; flex: 1; min-height: 0; background: #000; }
      .rd-win-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
      .rd-win-handle { position: absolute; z-index: 3; }
      .rd-win-handle.n { top: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
      .rd-win-handle.s { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
      .rd-win-handle.e { right: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
      .rd-win-handle.w { left: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
      .rd-win-handle.ne { right: 0; top: 0; width: 14px; height: 14px; cursor: nesw-resize; }
      .rd-win-handle.nw { left: 0; top: 0; width: 14px; height: 14px; cursor: nwse-resize; }
      .rd-win-handle.se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
      .rd-win-handle.sw { left: 0; bottom: 0; width: 14px; height: 14px; cursor: nesw-resize; }
      .rd-menu { position: fixed; z-index: 95; min-width: 168px; padding: 4px; pointer-events: auto;
        background: #1b1e25; border: 1px solid #2c313b; border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
      .rd-menu-item { display: block; width: 100%; text-align: left; padding: 6px 10px; border: 0; background: transparent;
        color: #d7dbe3; font: inherit; font-size: 12.5px; border-radius: 5px; cursor: pointer; }
      .rd-menu-item:hover { background: #262b34; }
      .rd-menu-item.danger { color: #ff8f87; }
      .rd-menu-sep { height: 1px; margin: 4px 6px; background: #2c313b; }
      .rd-confirm-backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.45); pointer-events: auto;
        display: flex; align-items: center; justify-content: center; }
      .rd-confirm { width: 400px; max-width: calc(100vw - 40px); background: #1b1e25; border: 1px solid #2c313b;
        border-radius: 10px; padding: 16px 18px; color: #e7e9ee; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); }
      .rd-confirm-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      .rd-confirm-body { font-size: 12.5px; line-height: 1.65; color: #a8b0bd; margin-bottom: 14px; }
      .rd-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
    `

    const MIN_WIN_W = 520
    const MIN_WIN_H = 380

    function initialRect() {
      const w = Math.min(1180, Math.max(MIN_WIN_W, window.innerWidth - 160))
      const h = Math.min(820, Math.max(MIN_WIN_H, window.innerHeight - 140))
      return {
        x: Math.max(0, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(20, Math.round((window.innerHeight - h) / 2)),
        w: Math.round(w),
        h: Math.round(h),
      }
    }

    // ── open desktop sessions ───────────────────────────────────────────────
    // Module-level so the windows outlive the sidebar page: switching a
    // conversation only unmounts `main`, never this store.
    const desktopStore = (() => {
      let seq = 0
      let zTop = 10
      let state = { sessions: [], confirm: null }
      const listeners = new Set()
      const set = (next) => {
        state = next
        for (const listener of listeners) listener()
      }
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        open(machine, url, protocol) {
          const key = `${machine.id}:${protocol}`
          const existing = state.sessions.find((session) => session.key === key)
          if (existing) {
            this.focus(existing.id)
            return
          }
          const session = {
            id: `rd-${++seq}`,
            key,
            protocol,
            machine,
            url,
            visible: true,
            z: ++zTop,
            rect: initialRect(),
          }
          set({ ...state, sessions: [...state.sessions, session] })
        },
        focus(id) {
          const target = state.sessions.find((session) => session.id === id)
          if (!target || (target.z === zTop && target.visible)) return
          set({
            ...state,
            sessions: state.sessions.map((session) =>
              session.id === id ? { ...session, visible: true, z: ++zTop } : session,
            ),
          })
        },
        hide(id) {
          set({
            ...state,
            sessions: state.sessions.map((session) =>
              session.id === id ? { ...session, visible: false } : session,
            ),
          })
        },
        close(id) {
          set({
            ...state,
            sessions: state.sessions.filter((session) => session.id !== id),
            confirm: state.confirm === id ? null : state.confirm,
          })
        },
        askClose(id) {
          set({ ...state, confirm: id })
        },
        cancelClose() {
          set({ ...state, confirm: null })
        },
      }
    })()

    function Icon(owner = {}) {
      const size = owner.size || 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 12.4, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', {
          d: 'M9 20.2h6M12 16.8v3.4',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M7.2 8.4h3.3M7.2 11.2h6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          opacity: 0.55,
        }),
      )
    }

    function MachineCard({ machine, probe, onOpen }) {
      const ready = !!(probe && probe.guacd && probe.guacd.reachable && probe.rdp && probe.rdp.reachable)
      const state = !probe
        ? 'checking'
        : !probe.guacd || !probe.guacd.reachable
          ? 'nogateway'
          : ready && probe.rdp.tls
            ? 'ready'
            : probe.rdp && probe.rdp.reachable
              ? 'plain'
              : 'down'
      const label =
        state === 'checking'
          ? t('stateChecking')
          : state === 'ready'
            ? t('stateReady')
            : state === 'plain'
              ? t('statePlain')
              : state === 'nogateway'
                ? t('stateNoGateway')
                : state === 'down'
                  ? t('stateDown')
                  : t('stateUnknown')
      const tone = state === 'ready' ? 'ok' : state === 'plain' ? 'warn' : state === 'down' || state === 'nogateway' ? 'bad' : ''
      let title
      if (state === 'nogateway' && probe?.guacd?.error) title = `guacd 4822: ${probe.guacd.error}`
      else if (state === 'down' && probe?.rdp?.error) title = `${t('probeError')}${probe.rdp.error}`
      return h(
        'div',
        { className: 'rd-card' },
        h(
          'div',
          { className: 'rd-card-main' },
          h('div', { className: 'rd-name' }, machine.name),
          h(
            'div',
            { className: 'rd-meta' },
            `${machine.username ? `${machine.username}@` : ''}${machine.host} · ${t('rdp')} ${machine.rdpPort} · ${t('remote')} ${machine.host}:${machine.port}`,
          ),
        ),
        h('span', { className: `rd-badge ${tone}`, title }, label),
        h('button', { className: 'rd-btn primary', type: 'button', onClick: () => onOpen(machine, 'rdp') }, t('open')),
        h('button', { className: 'rd-btn', type: 'button', onClick: () => onOpen(machine, 'vnc') }, t('openMirror')),
      )
    }

    function DesktopWindow({ session }) {
      const [rect, setRect] = React.useState(session.rect)
      const [maximized, setMaximized] = React.useState(false)
      const saved = React.useRef(null)
      const frameRef = React.useRef(null)

      React.useEffect(() => {
        const onMessage = (event) => {
          if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
          if (event.data && event.data.type === 'remote-desktop-close') {
            desktopStore.askClose(session.id)
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [session.id])

      // Hand keyboard focus to the viewer when the window is (re)shown, so the
      // first keystroke reaches the remote desktop instead of the page around it.
      React.useEffect(() => {
        if (!session.visible) return undefined
        const timer = window.setTimeout(() => {
          try {
            frameRef.current?.contentWindow?.focus()
          } catch {
            /* ignore */
          }
        }, 150)
        return () => window.clearTimeout(timer)
      }, [session.visible])

      const toggleMax = () => {
        if (maximized) {
          setRect(saved.current || initialRect())
          setMaximized(false)
        } else {
          saved.current = rect
          setRect({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
          setMaximized(true)
        }
      }

      const track = (move) => {
        const up = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
      }

      const startDrag = (event) => {
        if (event.button !== 0 || maximized) return
        event.preventDefault()
        desktopStore.focus(session.id)
        const startX = event.clientX
        const startY = event.clientY
        const base = rect
        track((e) => {
          setRect((r) => ({
            ...r,
            x: Math.min(Math.max(base.x + e.clientX - startX, 180 - r.w), window.innerWidth - 180),
            y: Math.min(Math.max(base.y + e.clientY - startY, 0), window.innerHeight - 48),
          }))
        })
      }

      const startResize = (event, dir) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        desktopStore.focus(session.id)
        const startX = event.clientX
        const startY = event.clientY
        const base = rect
        track((e) => {
          const dx = e.clientX - startX
          const dy = e.clientY - startY
          let x = base.x
          let y = base.y
          let w = base.w
          let hgt = base.h
          if (dir.includes('e')) w = base.w + dx
          if (dir.includes('s')) hgt = base.h + dy
          if (dir.includes('w')) {
            w = base.w - dx
            x = base.x + dx
          }
          if (dir.includes('n')) {
            hgt = base.h - dy
            y = base.y + dy
          }
          if (w < MIN_WIN_W) {
            if (dir.includes('w')) x = base.x + base.w - MIN_WIN_W
            w = MIN_WIN_W
          }
          if (hgt < MIN_WIN_H) {
            if (dir.includes('n')) y = base.y + base.h - MIN_WIN_H
            hgt = MIN_WIN_H
          }
          if (x < 0) {
            w += x
            x = 0
          }
          if (y < 0) {
            hgt += y
            y = 0
          }
          if (x + w > window.innerWidth) w = window.innerWidth - x
          if (y + hgt > window.innerHeight) hgt = window.innerHeight - y
          setRect({ x, y, w, h: hgt })
        })
      }

      const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
        h('div', {
          key: dir,
          className: `rd-win-handle ${dir}`,
          onPointerDown: (event) => startResize(event, dir),
        }),
      )

      return h(
        'div',
        {
          className: `rd-win${maximized ? ' maximized' : ''}`,
          style: {
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            display: session.visible ? 'flex' : 'none',
            zIndex: 60 + session.z,
          },
        },
        h(
          'div',
          { className: 'rd-win-bar', onPointerDown: startDrag, onDoubleClick: toggleMax },
          h(Icon, { size: 14 }),
          h('span', { className: 'rd-win-title' }, `${t('viewerTitle')} · ${session.machine.name}`),
          h('span', { className: 'rd-spacer' }),
          h(
            'button',
            {
              className: 'rd-win-btn',
              type: 'button',
              title: maximized ? t('restore') : t('maximize'),
              onPointerDown: (event) => event.stopPropagation(),
              onClick: toggleMax,
            },
            maximized ? '❐' : '□',
          ),
          h(
            'button',
            {
              className: 'rd-win-btn',
              type: 'button',
              title: t('closeViewer'),
              onPointerDown: (event) => event.stopPropagation(),
              onClick: () => desktopStore.askClose(session.id),
            },
            '✕',
          ),
        ),
        h(
          'div',
          { className: 'rd-win-body' },
          h('iframe', {
            ref: frameRef,
            className: 'rd-win-frame',
            src: session.url,
            title: `${t('viewerTitle')} ${session.machine.name}`,
            allow: 'fullscreen; clipboard-read; clipboard-write',
            allowFullScreen: true,
          }),
        ),
        handles,
      )
    }

    function CloseConfirm({ session }) {
      return h(
        'div',
        {
          className: 'rd-confirm-backdrop',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) desktopStore.cancelClose()
          },
        },
        h(
          'div',
          { className: 'rd-confirm' },
          h('div', { className: 'rd-confirm-title' }, `${t('confirmTitle')} · ${session.machine.name}`),
          h('div', { className: 'rd-confirm-body' }, t('confirmBody')),
          h(
            'div',
            { className: 'rd-confirm-actions' },
            h(
              'button',
              {
                className: 'rd-btn',
                type: 'button',
                onClick: () => {
                  desktopStore.hide(session.id)
                  desktopStore.cancelClose()
                },
              },
              t('confirmKeep'),
            ),
            h(
              'button',
              {
                className: 'rd-btn danger',
                type: 'button',
                onClick: () => {
                  desktopStore.close(session.id)
                },
              },
              t('confirmDisconnect'),
            ),
            h(
              'button',
              { className: 'rd-btn', type: 'button', onClick: () => desktopStore.cancelClose() },
              t('cancel'),
            ),
          ),
        ),
      )
    }

    function OverlayRoot() {
      const [state, setState] = React.useState(desktopStore.get())
      React.useEffect(() => desktopStore.subscribe(() => setState(desktopStore.get())), [])
      if (state.sessions.length === 0) return null
      const confirmSession = state.confirm ? state.sessions.find((session) => session.id === state.confirm) : null
      return h(
        React.Fragment,
        null,
        state.sessions.map((session) => h(DesktopWindow, { key: session.id, session })),
        confirmSession ? h(CloseConfirm, { session: confirmSession }) : null,
      )
    }

    function SessionMenu({ x, y, session, onClose }) {
      React.useEffect(() => {
        const onDown = () => onClose()
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('pointerdown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [onClose])
      return h(
        'div',
        { className: 'rd-menu', style: { left: x, top: y }, onPointerDown: (event) => event.stopPropagation() },
        h(
          'button',
          {
            className: 'rd-menu-item',
            type: 'button',
            onClick: () => {
              desktopStore.focus(session.id)
              onClose()
            },
          },
          t('menuShow'),
        ),
        h(
          'button',
          {
            className: 'rd-menu-item',
            type: 'button',
            onClick: () => {
              desktopStore.hide(session.id)
              onClose()
            },
          },
          t('menuHide'),
        ),
        h('div', { className: 'rd-menu-sep' }),
        h(
          'button',
          {
            className: 'rd-menu-item danger',
            type: 'button',
            onClick: () => {
              desktopStore.close(session.id)
              onClose()
            },
          },
          t('menuDisconnect'),
        ),
      )
    }

    function Page() {
      const [state, setState] = React.useState({ loading: true, error: null, machines: [], probes: {}, origin: '' })
      const [tick, setTick] = React.useState(0)
      const [sessions, setSessions] = React.useState(desktopStore.get().sessions)
      const [menu, setMenu] = React.useState(null)

      React.useEffect(() => desktopStore.subscribe(() => setSessions(desktopStore.get().sessions)), [])

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        ;(async () => {
          setState((current) => ({ ...current, loading: true, error: null }))
          try {
            const response = await fetch('/remote-desktop/machines', {
              cache: 'no-store',
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!alive) return
            setState({ loading: false, error: null, machines: body.machines || [], probes: {}, origin: body.origin || '' })
            for (const machine of body.machines || []) {
              try {
                const probeResponse = await fetch(
                  `/remote-desktop/probe?machine=${encodeURIComponent(machine.id)}`,
                  { cache: 'no-store', signal: controller.signal },
                )
                const probe = probeResponse.ok
                  ? await probeResponse.json()
                  : { rdp: { reachable: false, error: `HTTP ${probeResponse.status}` }, guacd: { reachable: false } }
                if (!alive) return
                setState((current) => ({ ...current, probes: { ...current.probes, [machine.id]: probe } }))
              } catch (error) {
                if (!alive || error.name === 'AbortError') return
                setState((current) => ({
                  ...current,
                  probes: {
                    ...current.probes,
                    [machine.id]: {
                      rdp: { reachable: false, error: error.message },
                      guacd: { reachable: false },
                    },
                  },
                }))
              }
            }
          } catch (error) {
            if (!alive || error.name === 'AbortError') return
            setState({ loading: false, error: error.message, machines: [], probes: {}, origin: '' })
          }
        })()
        return () => {
          alive = false
          controller.abort()
        }
      }, [tick])

      const open = (machine, protocol = 'rdp') => {
        // The Desktop shell hosts this page on `dsh-app://app`, where a relative
        // viewer URL would make Guacamole build an invalid WebSocket URL. Hand
        // the viewer an absolute ws:// address on the real HTTP listener.
        const base = state.origin || `${window.location.protocol}//${window.location.host}`
        const wsOrigin = base.replace(/^http/, 'ws')
        const wsUrl = `${wsOrigin}/remote-desktop/ws`
        const url = `/remote-desktop/viewer.html?machine=${encodeURIComponent(machine.id)}&protocol=${protocol}&ws=${encodeURIComponent(wsUrl)}`
        desktopStore.open(machine, url, protocol)
      }

      const openSessionMenu = (event, session) => {
        event.preventDefault()
        const width = 180
        const height = 120
        setMenu({
          x: Math.min(event.clientX, window.innerWidth - width - 8),
          y: Math.min(event.clientY, window.innerHeight - height - 8),
          session,
        })
      }

      const menuElement = menu
        ? h(SessionMenu, { x: menu.x, y: menu.y, session: menu.session, onClose: () => setMenu(null) })
        : null

      return h(
        'div',
        { className: 'rd-page' },
        h(
          'div',
          { className: 'rd-inner' },
          h(
            'div',
            { className: 'rd-head' },
            h('div', { className: 'rd-mark' }, h(Icon, { size: 22 })),
            h('div', null, h('h1', null, t('title')), h('p', null, t('subtitle'))),
          ),
          h(
            'div',
            { className: 'rd-actions' },
            h('button', { className: 'rd-btn', type: 'button', onClick: () => setTick((value) => value + 1) }, t('refresh')),
          ),
          state.error
            ? h('div', { className: 'rd-error' }, `${t('loadFailed')}${state.error}`)
            : state.loading
              ? h('div', { className: 'rd-empty' }, t('loading'))
              : state.machines.length === 0
                ? h('div', { className: 'rd-empty' }, t('empty'))
                : h(
                    'div',
                    { className: 'rd-list' },
                    state.machines.map((machine) =>
                      h(MachineCard, {
                        key: machine.id,
                        machine,
                        probe: state.probes[machine.id],
                        onOpen: open,
                      }),
                    ),
                  ),
          sessions.length > 0
            ? h(
                'div',
                null,
                h('div', { className: 'rd-section-title' }, t('listTitle')),
                h(
                  'div',
                  { className: 'rd-list' },
                  sessions.map((session) =>
                    h(
                      'div',
                      {
                        key: session.id,
                        className: 'rd-row',
                        onContextMenu: (event) => openSessionMenu(event, session),
                      },
                      h(
                        'span',
                        { className: 'rd-row-name' },
                        `${session.machine.name} · ${session.protocol === 'vnc' ? t('modeVnc') : t('modeRdp')}`,
                      ),
                      h(
                        'span',
                        { className: `rd-badge ${session.visible ? 'ok' : ''}` },
                        session.visible ? t('listRunning') : t('listHidden'),
                      ),
                      h(
                        'button',
                        { className: 'rd-btn', type: 'button', onClick: () => desktopStore.focus(session.id) },
                        t('showWindow'),
                      ),
                      h(
                        'button',
                        { className: 'rd-btn', type: 'button', onClick: () => desktopStore.askClose(session.id) },
                        t('closeViewer'),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          h('p', { className: 'rd-note' }, t('passwordHint')),
        ),
        menuElement
          ? ReactDOM && typeof ReactDOM.createPortal === 'function'
            ? ReactDOM.createPortal(menuElement, document.body)
            : menuElement
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        wireLocale(ctx)
        // Page-wide styles live in <head>: the floating windows outlive the
        // sidebar page, so they cannot rely on a component-owned <style>.
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'remote-desktop'
          tag.textContent = styles
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'remote-desktop: styles')
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'remote-desktop', locale: NS }, Page),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'remote-desktop', order: 40, label: () => t('nav'), locale: NS },
            Icon,
          ),
        )
        // Root-scoped: the windows stay on screen while conversations change.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'remote-desktop-windows', order: 60 }, OverlayRoot),
        )
      },
    }
  },
})
