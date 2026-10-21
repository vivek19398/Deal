#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# Codex desktop includes Node; use it when Node is not on the normal PATH.
if ! command -v node >/dev/null 2>&1; then
  runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$runtime/node/bin/node" ]; then
    PATH="$runtime/node/bin:$runtime/bin/fallback:$PATH"
    export PATH
  else
    echo 'Install Node.js 22 or later from https://nodejs.org, then run ./start.sh again.'
    exit 1
  fi
fi
if [ ! -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  elif command -v npm >/dev/null 2>&1; then
    npm install
  else
    echo 'Install npm or pnpm, then run ./start.sh again.'
    exit 1
  fi
fi
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
exec node --import tsx server/index.ts --production
