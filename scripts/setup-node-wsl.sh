#!/usr/bin/env bash
# Instalacja nvm + Node 22 LTS w WSL — Astro wymaga Node >=22.12.
# Idempotentne: bezpieczne do ponownego odpalenia.
set -euo pipefail

NVM_VERSION="v0.40.3"
NODE_VERSION="22"

if ! [ -d "$HOME/.nvm" ]; then
  echo "[1/4] Instaluję nvm $NVM_VERSION..."
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
else
  echo "[1/4] nvm już zainstalowane (pomijam)."
fi

echo "[2/4] Ładuję nvm do bieżącej sesji..."
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "[3/4] Instaluję Node $NODE_VERSION (LTS)..."
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "[4/5] Dopisuję nvm do ~/.profile (load w non-interactive bash -lc)..."
PROFILE="$HOME/.profile"
MARKER="# nvm setup (added by bookshelf setup-node-wsl)"
if grep -qF "$MARKER" "$PROFILE" 2>/dev/null; then
  echo "  (już dopisane, pomijam)"
else
  cat >> "$PROFILE" <<'EOF'

# nvm setup (added by bookshelf setup-node-wsl)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF
  echo "  ✓ dodane"
fi

echo "[5/5] Weryfikacja:"
echo "  node: $(node --version)"
echo "  npm:  $(npm --version)"
echo
echo "Gotowe. VS Code tasks (wsl bash -lc) zobaczą Node 22 od razu."
