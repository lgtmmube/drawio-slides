#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 18 以降が必要です。Node.js をインストールしてから再度起動してください。'
  exit 1
fi
exec node scripts/serve.mjs --open "$@"
