# dsh-remote-screen（DSH 插件）

> **English** — Remote desktop windows inside the DSH Web UI. Open an xrdp **RDP** session or **mirror the Linux console** over VNC (`x11vnc` → `guacd`), in draggable/resizable multi-windows with per-machine sessions, a saved-machine list, hide/close/disconnect semantics. Requires a Linux host with `guacd` and the RDP/VNC protocol plugins; `scripts/remote-setup.sh` prepares it.

在 DSH Web 界面侧栏新增「远程桌面」页面：从已保存的机器里选一台，在**应用内的独立浮窗**里显示远端桌面，鼠标键盘可直接操作。浮窗可拖动标题栏移动、拖 8 个边/角缩放、双击标题栏最大化。

每台机器有两个入口：

- **打开桌面**（RDP）：xrdp 新开一个桌面会话（本机配的是 XFCE）。和 VM 控制台不是同一个桌面。
- **镜像控制台**（VNC）：通过 `x11vnc` 镜像控制台当前的图形会话（display `:1`），看到的和 VM 窗口里**完全一样**，也不需要再登录。

> Desktop 外壳对 `window.open` 的处理是把 http(s) 交给系统浏览器并拒绝应用内弹窗，所以真正的新 OS 窗口需要外壳支持；这里的浮窗在应用内模拟独立窗口，缩放时远端画面等比缩放适配（guacd 0.9.9/FreeRDP 1.1 不支持动态改分辨率，尽量保持 1:1，放不下时缩放）。

## 安装

```bash
dsh plugin add dsh-remote-screen
```

或者用 dsh-market 的 Discover 搜 `dsh-remote-screen`。装好后重载页面（F12 → Console → `location.reload()`），侧栏出现显示器图标。

## 机器来源

按顺序读取，取到非空的那个：

1. dsh-remote 的注册表 `$DSH_HOME/remote-workspaces/machines.json`（装了 dsh-remote 就直接复用它的机器，密码不会被本插件读取）。
2. 本插件自己的 `$DSH_HOME/remote-screen.json`：

```json
{
  "machines": [
    {
      "id": "vm1",
      "name": "Build VM",
      "host": "192.168.1.5",
      "username": "dev",
      "rdpPort": 3389,
      "guacdPort": 4822,
      "vncPort": 5900
    }
  ]
}
```

`id`、`host` 必填，其余可省（默认 3389 / 4822 / 5900）。

## 准备远端

```bash
# 在远端 Linux 上执行（Ubuntu/Debian）
curl -fsSL https://raw.githubusercontent.com/fengasdf/dsh-remote-screen/main/scripts/remote-setup.sh | bash
```

脚本会安装 `guacd`、`libguac-client-rdp0`、`libguac-client-vnc0`、`x11vnc`，把 guacd 监听改为 `0.0.0.0:4822`，并用 x11vnc 镜像当前控制台会话到 `127.0.0.1:5900`。

## 镜像控制台（VNC）的远端前提

```bash
sudo apt-get install -y x11vnc libguac-client-vnc0
# 以桌面用户身份，镜像控制台会话（这里 display 是 :1，auth 文件在 /run/user/1000/gdm/Xauthority）
nohup x11vnc -display :1 -auth /run/user/1000/gdm/Xauthority \
  -localhost -rfbport 5900 -forever -shared -nopw -noxdamage -bg -o /tmp/x11vnc.log
```

`-localhost` 只让 guacd 从本机连 5900；`-nopw` 因而可接受。控制台会话结束（注销/重启）后 x11vnc 会退出，需要重新启动才能再次镜像。

## 多窗口与关闭语义

- 浮窗挂在根级 `shell.overlay` 槽位，**不随会话切换卸载**：点侧栏里的任意会话、切面板，桌面窗口都留在屏幕上。
- 多开并存：每台机器一个窗口，可同时打开多台；再次点同一台只会把它的窗口置顶。
- 页面上的「已打开的桌面」列表显示所有会话（窗口打开 / 窗口已关闭），可「显示窗口」或关闭；**右击列表项**弹出菜单：显示窗口 / 仅关闭窗口 / 断开连接。
- ✕ 关闭会先询问：**仅关闭窗口**（窗口隐藏，RDP 连接保持，可随时从列表重新显示）或 **断开连接并关闭**（卸载 iframe，WebSocket 断开，guacd 结束这次 xrdp 会话）。「断开」不等于关窗口，隐藏的窗口仍在后台保持连接。

## 组成

| 部分 | 说明 |
|---|---|
| 宿主半边 `index.js` | 注册 `/remote-desktop/*` 精确路由与 `/remote-desktop/ws` WebSocket 路由；读取 `$DSH_HOME/remote-workspaces/machines.json`；探测 RDP/guacd 端口；把浏览器的 Guacamole 连接桥接到远端 guacd |
| 浏览器视图 `viewer/` | 独立页面 + Apache Guacamole 的 `guacamole-common-js` 客户端（`viewer/guacamole.js`，MIT/Apache-2.0，见 `viewer/GUACAMOLE-LICENSE`） |
| 客户端 `client.js` | 侧栏条目 + `main` 页面（机器列表、探测状态、应用内查看器） |

## 远端前提

浏览器无法直接说 RDP，因此远端需要一个 guacd（Apache Guacamole 的 RDP 网关），由它用 FreeRDP 连接本机 xrdp：

```bash
sudo apt-get install -y guacd libguac-client-rdp0
# 让 DSH 宿主能连到 4822（默认只监听 127.0.0.1）
sudo sed -i 's/^LISTEN_ADDRESS=.*/LISTEN_ADDRESS=0.0.0.0/' /etc/default/guacd
sudo systemctl restart guacd
```

链路：浏览器 ⇄ DSH WebSocket 桥（本机）⇄ `guacd:4822`（远端）⇄ `xrdp:3389`（远端，TLS）。

注意：

- guacd 默认不做认证，4822 只应在可信网络暴露；不需要时把它绑回 `127.0.0.1` 并改用 SSH 隧道。
- xrdp 必须能提供 TLS（`security_layer=negotiate` 且 `cert.pem`/`key.pem` 可被 xrdp 用户读取），否则 guacd 只能走不加密的 RDP 安全层。
- **gnome-session 同一用户只允许一个会话**：如果远端已有本地图形登录（如控制台 vt2），xrdp 的 GNOME 会话会在启动后立刻退出（`xrdp-sesman.log` 里 `window manager ... did exit`，但日志里登录本身是成功的）。解决：给 xrdp 配一个独立桌面，例如 `sudo apt-get install -y xfce4`，再给该用户写 `~/.xsession`（内容 `exec startxfce4`）——本机 192.168.1.5 已按这个方式配置，控制台的 GNOME 会话不受影响。首次进入 XFCE 会弹「欢迎第一次启动面板」，选默认配置即可。

## 配置

本插件没有自己的配置项；机器列表来自 dsh-remote 的注册表。RDP 端口默认 `3389`，guacd 端口默认 `4822`，可在机器记录里用 `rdpPort` / `guacdPort` 覆盖。

## 安全

- 路由是裸 Web 服务器上的**精确注册**（`/remote-desktop/*`），不在 `/api` 之下：`/api` 由 `dsh-client-connection` 独占，未注册的路径一律 404。这些路由因此不受浏览器登录 Cookie 保护，只由监听地址隔离——服务器默认只监听回环，本机进程可达。
- 页面不接收也不保存 RDP 密码；账号密码在远端的 xrdp 登录画面里输入。
- 目标地址来自浏览器查询串，但宿主只接受已保存机器的 `host:port`，不会成为任意 RDP 代理。

## 已知限制

- 画面按窗口大小建立会话（连接时计算一次）；窗口大小改变需要重新连接。
- 剪贴板/文件传输/声音未接入。
- guacd 版本较老（Ubuntu 18.04 自带 0.9.9）时，Guacamole 1.5 客户端仍可工作，但个别新指令不支持。
