#!/bin/sh
# Lo ejecuta launchd al iniciar sesión (ver scripts/autostart.sh). Compila si el código cambió
# desde el último build (otro commit, o FORCE_BUILD=1) y levanta la app en modo producción.
set -e
cd "$(dirname "$0")/.."

STAMP=.next/.built-commit
HEAD=$(git rev-parse HEAD 2>/dev/null || echo unknown)
if [ "$FORCE_BUILD" = "1" ] || [ ! -f .next/BUILD_ID ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$HEAD" ]; then
  echo "[autostart] compilando ($HEAD)…"
  pnpm install --frozen-lockfile
  pnpm build
  echo "$HEAD" > "$STAMP"
fi

echo "[autostart] iniciando en http://localhost:${PORT:-3000}"
exec pnpm start -p "${PORT:-3000}"
