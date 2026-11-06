#!/usr/bin/env bash
# Prepare a Linux host (Ubuntu/Debian) for the dsh-remote-screen plugin.
#
#   curl -fsSL https://raw.githubusercontent.com/fengasdf/dsh-remote-screen2/main/scripts/remote-setup.sh | bash
#   # or, after npm install:
#   bash node_modules/dsh-remote-screen/scripts/remote-setup.sh
#
# What it does:
#   1. installs guacd + the RDP/VNC protocol plugins + x11vnc
#   2. makes guacd listen on 0.0.0.0:4822 (the DSH host connects from another machine)
#   3. optionally mirrors the active console session with x11vnc on 127.0.0.1:5900
#
# Env:
#   GUACD_LISTEN=0.0.0.0   address guacd binds (set 127.0.0.1 when you tunnel over SSH)
#   MIRROR=auto|off        auto = mirror the display `who` reports (default), off = skip
#   MIRROR_USER / MIRROR_DISPLAY  override the mirror target (e.g. xrd / :1)
set -euo pipefail

SUDO=${SUDO:-sudo}
GUACD_LISTEN=${GUACD_LISTEN:-0.0.0.0}
MIRROR=${MIRROR:-auto}

say() { printf '\033[1m== %s\033[0m\n' "$*"; }

say "1/3 installing guacd, guacamole protocol plugins and x11vnc"
$SUDO apt-get update -qq
$SUDO apt-get install -y guacd libguac-client-rdp0 libguac-client-vnc0 x11vnc

say "2/3 configuring guacd (listen ${GUACD_LISTEN}:4822)"
if [ -f /etc/default/guacd ]; then
  $SUDO sed -i "s/^LISTEN_ADDRESS=.*/LISTEN_ADDRESS=${GUACD_LISTEN}/" /etc/default/guacd
fi
# The packaged unit passes -b/-l itself; a stray INI here makes guacd refuse to start.
if [ -f /etc/guacamole/guacd.conf ]; then
  $SUDO rm -f /etc/guacamole/guacd.conf
fi
$SUDO systemctl enable guacd >/dev/null 2>&1 || true
$SUDO systemctl restart guacd
sleep 1
systemctl is-active --quiet guacd && echo "   guacd is active" || { echo "   guacd failed to start"; $SUDO journalctl -u guacd -n 20 --no-pager; exit 1; }

say "3/3 mirroring the console session (VNC)"
if [ "$MIRROR" = "off" ]; then
  echo "   skipped (MIRROR=off)"
elif [ -z "${MIRROR_USER:-}" ] || [ -z "${MIRROR_DISPLAY:-}" ]; then
  read -r MIRROR_USER MIRROR_DISPLAY _ < <(who | awk '$2 ~ /^:[0-9]+$/ { print $1, $2; exit }') || true
fi

if [ -n "${MIRROR_USER:-}" ] && [ -n "${MIRROR_DISPLAY:-}" ]; then
  uid=$(id -u "$MIRROR_USER")
  auth="/run/user/${uid}/gdm/Xauthority"
  if [ ! -f "$auth" ]; then
    auth="/home/${MIRROR_USER}/.Xauthority"
  fi
  $SUDO -u "$MIRROR_USER" pkill -x x11vnc >/dev/null 2>&1 || true
  $SUDO -u "$MIRROR_USER" nohup x11vnc -display "$MIRROR_DISPLAY" -auth "$auth" \
    -localhost -rfbport 5900 -forever -shared -nopw -noxdamage -bg -o /tmp/x11vnc.log >/dev/null 2>&1 || true
  sleep 2
  if ss -ltn 2>/dev/null | grep -q '127.0.0.1:5900'; then
    echo "   x11vnc mirrors ${MIRROR_USER} ${MIRROR_DISPLAY} on 127.0.0.1:5900"
  else
    echo "   x11vnc did not start; see /tmp/x11vnc.log"
  fi
else
  echo "   no active console session found; log in locally, then rerun with MIRROR_USER=... MIRROR_DISPLAY=..."
fi

cat <<'EOF'

Done. Next:
  - XFCE for xrdp sessions (GNOME allows one session per user):
      sudo apt-get install -y xfce4
      printf '#!/bin/sh\nexec startxfce4\n' > ~/.xsession && chmod 755 ~/.xsession
  - point the plugin at this host: $DSH_HOME/remote-screen.json
      { "machines": [ { "id": "vm1", "name": "VM", "host": "192.168.1.5",
                        "username": "dev", "rdpPort": 3389, "guacdPort": 4822, "vncPort": 5900 } ] }
  - security: guacd has no authentication; keep 4822 on a trusted network.
EOF
