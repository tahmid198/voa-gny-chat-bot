#!/usr/bin/env bash
#
# Install both halves of the VOA-GNY HR assistant on this host.
#
#   /opt/maud-ai/                    existing venv, rag_chat.py, documents/
#   /opt/maud-ai/voa-gny-chat-bot/   this repo, built
#   /opt/maud-ai/maud_service/       symlink into the checkout
#
# and starts two services:
#
#   maud-ai            :8100   FastAPI — embeddings, Qdrant, vLLM
#   voa-gny-frontend   :3000   Next.js production server
#
# Run as a normal user with sudo rights (not as root):
#
#   ./deploy/install.sh
#
# Re-running it is safe: it pulls the latest code, rebuilds and restarts.
# Override defaults with environment variables, e.g.
#
#   BRANCH=claude/maud-ai-rag-chat-g6xn1t ./deploy/install.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tahmid198/voa-gny-chat-bot}"
BRANCH="${BRANCH:-main}"
MAUD_DIR="${MAUD_DIR:-/opt/maud-ai}"
# Kept under MAUD_DIR so everything lives in one place alongside rag_chat.py,
# ingest_documents.py and the venv.
APP_DIR="${APP_DIR:-$MAUD_DIR/voa-gny-chat-bot}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8100}"

step()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '\033[33m    warning: %s\033[0m\n' "$*"; }
die()   { printf '\033[31m    error: %s\033[0m\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
  die "run this as your normal user, not root — it calls sudo where needed"
fi

# ---------------------------------------------------------------------------
step "Checking prerequisites"
# ---------------------------------------------------------------------------

[ -d "$MAUD_DIR/venv" ] || die "$MAUD_DIR/venv not found — this script expects the existing maud-ai venv"

if curl -sf --max-time 5 localhost:8000/v1/models >/dev/null; then
  info "vLLM responding on :8000"
else
  warn "vLLM is not responding on :8000 — install will continue, but answers will fail until it is up"
fi

if curl -sf --max-time 5 localhost:6333/collections >/dev/null; then
  info "Qdrant responding on :6333"
else
  warn "Qdrant is not responding on :6333 — install will continue, but retrieval will fail until it is up"
fi

# ---------------------------------------------------------------------------
step "Fetching the source into $APP_DIR"
# ---------------------------------------------------------------------------

if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi
info "at $(git -C "$APP_DIR" rev-parse --short HEAD) on $BRANCH"

# ---------------------------------------------------------------------------
step "Installing the backend into $MAUD_DIR"
# ---------------------------------------------------------------------------

# Link rather than copy, so `git pull` updates the backend too and there is
# only one copy of the code on disk. uvicorn runs with MAUD_DIR as its working
# directory and imports maud_service through this link.
link="$MAUD_DIR/maud_service"
target="$APP_DIR/backend/maud_service"

if [ -d "$link" ] && [ ! -L "$link" ]; then
  info "replacing the copied maud_service/ with a link to the checkout"
fi
sudo rm -rf "$link"
sudo ln -s "$target" "$link"
info "$link -> $target"

# A plain-language guide to what lives in MAUD_DIR, for whoever opens it next.
sudo cp "$APP_DIR/deploy/maud-ai-README.md" "$MAUD_DIR/README.md"
info "$MAUD_DIR/README.md updated"

# The checkout now lives under MAUD_DIR, so anything that scans MAUD_DIR
# wholesale would try to ingest node_modules. ingest_documents.py should only
# read MAUD_DIR/documents.
if [ -f "$MAUD_DIR/ingest_documents.py" ] &&
   ! grep -qF "$MAUD_DIR/documents" "$MAUD_DIR/ingest_documents.py"; then
  warn "ingest_documents.py does not name $MAUD_DIR/documents as its source."
  warn "confirm it before re-ingesting — $APP_DIR contains node_modules."
fi

# sentence-transformers and qdrant-client are already in the venv; this adds
# only the web layer, and is a no-op once they are present.
"$MAUD_DIR/venv/bin/pip" install --quiet --upgrade \
  fastapi 'uvicorn[standard]' httpx
info "python dependencies present"

# ---------------------------------------------------------------------------
step "Checking Node.js"
# ---------------------------------------------------------------------------

node_is_new_enough() {
  command -v node >/dev/null 2>&1 || return 1
  local version major minor
  version="$(node --version | sed 's/^v//')"
  major="${version%%.*}"
  minor="$(printf '%s' "$version" | cut -d. -f2)"
  [ "$major" -ge 20 ] && return 0
  [ "$major" -eq 18 ] && [ "$minor" -ge 18 ] && return 0
  return 1
}

if node_is_new_enough; then
  info "node $(node --version) is new enough for Next.js 15"
else
  info "installing Node.js 20 LTS from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node_is_new_enough || die "node is still too old: $(node --version 2>/dev/null || echo 'not installed')"
fi

# ---------------------------------------------------------------------------
step "Building the frontend"
# ---------------------------------------------------------------------------

cat > "$APP_DIR/.env.local" <<EOF
# Written by deploy/install.sh. Both services run on this host.
MAUD_API_URL=http://localhost:$BACKEND_PORT
EOF

cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build

# ---------------------------------------------------------------------------
step "Installing systemd services"
# ---------------------------------------------------------------------------

install_unit() {
  local source="$1" name="$2"
  # Match the unit's User and paths to how this script was invoked.
  # The longer path first: /opt/maud-ai/voa-gny-chat-bot must not be rewritten by the
  # /opt/maud-ai rule before it has been matched.
  sudo sed -e "s|^User=.*|User=$SERVICE_USER|" \
           -e "s|/opt/maud-ai/voa-gny-chat-bot|$APP_DIR|g" \
           -e "s|/opt/maud-ai|$MAUD_DIR|g" \
           "$source" | sudo tee "/etc/systemd/system/$name" >/dev/null
}

install_unit "$APP_DIR/backend/maud-ai.service" maud-ai.service
install_unit "$APP_DIR/deploy/voa-gny-frontend.service" voa-gny-frontend.service

sudo systemctl daemon-reload
sudo systemctl enable --now maud-ai.service
sudo systemctl restart maud-ai.service
sudo systemctl enable --now voa-gny-frontend.service
sudo systemctl restart voa-gny-frontend.service

# ---------------------------------------------------------------------------
step "Waiting for the services to come up"
# ---------------------------------------------------------------------------

# The backend loads the embedding model before it binds, which takes a while.
wait_for() {
  local url="$1" name="$2" tries=0
  until curl -sf --max-time 5 "$url" >/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      warn "$name did not respond at $url"
      warn "check: journalctl -u $3 -n 50 --no-pager"
      return 1
    fi
    sleep 2
  done
  info "$name is up"
}

wait_for "localhost:$BACKEND_PORT/health" "backend" maud-ai || true
wait_for "localhost:$FRONTEND_PORT" "frontend" voa-gny-frontend || true

# ---------------------------------------------------------------------------
step "Done"
# ---------------------------------------------------------------------------

host_ip="$(hostname -I | awk '{print $1}')"
cat <<EOF

    Open the assistant at:  http://$host_ip:$FRONTEND_PORT

    Backend health:         curl -s localhost:$BACKEND_PORT/health | python3 -m json.tool
    Logs:                   journalctl -u maud-ai -f
                            journalctl -u voa-gny-frontend -f
    Restart:                sudo systemctl restart maud-ai voa-gny-frontend

EOF

if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "^Status: active"; then
  if ! sudo ufw status | grep -q "$FRONTEND_PORT"; then
    warn "ufw is active and port $FRONTEND_PORT is not open. To reach it from the LAN:"
    warn "  sudo ufw allow from 10.10.1.0/24 to any port $FRONTEND_PORT proto tcp"
  fi
fi
