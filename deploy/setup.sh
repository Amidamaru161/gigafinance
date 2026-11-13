#!/usr/bin/env bash
# One-time server setup (Ubuntu/Debian, run as root):
#   - Node.js 22, pnpm, nginx, apache2-utils
#   - clone/build GigaFinance into /opt/gigafinance
#   - system user `gigafinance`, shared secrets in /etc/gigafinance/secrets.env
# Then add users with deploy/add-user.sh.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Amidamaru161/gigafinance.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/gigafinance

apt-get update
apt-get install -y curl git nginx apache2-utils ca-certificates
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
corepack enable

id gigafinance >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/gigafinance --shell /usr/sbin/nologin gigafinance
mkdir -p /var/lib/gigafinance/users /etc/gigafinance

if [ -d "$APP/.git" ]; then
  git config --global --add safe.directory "$APP"; git -C "$APP" fetch "$REPO_URL" "$BRANCH" && git -C "$APP" checkout -B "$BRANCH" FETCH_HEAD
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP"
fi
chown -R gigafinance:gigafinance "$APP" /var/lib/gigafinance
sudo -u gigafinance -H bash -c "cd $APP && corepack pnpm install --frozen-lockfile && corepack pnpm run build"

if [ ! -f /etc/gigafinance/secrets.env ]; then
  cat > /etc/gigafinance/secrets.env <<'EOF'
# Shared by every user instance. Fill in, then run add-user.sh.
STRIVERSHOP_CLAUDE_API_KEY=
DEEPSEEK_API_KEY=
MOEX_MCP_URL=http://127.0.0.1:8765/mcp
MOEX_MCP_TOKEN=
EOF
fi
chown root:gigafinance /etc/gigafinance/secrets.env
chmod 640 /etc/gigafinance/secrets.env

install -m 644 "$APP/deploy/gigafinance@.service" /etc/systemd/system/gigafinance@.service
systemctl daemon-reload

# Login service (deploy/auth/server.mjs): accounts + session signing key.
install -d -o gigafinance -g gigafinance -m 700 /var/lib/gigafinance/auth
# Registration and the admin page create accounts through a root-owned copy
# of add-user.sh (the repo copy is writable by the service account, so it is
# never what sudo runs); this one command is all the service may sudo.
install -o root -g root -m 755 "$APP/deploy/add-user.sh" /usr/local/sbin/gigafinance-provision
echo 'gigafinance ALL=(root) NOPASSWD: /usr/local/sbin/gigafinance-provision' > /tmp/gigafinance.sudoers
visudo -cf /tmp/gigafinance.sudoers
install -o root -g root -m 440 /tmp/gigafinance.sudoers /etc/sudoers.d/gigafinance
rm -f /tmp/gigafinance.sudoers
install -m 644 "$APP/deploy/gigafinance-auth.service" /etc/systemd/system/gigafinance-auth.service
systemctl daemon-reload
systemctl enable --now gigafinance-auth
systemctl restart gigafinance-auth
# Leftovers of the earlier basic-auth setup.
rm -f /etc/nginx/gigafinance-users.map /etc/nginx/gigafinance.htpasswd /etc/nginx/gigafinance-tokens.map /etc/nginx/gigafinance-sessions.map

install -m 644 "$APP/deploy/nginx-gigafinance.conf" /etc/nginx/sites-available/gigafinance
ln -sf /etc/nginx/sites-available/gigafinance /etc/nginx/sites-enabled/gigafinance
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "Done. Fill /etc/gigafinance/secrets.env, then create the first admin:"
echo "  $APP/deploy/add-user.sh <login> && sudo -u gigafinance node $APP/deploy/auth/server.mjs set-admin <login> on"
