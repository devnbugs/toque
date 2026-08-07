#!/usr/bin/env bash
#
# Set up Cloudflare Access with Managed OAuth for the Toque Worker.
#
# This script:
#   1. Creates a Cloudflare Access application for the Worker's custom domain
#   2. Enables Managed OAuth (OAuth 2.0 authorization server) on it
#   3. Sets TEAM_DOMAIN and POLICY_AUD secrets on the Worker via wrangler
#
# Prerequisites:
#   - Logged in to wrangler (npx wrangler login)
#   - A Cloudflare API token with Access: Apps and Policies Write permission
#     Create one at: https://dash.cloudflare.com/profile/api-tokens
#     (wrangler's own OAuth token does NOT have Access permissions)
#   - The Worker must have a custom domain (e.g. toque.vortex.name.ng)
#
# Usage:
#   CLOUDFLARE_API_TOKEN=your-access-token ./scripts/setup-access-oauth.sh
#
# If you already created the Access app in the dashboard, run with --secrets-only:
#   CLOUDFLARE_API_TOKEN=your-access-token ./scripts/setup-access-oauth.sh --secrets-only
#
# Optional environment variables:
#   APP_DOMAIN        — Worker custom domain (default: toque.vortex.name.ng)
#   TEAM_NAME         — Zero Trust team name (auto-detected or prompted)
#   SESSION_DURATION  — OAuth grant session duration (default: 168h = 7 days)
#   TOKEN_LIFETIME    — Access token lifetime (default: 15m)

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

APP_DOMAIN="${APP_DOMAIN:-toque.vortex.name.ng}"
SESSION_DURATION="${SESSION_DURATION:-168h}"
TOKEN_LIFETIME="${TOKEN_LIFETIME:-15m}"
SECRETS_ONLY=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --secrets-only) SECRETS_ONLY=true ;;
    --help|-h)
      sed -n '2,25p' "$0"
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo -e "\033[1;34m▶\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
err()  { echo -e "\033[1;31m✗\033[0m $*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Check wrangler auth and get account ID
# ---------------------------------------------------------------------------
log "Checking wrangler authentication..."
WHOAMI_OUT=$(npx wrangler whoami 2>&1)

if echo "$WHOAMI_OUT" | grep -q "not logged in\|You are not logged"; then
  die "Not logged in to wrangler. Run: npx wrangler login"
fi

# Extract account ID from wrangler whoami output
ACCOUNT_ID=$(echo "$WHOAMI_OUT" | grep -oE '[a-f0-9]{32}' | head -1)
if [ -z "$ACCOUNT_ID" ]; then
  die "Could not detect account ID from wrangler whoami. Set ACCOUNT_ID manually."
fi
ok "Wrangler authenticated (account: $ACCOUNT_ID)"

# ---------------------------------------------------------------------------
# Resolve the API token to use for Access API calls
# ---------------------------------------------------------------------------
# Priority: CLOUDFLARE_API_TOKEN env var > wrangler's OAuth token
# wrangler's OAuth token usually lacks Access permissions, but try it first
# so users with broader-scoped tokens don't need to set CLOUDFLARE_API_TOKEN.

WRANGLER_TOKEN=""
if [ -f "$HOME/.config/.wrangler/config/default.toml" ]; then
  WRANGLER_TOKEN=$(grep oauth_token "$HOME/.config/.wrangler/config/default.toml" | head -1 | sed 's/.*= "//;s/"//')
fi

API_TOKEN="${CLOUDFLARE_API_TOKEN:-$WRANGLER_TOKEN}"
AUTH_HEADER="Authorization: Bearer $API_TOKEN"

# Test which token works for the Access API
log "Testing API token for Access permissions..."
ACCESS_TEST=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
  -H "$AUTH_HEADER" 2>&1)

if echo "$ACCESS_TEST" | grep -q '"success":true'; then
  ok "API token has Access permissions"
  HAS_ACCESS=true
elif [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  err "CLOUDFLARE_API_TOKEN does not have Access permissions or is invalid."
  err "Create a token with 'Access: Apps and Policies Write' at:"
  err "  https://dash.cloudflare.com/profile/api-tokens"
  die "Cannot proceed without Access API permissions."
else
  err "Wrangler's OAuth token does not have Access (Zero Trust) permissions."
  err "To create the Access application automatically, provide an API token:"
  err "  CLOUDFLARE_API_TOKEN=your-token ./scripts/setup-access-oauth.sh"
  err ""
  err "Or set up the Access app manually in the dashboard and run with --secrets-only:"
  err "  ./scripts/setup-access-oauth.sh --secrets-only"
  HAS_ACCESS=false
fi

# ---------------------------------------------------------------------------
# Detect Zero Trust team name
# ---------------------------------------------------------------------------
TEAM_NAME="${TEAM_NAME:-}"

if [ "$HAS_ACCESS" = true ]; then
  log "Detecting Zero Trust team name..."
  TEAM_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
    -H "$AUTH_HEADER")

  if echo "$TEAM_RESPONSE" | grep -q '"success":true'; then
    TEAM_NAME=$(echo "$TEAM_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
name = result.get('name', '') or result.get('team_name', '') or result.get('domain', '')
print(name)
" 2>/dev/null || echo "")

    if [ -z "$TEAM_NAME" ]; then
      TEAM_NAME=$(echo "$TEAM_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
auth_domain = result.get('auth_domain', '') or result.get('domain', '')
if auth_domain and '.cloudflareaccess.com' in auth_domain:
    print(auth_domain.replace('.cloudflareaccess.com', ''))
else:
    print(auth_domain)
" 2>/dev/null || echo "")
    fi
  fi
fi

if [ -z "$TEAM_NAME" ]; then
  echo ""
  echo "Could not auto-detect your Zero Trust team name."
  echo "Find it at: Zero Trust > Settings > Custom Pages > Team domain"
  echo "  (e.g. 'myteam' from https://myteam.cloudflareaccess.com)"
  read -rp "Enter your team name: " TEAM_NAME
fi

if [ -z "$TEAM_NAME" ]; then
  die "Team name is required."
fi

TEAM_DOMAIN="https://${TEAM_NAME}.cloudflareaccess.com"
ok "Zero Trust team: $TEAM_NAME"
ok "Team domain: $TEAM_DOMAIN"

# ---------------------------------------------------------------------------
# Create or update Access application (skip if --secrets-only or no Access perms)
# ---------------------------------------------------------------------------
APP_ID=""
APP_AUD=""

if [ "$SECRETS_ONLY" = false ] && [ "$HAS_ACCESS" = true ]; then
  log "Checking for existing Access application for $APP_DOMAIN..."

  APPS_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
    -H "$AUTH_HEADER")

  APP_ID=$(echo "$APPS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for app in data.get('result', []):
    if '$APP_DOMAIN' in str(app):
        print(app.get('id', ''))
        break
" 2>/dev/null || echo "")

  if [ -n "$APP_ID" ]; then
    ok "Found existing Access application: $APP_ID"
  else
    log "Creating new Access application for $APP_DOMAIN..."

    CREATE_BODY=$(cat <<END_JSON
{
  "name": "Toque Worker",
  "domain": "$APP_DOMAIN",
  "type": "self_hosted",
  "session_duration": "24h",
  "auto_redirect_to_identity": false,
  "oauth_configuration": {
    "enabled": true,
    "grant": {
      "access_token_lifetime": "$TOKEN_LIFETIME",
      "session_duration": "$SESSION_DURATION"
    }
  }
}
END_JSON
)

    CREATE_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
      -X POST \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      -d "$CREATE_BODY")

    if ! echo "$CREATE_RESPONSE" | grep -q '"success":true'; then
      err "Failed to create Access application:"
      echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))" 2>/dev/null || echo "$CREATE_RESPONSE"
      die "Access application creation failed."
    fi

    APP_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
    ok "Created Access application: $APP_ID"
  fi

  # Enable Managed OAuth
  log "Enabling Managed OAuth on application $APP_ID..."

  OAUTH_BODY=$(cat <<END_JSON
{
  "oauth_configuration": {
    "enabled": true,
    "grant": {
      "access_token_lifetime": "$TOKEN_LIFETIME",
      "session_duration": "$SESSION_DURATION"
    }
  }
}
END_JSON
)

  OAUTH_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID" \
    -X PUT \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "$OAUTH_BODY")

  if ! echo "$OAUTH_RESPONSE" | grep -q '"success":true'; then
    err "Warning: Failed to enable Managed OAuth:"
    echo "$OAUTH_RESPONSE" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))" 2>/dev/null || echo "$OAUTH_RESPONSE"
  else
    ok "Managed OAuth enabled"
  fi

  # Get the AUD tag
  APP_AUD=$(echo "$OAUTH_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
aud = result.get('aud', '') or ''
print(aud)
" 2>/dev/null || echo "")

  if [ -z "$APP_AUD" ]; then
    APP_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID" \
      -H "$AUTH_HEADER")
    APP_AUD=$(echo "$APP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('aud',''))" 2>/dev/null || echo "")
  fi

  if [ -z "$APP_AUD" ]; then
    err "Warning: Could not retrieve AUD tag. You'll need to set POLICY_AUD manually."
  else
    ok "Application AUD: $APP_AUD"
  fi
fi

# ---------------------------------------------------------------------------
# Set Worker secrets via wrangler
# ---------------------------------------------------------------------------
log "Setting Worker secrets via wrangler..."

# Build secrets JSON for wrangler secret bulk
SECRETS_FILE=$(mktemp)
trap "rm -f $SECRETS_FILE" EXIT

if [ -n "$APP_AUD" ] && [ "$APP_AUD" != "<set-manually>" ]; then
  python3 -c "
import json
print(json.dumps({'TEAM_DOMAIN': '$TEAM_DOMAIN', 'POLICY_AUD': '$APP_AUD'}))
" > "$SECRETS_FILE"
else
  # Only set TEAM_DOMAIN; prompt for POLICY_AUD
  echo ""
  echo "Enter the AUD tag from your Access application."
  echo "Find it at: Zero Trust > Access controls > Applications > Toque Worker > Advanced settings"
  read -rp "AUD tag (or press Enter to skip): " MANUAL_AUD
  if [ -n "$MANUAL_AUD" ]; then
    APP_AUD="$MANUAL_AUD"
    python3 -c "
import json
print(json.dumps({'TEAM_DOMAIN': '$TEAM_DOMAIN', 'POLICY_AUD': '$APP_AUD'}))
" > "$SECRETS_FILE"
  else
    python3 -c "
import json
print(json.dumps({'TEAM_DOMAIN': '$TEAM_DOMAIN'}))
" > "$SECRETS_FILE"
  fi
fi

npx wrangler secret bulk "$SECRETS_FILE" 2>&1 | grep -v "^$" || true

SECRETS_SET="TEAM_DOMAIN"
if [ -n "$APP_AUD" ]; then
  SECRETS_SET="$SECRETS_SET, POLICY_AUD"
fi
ok "Set Worker secrets: $SECRETS_SET"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"
ok "Cloudflare Access with Managed OAuth is set up!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Application domain : $APP_DOMAIN"
if [ -n "$APP_ID" ]; then
  echo "  Access app ID      : $APP_ID"
fi
if [ -n "$APP_AUD" ]; then
  echo "  AUD tag            : $APP_AUD"
fi
echo "  Team domain        : $TEAM_DOMAIN"
echo "  Token lifetime     : $TOKEN_LIFETIME"
echo "  Session duration   : $SESSION_DURATION"
echo ""
echo "  OAuth discovery    : https://$APP_DOMAIN/.well-known/oauth-authorization-server"
echo ""
echo "  The Worker now validates Cf-Access-Jwt-Assertion headers."
echo "  Non-browser clients (CLI, scripts) can use the OAuth 2.0"
echo "  authorization code flow to authenticate."
echo ""
echo "  To test with curl:"
echo "    curl -v https://$APP_DOMAIN/cmd/list"
echo "  → Returns 401 with WWW-Authenticate header pointing to OAuth"
echo ""
