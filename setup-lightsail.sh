#!/usr/bin/env bash
# =============================================================================
#  EdgeBoard / PitchEdge — one-shot setup for AWS Lightsail (Ubuntu 22.04/24.04)
#
#  What it does
#    1. Asks for: domain, admin e-mail (for Let's Encrypt), app source,
#       optional Cloudflare API token, optional API-Sports key, settings PIN
#    2. Installs: Node 20, PostgreSQL, Nginx, Certbot (+ Cloudflare DNS plugin), UFW, swap
#    3. Creates the database, writes .env, installs, builds, seeds demo data
#    4. Runs the app as a systemd service (user: ubuntu) on 127.0.0.1:3000
#    5. Requests an SSL certificate and installs it in Nginx
#         - with a Cloudflare token: DNS challenge (works with the orange cloud ON)
#         - without a token:        HTTP challenge (DNS record must point at this server)
#    6. Forces HTTPS (301 redirect + HSTS), restores real visitor IPs behind Cloudflare
#    7. Schedules the ingest / lock jobs from vercel.json as cron jobs
#    8. Sets up automatic certificate renewal
#
#  Usage (on the server, as the ubuntu user):
#    chmod +x setup-lightsail.sh
#    sudo ./setup-lightsail.sh            # first install
#    sudo ./setup-lightsail.sh update [app]   # new zip / git pull, rebuild, restart
#  Run it once per app to host PitchEdge and EdgeBoard on the same server (different domains).
# =============================================================================
set -Eeuo pipefail

# ---------- helpers ----------------------------------------------------------
C_G="\033[1;32m"; C_Y="\033[1;33m"; C_R="\033[1;31m"; C_B="\033[1;36m"; C_0="\033[0m"
say()  { echo -e "${C_B}==>${C_0} $*"; }
ok()   { echo -e "${C_G}✔${C_0} $*"; }
warn() { echo -e "${C_Y}!${C_0} $*"; }
die()  { echo -e "${C_R}✘ $*${C_0}" >&2; exit 1; }
trap 'die "Failed at line $LINENO. Fix the error above and re-run; the script is safe to run again."' ERR

ask() { # ask VAR "Prompt" "default" [secret]
  local __var=$1 __prompt=$2 __def=${3:-} __secret=${4:-} __val
  if [[ -n "$__secret" ]]; then read -r -s -p "$__prompt${__def:+ [$__def]}: " __val; echo
  else read -r -p "$__prompt${__def:+ [$__def]}: " __val; fi
  printf -v "$__var" '%s' "${__val:-$__def}"
}
rand() { openssl rand -hex "${1:-24}"; }

# Cron lines from vercel.json. The heavy full sync (/api/cron/ingest) runs as its OWN low-priority process
# (npm run ingest), so the website stays responsive; light jobs (lock, results) call the app over HTTP.
cron_lines() { # dir port secret name
  local dir=$1 port=$2 secret=$3 name=$4
  touch "/var/log/$name-cron.log"; chown "$APP_USER:$APP_USER" "/var/log/$name-cron.log"
  node -e '
    const [file, dir, port, secret, name, user] = process.argv.slice(1); const v = require(file);
    for (const c of v.crons || []) {
      if (c.path === "/api/cron/ingest" && require("fs").existsSync(dir + "/scripts/ingest.ts"))
        console.log(`${c.schedule} ${user} cd ${dir} && flock -n /tmp/${name}-ingest.lock nice -n 10 npm run -s ingest >> /var/log/${name}-cron.log 2>&1`);
      else
        console.log(`${c.schedule} root curl -fsS -m 3600 -H "Authorization: Bearer ${secret}" "http://127.0.0.1:${port}${c.path}" >> /var/log/${name}-cron.log 2>&1`);
    }
  ' "$dir/vercel.json" "$dir" "$port" "$secret" "$name" "$APP_USER"
}

[[ $EUID -eq 0 ]] || die "Run with sudo:  sudo ./setup-lightsail.sh"
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This script supports Ubuntu only (found: ${ID:-unknown})."

APP_USER="ubuntu"
id "$APP_USER" >/dev/null 2>&1 || die "User '$APP_USER' not found (Lightsail Ubuntu images use 'ubuntu')."
MODE="${1:-install}"
state_file() { echo "/etc/edge-setup-$1.conf"; }

# =============================================================================
#  UPDATE MODE — rebuild from new code without touching SSL / DB / nginx
# =============================================================================
if [[ "$MODE" == "update" ]]; then
  INSTALLED=$(ls /etc/edge-setup-*.conf 2>/dev/null | sed 's#.*/edge-setup-##; s#\.conf$##' | tr '\n' ' ' || true)
  [[ -n "$INSTALLED" ]] || die "No previous install found. Run without 'update' first."
  ask APP_NAME "Which app to update? (installed: $INSTALLED)" "${2:-$(echo "$INSTALLED" | awk '{print $1}')}"
  STATE_FILE=$(state_file "$APP_NAME")
  [[ -f "$STATE_FILE" ]] || die "No install found for '$APP_NAME'."
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  say "Updating $APP_NAME in $APP_DIR"
  if [[ -d "$APP_DIR/.git" ]]; then
    sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
  elif [[ -f "$APP_DIR/.deploy-source" && -d "$(cat "$APP_DIR/.deploy-source")" ]]; then
    SRC=$(cat "$APP_DIR/.deploy-source")
    say "Syncing from $SRC"
    [[ -d "$SRC/.git" ]] && sudo -u "$APP_USER" git -C "$SRC" pull --ff-only || true
    rsync -a --delete --exclude ".env" --exclude "node_modules" --exclude ".next" --exclude ".git" --exclude ".deploy-source" "$SRC"/ "$APP_DIR"/
    echo "$SRC" > "$APP_DIR/.deploy-source"; chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  else
    ask ZIP "Path to the new project zip" "$(ls -t /home/$APP_USER/*.zip 2>/dev/null | head -1 || true)"
    [[ -f "$ZIP" ]] || die "Zip not found: $ZIP"
    TMP=$(mktemp -d); unzip -q "$ZIP" -d "$TMP"
    SRC=$(dirname "$(find "$TMP" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | head -1)")
    rsync -a --delete --exclude ".env" --exclude "node_modules" --exclude ".next" "$SRC"/ "$APP_DIR"/
    rm -rf "$TMP"; chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  fi
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci --no-audit --no-fund && npx prisma db push --skip-generate && npm run build"
  systemctl restart "$APP_NAME"
  # Refresh scheduled jobs from vercel.json (new jobs such as lock/results appear automatically)
  CRON_SECRET=$(grep -E '^CRON_SECRET=' "$APP_DIR/.env" | head -1 | cut -d= -f2-)
  if [[ -f "$APP_DIR/vercel.json" && -n "$CRON_SECRET" ]]; then
    {
      echo "# Generated from $APP_DIR/vercel.json"
      echo "SHELL=/bin/bash"
      cron_lines "$APP_DIR" "$PORT" "$CRON_SECRET" "$APP_NAME"
    } > "/etc/cron.d/$APP_NAME"
    chmod 644 "/etc/cron.d/$APP_NAME"; systemctl restart cron
    ok "Scheduled jobs refreshed: $(grep -c curl "/etc/cron.d/$APP_NAME") job(s)"
  fi
  # Keep the cron log from growing forever
  printf '/var/log/%s-cron.log {\n  weekly\n  rotate 4\n  compress\n  missingok\n  notifempty\n}\n' "$APP_NAME" > "/etc/logrotate.d/$APP_NAME"
  ok "Updated and restarted. Check: systemctl status $APP_NAME"
  exit 0
fi

# =============================================================================
#  1. QUESTIONS
# =============================================================================
clear || true
echo -e "${C_B}EdgeBoard / PitchEdge — Lightsail setup${C_0}\n"
ask DOMAIN "Domain for the site (e.g. edgeboard.example.com)" ""
DOMAIN="${DOMAIN,,}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^([a-z0-9-]+\.)+[a-z]{2,}$ ]] || die "That doesn't look like a domain: $DOMAIN"
ask WWW "Also serve www.$DOMAIN? (y/n)" "n"
ask EMAIL "Admin e-mail for SSL expiry notices (Let's Encrypt)" ""
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Invalid e-mail: $EMAIL"

ask APP_NAME "App name (edgeboard or pitchedge)" "edgeboard"
APP_NAME=$(echo "${APP_NAME,,}" | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')
[[ "$APP_NAME" =~ ^[a-z] ]] || APP_NAME="app-$APP_NAME"
echo "  → app name: $APP_NAME"
APP_DIR="/var/www/$APP_NAME"; STATE_FILE=$(state_file "$APP_NAME")
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || die "App name must be lowercase letters, numbers or dashes."
DEFAULT_SRC=""
if [[ -f "$PWD/package.json" && -f "$PWD/prisma/schema.prisma" ]]; then DEFAULT_SRC="$PWD"
else DEFAULT_SRC=$(ls -t /home/$APP_USER/*.zip 2>/dev/null | head -1 || true); fi
ask SOURCE "App source: project FOLDER (e.g. a cloned repo), .zip file, or git URL" "$DEFAULT_SRC"
[[ -n "$SOURCE" ]] || die "No source given. Run this from inside your cloned repo, or give the folder / zip path."
SOURCE="${SOURCE/#\~/$(eval echo ~$APP_USER)}"

echo
echo "Cloudflare API token (optional, recommended). Create it at dash.cloudflare.com → My Profile →"
echo "API Tokens → 'Edit zone DNS' template, limited to your zone. Leave blank to use the HTTP challenge."
ask CF_TOKEN "Cloudflare API token" "" secret

ask API_KEY "API-Sports key (blank = demo mode; you can add it later in Settings)" "" secret
ask PIN "Settings PIN (numbers, 6+ digits)" "$(shuf -i 100000-999999 -n 1)"
ask SEED "Load demo data now? (y/n)" "y"
SUGGEST_PORT=3000
if [[ -f "$STATE_FILE" ]]; then SUGGEST_PORT=$(. "$STATE_FILE"; echo "$PORT")
else while ss -ltn | grep -q ":$SUGGEST_PORT " || grep -qs "^PORT=$SUGGEST_PORT$" /etc/edge-setup-*.conf; do SUGGEST_PORT=$((SUGGEST_PORT+1)); done; fi
ask PORT "Internal app port (each app on this server needs its own)" "$SUGGEST_PORT"

WWW_ON=false; [[ "${WWW,,}" == "y" ]] && WWW_ON=true
if $WWW_ON && [[ $(echo "$DOMAIN" | tr -cd '.' | wc -c) -ge 2 ]]; then
  warn "www.$DOMAIN is a second-level subdomain. Cloudflare's free SSL does NOT cover it when proxied (orange cloud),"
  warn "so visitors would see a certificate error there. Recommended: answer n."
  ask WWW "Serve www.$DOMAIN anyway? (y/n)" "n"
  [[ "${WWW,,}" == "y" ]] || WWW_ON=false
fi
NAMES="$DOMAIN"; $WWW_ON && NAMES="$DOMAIN www.$DOMAIN"

echo
say "Summary"
echo "  Domain:      $NAMES"
echo "  SSL e-mail:  $EMAIL"
echo "  SSL method:  $([[ -n "$CF_TOKEN" ]] && echo 'Cloudflare DNS challenge' || echo 'HTTP challenge')"
echo "  App:         $APP_NAME → $APP_DIR (port $PORT, user $APP_USER)"
echo "  Source:      $SOURCE"
ask GO "Continue? (y/n)" "y"; [[ "${GO,,}" == "y" ]] || die "Cancelled."

# =============================================================================
#  2. SYSTEM PACKAGES
# =============================================================================
say "Updating system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade -y
apt-get install -y curl ca-certificates gnupg git unzip rsync ufw nginx postgresql postgresql-contrib \
  certbot python3-certbot-nginx python3-certbot-dns-cloudflare dnsutils openssl cron
ok "Base packages installed"

# Swap: small Lightsail plans run out of RAM during `next build`
if ! swapon --show | grep -q '/swapfile'; then
  say "Creating 2 GB swap file"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
  ok "Swap enabled"
fi

# Node.js 20 LTS
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v), npm $(npm -v)"

# =============================================================================
#  3. FIREWALL
# =============================================================================
say "Configuring UFW firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "UFW active"
warn "Lightsail has its OWN firewall too: Lightsail console → your instance → Networking → IPv4 firewall → add rule HTTPS (TCP 443). Without it SSL will fail."

# =============================================================================
#  4. DATABASE
# =============================================================================
say "Setting up PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1
# Postgres names can't contain dashes unquoted: pitchedge-footy → pitchedge_footy
DB_NAME="${APP_NAME//-/_}"; DB_USER="${APP_NAME//-/_}"
pushd /tmp >/dev/null   # the postgres user can't read /home/ubuntu; avoids "could not change directory"
if [[ -f "$STATE_FILE" ]] && grep -q DB_PASS "$STATE_FILE"; then
  # shellcheck disable=SC1090
  DB_PASS=$(. "$STATE_FILE"; echo "$DB_PASS")
else
  DB_PASS=$(rand 16)
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
popd >/dev/null
ok "Database '$DB_NAME' ready (listening on localhost only)"

# =============================================================================
#  5. APP CODE
# =============================================================================
say "Deploying application code to $APP_DIR"
mkdir -p "$APP_DIR"
if [[ "$SOURCE" =~ ^(https?|git@) ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then git -C "$APP_DIR" pull --ff-only; else rm -rf "$APP_DIR"; git clone "$SOURCE" "$APP_DIR"; fi
elif [[ -d "$SOURCE" ]]; then
  SRC=$(dirname "$(find "$SOURCE" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | awk '{ print length, $0 }' | sort -n | head -1 | cut -d' ' -f2-)")
  [[ -f "$SRC/package.json" && -f "$SRC/prisma/schema.prisma" ]] || die "No app (package.json + prisma/schema.prisma) found in $SOURCE"
  [[ "$(realpath "$SRC")" == "$(realpath "$APP_DIR")" ]] || rsync -a --delete --exclude ".env" --exclude "node_modules" --exclude ".next" --exclude ".git" "$SRC"/ "$APP_DIR"/
  echo "$SRC" > "$APP_DIR/.deploy-source"
else
  [[ -f "$SOURCE" ]] || die "File not found: $SOURCE"
  TMP=$(mktemp -d); unzip -q "$SOURCE" -d "$TMP"
  SRC=$(dirname "$(find "$TMP" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | head -1)")
  [[ -f "$SRC/package.json" ]] || die "No package.json found inside $SOURCE"
  rsync -a --delete --exclude ".env" --exclude "node_modules" --exclude ".next" "$SRC"/ "$APP_DIR"/
  rm -rf "$TMP"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# .env — keep existing secrets on re-run so saved encrypted keys stay readable
ENV_FILE="$APP_DIR/.env"
keep() { [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
ENC_KEY=$(keep SETTINGS_ENCRYPTION_KEY); ENC_KEY=${ENC_KEY:-$(rand 32)}
CRON_SECRET=$(keep CRON_SECRET); CRON_SECRET=${CRON_SECRET:-$(rand 24)}
[[ -z "$API_KEY" ]] && API_KEY=$(keep API_SPORTS_KEY)

say "Writing $ENV_FILE"
cat > "$ENV_FILE" <<ENV
# Generated by setup-lightsail.sh on $(date -u +%F)
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
API_SPORTS_KEY=$API_KEY
SETTINGS_PIN=$PIN
SETTINGS_ENCRYPTION_KEY=$ENC_KEY
CRON_SECRET=$CRON_SECRET
DEFAULT_TIMEZONE=Africa/Lagos
PREDICTION_LOCK_MINUTES=15
NEXT_TELEMETRY_DISABLED=1
ENV
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
ok ".env written (permissions 600)"

say "Installing dependencies and building (this takes a few minutes)"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci --no-audit --no-fund"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npx prisma db push --skip-generate"
if [[ "${SEED,,}" == "y" ]]; then
  say "Loading demo data"
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run db:seed"
fi
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run build"
ok "Build complete"

# =============================================================================
#  6. SYSTEMD SERVICE
# =============================================================================
say "Creating systemd service '$APP_NAME'"
cat > "/etc/systemd/system/$APP_NAME.service" <<UNIT
[Unit]
Description=$APP_NAME (Next.js)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/npx next start -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$APP_NAME" >/dev/null
systemctl restart "$APP_NAME"
for i in {1..30}; do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 2; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && ok "App is running on 127.0.0.1:$PORT" \
  || warn "App not answering yet — check: journalctl -u $APP_NAME -n 50"

# =============================================================================
#  7. SCHEDULED JOBS (from vercel.json → cron)
# =============================================================================
say "Scheduling ingest / lock jobs"
CRON_FILE="/etc/cron.d/$APP_NAME"
{
  echo "# Generated from $APP_DIR/vercel.json"
  echo "SHELL=/bin/bash"
  if [[ -f "$APP_DIR/vercel.json" ]]; then
    cron_lines "$APP_DIR" "$PORT" "$CRON_SECRET" "$APP_NAME"
  fi
} > "$CRON_FILE"
chmod 644 "$CRON_FILE"
systemctl restart cron
ok "$(grep -c curl "$CRON_FILE" || true) job(s) scheduled in $CRON_FILE (log: /var/log/$APP_NAME-cron.log)"

# =============================================================================
#  8. NGINX (HTTP first, for the certificate request)
# =============================================================================
say "Configuring Nginx"
mkdir -p /var/www/letsencrypt
# Real visitor IPs when traffic comes through Cloudflare
CF_CONF=/etc/nginx/conf.d/cloudflare-realip.conf
{
  echo "# Cloudflare IP ranges → real client IP (refresh by re-running the setup)"
  for u in https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6; do
    curl -fsS "$u" 2>/dev/null | sed 's/^/set_real_ip_from /; s/$/;/' || true
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$CF_CONF"

SITE=/etc/nginx/sites-available/$APP_NAME
cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $NAMES;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; }
}
NGINX
ln -sf "$SITE" "/etc/nginx/sites-enabled/$APP_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "Nginx serving HTTP"

# =============================================================================
#  9. SSL CERTIFICATE
# =============================================================================
say "Checking DNS for $DOMAIN"
SERVER_IP=$(curl -fsS -4 https://checkip.amazonaws.com || true)
DNS_IPS=$(dig +short A "$DOMAIN" | tr '\n' ' ')
echo "  This server: ${SERVER_IP:-unknown}   $DOMAIN resolves to: ${DNS_IPS:-nothing}"
CF_PROXIED=false
# Proxied (orange cloud) records resolve to Cloudflare IPs, not to this server
if [[ -n "$DNS_IPS" && -n "$SERVER_IP" && "$DNS_IPS" != *"$SERVER_IP"* ]]; then CF_PROXIED=true; fi

CERT_ARGS=(--non-interactive --agree-tos -m "$EMAIL" --cert-name "$DOMAIN" -d "$DOMAIN")
$WWW_ON && CERT_ARGS+=(-d "www.$DOMAIN")

if [[ -n "$CF_TOKEN" ]]; then
  say "Requesting certificate via Cloudflare DNS challenge"
  install -d -m 700 /root/.secrets
  printf 'dns_cloudflare_api_token = %s\n' "$CF_TOKEN" > /root/.secrets/cloudflare.ini
  chmod 600 /root/.secrets/cloudflare.ini
  certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 "${CERT_ARGS[@]}"
else
  if [[ -z "$DNS_IPS" ]]; then die "$DOMAIN has no A record. In Cloudflare DNS add: A  $DOMAIN → ${SERVER_IP:-<Lightsail static IP>}, then re-run."; fi
  if $CF_PROXIED; then
    warn "$DOMAIN is behind the Cloudflare proxy (orange cloud). The HTTP challenge usually still works,"
    warn "but if it fails: turn off 'Always Use HTTPS' temporarily, OR set the record to DNS-only (grey cloud),"
    warn "OR re-run with a Cloudflare API token (recommended)."
  fi
  say "Requesting certificate via HTTP challenge"
  certbot certonly --webroot -w /var/www/letsencrypt "${CERT_ARGS[@]}"
fi
CERT_DIR=/etc/letsencrypt/live/$DOMAIN
[[ -f "$CERT_DIR/fullchain.pem" ]] || die "Certificate was not issued."
ok "Certificate issued for $NAMES"

# =============================================================================
#  10. NGINX HTTPS + FORCED REDIRECT
# =============================================================================
say "Enabling HTTPS and forcing all traffic to it"
[[ -f /etc/letsencrypt/ssl-dhparams.pem ]] || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 2>/dev/null
WWW_BLOCK=""
if $WWW_ON; then
WWW_BLOCK=$(cat <<WWWBLOCK
# ---- www → apex over HTTPS ----
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.$DOMAIN;
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    return 301 https://$DOMAIN\$request_uri;
}
WWWBLOCK
)
fi
cat > "$SITE" <<NGINX
# ---- HTTP: ACME challenges only, everything else → HTTPS ----
server {
    listen 80;
    listen [::]:80;
    server_name $NAMES;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$DOMAIN\$request_uri; }
}
$WWW_BLOCK
# ---- HTTPS app ----
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    client_max_body_size 10m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/manifest+json image/svg+xml;

    # Cron endpoints are for the local scheduler only
    location ^~ /api/cron/ { allow 127.0.0.1; deny all; proxy_pass http://127.0.0.1:$PORT; }

    # Immutable build assets
    location ^~ /_next/static/ {
        proxy_pass http://127.0.0.1:$PORT;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    # Service worker must never be cached
    location = /sw.js {
        proxy_pass http://127.0.0.1:$PORT;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGINX
# Older nginx (Ubuntu 22.04 ships 1.18) doesn't know "http2 on;" → use the listen flag instead
if ! nginx -t 2>/dev/null; then
  sed -i 's/^\(\s*\)http2 on;//; s/listen 443 ssl;/listen 443 ssl http2;/; s/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' "$SITE"
fi
nginx -t && systemctl reload nginx
ok "HTTPS live, HTTP → HTTPS redirect forced"

# First live sync right away (runs in the background; later runs come from cron)
if [[ -n "$API_KEY" && -f "$CRON_FILE" ]]; then
  say "Starting the first data sync in the background"
  grep -o 'curl .*' "$CRON_FILE" | grep -v 'job=lock' | while read -r cmd; do nohup bash -c "$cmd" >/dev/null 2>&1 & done
  ok "Sync started — watch /var/log/$APP_NAME-cron.log"
fi

# =============================================================================
#  11. AUTO-RENEWAL
# =============================================================================
say "Configuring automatic certificate renewal"
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot.timer >/dev/null 2>&1 || true
certbot renew --dry-run >/dev/null 2>&1 && ok "Renewal dry-run passed (renews automatically every ~60 days)" \
  || warn "Renewal dry-run failed — run 'sudo certbot renew --dry-run' to see why."

# =============================================================================
#  12. SAVE STATE + VERIFY
# =============================================================================
cat > "$STATE_FILE" <<STATE
APP_NAME=$APP_NAME
APP_DIR=$APP_DIR
DOMAIN=$DOMAIN
PORT=$PORT
DB_PASS=$DB_PASS
STATE
chmod 600 "$STATE_FILE"

say "Verifying"
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" || true)
HTTPS_CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" || true)
echo "  http://$DOMAIN  → $HTTP_CODE (expect 301)"
echo "  https://$DOMAIN → $HTTPS_CODE (expect 200 or 307)"

echo
echo -e "${C_G}=====================================================================${C_0}"
echo -e "${C_G} Done.  https://$DOMAIN${C_0}"
echo -e "${C_G}=====================================================================${C_0}"
cat <<INFO

  Settings PIN ........ $PIN   (Settings page → unlock → add keys / floors)
  App directory ....... $APP_DIR
  Service ............. sudo systemctl status $APP_NAME     logs: journalctl -u $APP_NAME -f
  Cron jobs ........... $CRON_FILE   log: /var/log/$APP_NAME-cron.log
  Update later ........ sudo ./setup-lightsail.sh update $APP_NAME

  Cloudflare checklist
   1. DNS: A record $DOMAIN → ${SERVER_IP:-your Lightsail static IP}  (attach a STATIC IP in Lightsail first)
   2. SSL/TLS → Overview → mode "Full (strict)"   (never "Flexible" — it causes redirect loops)
   3. SSL/TLS → Edge Certificates → "Always Use HTTPS" ON
   4. Lightsail → Networking → IPv4 firewall → HTTPS (443) allowed

INFO
