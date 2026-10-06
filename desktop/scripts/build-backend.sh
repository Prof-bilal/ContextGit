#!/usr/bin/env bash
# Build the standalone ContextGit API binary (PyInstaller onefile) that the
# packaged Electron app spawns as its backend.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "error: .venv not found at $ROOT/.venv (run: python -m venv .venv && .venv/bin/pip install -e '.[dev]')" >&2
  exit 1
fi

"$PY" -m pip install --quiet pyinstaller

# Bundle the optional document renderers (Chat Docs) when installed. Absent ones
# just mean that format falls back (PDF) or reports "not installed" at runtime.
EXTRAS=()
for pkg in docx pptx reportlab weasyprint; do
  if "$PY" -c "import $pkg" >/dev/null 2>&1; then
    EXTRAS+=(--collect-all "$pkg")
  fi
done

"$PY" -m PyInstaller --noconfirm --clean --onefile \
  --name contextgit-api \
  --paths "$ROOT" \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.loops.uvloop \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.http.h11_impl \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --collect-all contextgit \
  ${EXTRAS[@]+"${EXTRAS[@]}"} \
  --distpath "$ROOT/desktop/build/backend" \
  --workpath "$ROOT/desktop/build/pyinstaller" \
  --specpath "$ROOT/desktop/build/pyinstaller" \
  "$ROOT/desktop/backend/entry.py"

echo "backend binary: $ROOT/desktop/build/backend/contextgit-api"
