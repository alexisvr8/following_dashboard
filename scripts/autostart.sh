#!/bin/sh
# Arranque automático en macOS con launchd: la app se levanta al iniciar sesión y se reinicia si se cae.
# Uso: sh scripts/autostart.sh install | uninstall | restart | logs
set -e
LABEL=com.xtract.method
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/xtract-method.log"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DOMAIN="gui/$(id -u)"

case "$1" in
  install)
    NODE_DIR=$(dirname "$(command -v node)")
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$ROOT/scripts/start-local.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Instalado. La app arranca sola al iniciar sesión → http://localhost:3000 (logs: $LOG)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Desinstalado."
    ;;
  restart)
    # Recompila si cambió el commit; FORCE_BUILD=1 para recompilar cambios sin commit.
    if [ "$FORCE_BUILD" = "1" ]; then rm -f "$ROOT/.next/.built-commit"; fi
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Reiniciado (logs: $LOG)"
    ;;
  logs)
    tail -n 50 -f "$LOG"
    ;;
  *)
    echo "Uso: sh scripts/autostart.sh install | uninstall | restart | logs"; exit 1
    ;;
esac
