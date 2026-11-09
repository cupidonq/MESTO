#!/usr/bin/env bash
# Запускает MESTO на этом компьютере без Docker.   Запуск: bash start-mesto.sh
# Если нет Node.js 22+, скачивает портативный (только с nodejs.org, проверка SHA-256), без прав администратора.
set -euo pipefail
cd "$(dirname "$0")"

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }

if ! node_ok; then
  RT="local/runtime/node"
  if [ ! -x "$RT/bin/node" ]; then
    case "$(uname -s)-$(uname -m)" in
      Linux-x86_64)  PLAT="linux-x64" ;;
      Linux-aarch64|Linux-arm64) PLAT="linux-arm64" ;;
      Darwin-arm64)  PLAT="darwin-arm64" ;;
      Darwin-x86_64) PLAT="darwin-x64" ;;
      *) echo "Нет готовой сборки Node.js для $(uname -s)-$(uname -m). Установите Node.js 22+ с https://nodejs.org" >&2; exit 1 ;;
    esac
    BASE="https://nodejs.org/dist/latest-v22.x"
    get() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -q "$1" -O "$2"; fi; }
    sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
    mkdir -p local/runtime && TMP="$(mktemp -d local/runtime/.dl.XXXXXX)"
    trap 'rm -rf "$TMP"' EXIT
    echo "На этом компьютере нет Node.js 22+. Скачиваю портативную версию с nodejs.org..."
    get "$BASE/SHASUMS256.txt" "$TMP/sums" || { echo "Не удалось скачать список с nodejs.org. Проверьте интернет." >&2; exit 1; }
    LINE="$(grep -E "  node-v22\.[0-9.]+-$PLAT\.tar\.gz\$" "$TMP/sums" | head -n1 || true)"
    [ -n "$LINE" ] || { echo "В списке nodejs.org нет сборки $PLAT." >&2; exit 1; }
    HASH="${LINE%% *}"; FILE="${LINE##* }"
    get "$BASE/$FILE" "$TMP/$FILE"
    [ "$(sha "$TMP/$FILE")" = "$HASH" ] || { echo "Контрольная сумма не совпала — файл отклонён." >&2; exit 1; }
    tar -xzf "$TMP/$FILE" -C "$TMP"
    rm -rf "$RT" && mv "$TMP"/node-v22.* "$RT"
    echo "Node.js готов."
  fi
  export PATH="$PWD/$RT/bin:$PATH"
fi

exec node local/launcher.mjs
