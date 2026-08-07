#!/usr/bin/env bash
#
# Set up Cloudflare Access with Managed OAuth for the Toque Worker.
#
# This script:
#   1. Creates a Cloudflare Access application for the Worker's custom domain
#   2. Enables Managed OAuth (OAuth 2.0 authorization server) on it
#   3. Sets TEAM_DOMAIN and POLICY_AUD secrets on the Worker
#
# Prerequisites:
#   - A Cloudflare API token with these permissions:
#       Access: Apps and Policies Write
#       Workers Scripts: Edit
#   - Create one at: https://dash.cloudflare.com/profile/api-tokens
#   - The Worker must have a custom domain (e.g. toque.vortex.name.ng)
#
# Usage:
#   CLOUDFLARE_API_TOKEN=your-token ./scripts/setup-access-oauth.sh
#
# Optional environment variables:
#   ACCOUNT_ID     — Cloudflare account ID (auto-detected from wrangler)
#   APP_DOMAIN      — Worker custom domain (default: toque.vortex.name.ng)
#   TEAM_NAME       — Zero Trust team name (auto-detected or prompted)
#   SESSION_DURATION — OAuth grant session duration (default: 168h = 7 days)
#   TOKEN_LIFETIME  — Access token lifetime (default: 15m)

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ACCOUNT_ID="${ACCOUNT_ID:-3943d4ec18c5391fbbe9158a5d629b55}"
APP_DOMAIN="${APP_DOMAIN:-toque.vortex.name.ng}"
SESSION_DURATION="${SESSION_DURATION:-168h}"
TOKEN_LIFETIME="${TOKEN_LIFETIME:-15m}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo -e "\033[1;34m▶\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
err()  { echo -e "\033[1;31m✗\033[0m $*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  die "CLOUDFLARE_API_TOKEN is required. Create a token at:
  https://dash.cloudflare.com/profile/api-tokens

Required permissions:
  - Access: Apps and Policies Write
  - Workers Scripts: Edit

Then run:
  CLOUDFLARE_API_TOKEN=your-token ./scripts/setup-access-oauth.sh"
fi

API_TOKEN="$CLOUDFLARE_API_TOKEN"
AUTH_HEADER="Authorization: Bearer $API_TOKEN"

log "Verifying API token..."
WHOAMI=$(curl -s "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "$AUTH_HEADER")
if ! echo "$WHOAMI" | grep -q '"success":true'; then
  die "API token verification failed. Check your CLOUDFLARE_API_TOKEN."
fi
TOKEN_STATUS=$(echo "$WHOAMI" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['status'])" 2>/dev/null || echo "unknown")
ok "API token verified (status: $TOKEN_STATUS)"

# ---------------------------------------------------------------------------
# Detect Zero Trust team name
# ---------------------------------------------------------------------------

log "Detecting Zero Trust team name..."
TEAM_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
  -H "$AUTH_HEADER")

if echo "$TEAM_RESPONSE" | grep -q '"success":true'; then
  TEAM_NAME=$(echo "$TEAM_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
# Try different fields where the team name might be
name = result.get('name', '') or result.get('team_name', '') or result.get('domain', '')
print(name)
" 2>/dev/null || echo "")

  if [ -z "$TEAM_NAME" ]; then
    # Try to get it from the auth domain
    TEAM_NAME=$(echo "$TEAM_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
auth_domain = result.get('auth_domain', '') or result.get('domain', '')
# auth_domain is like 'myteam.cloudflareaccess.com'
if auth_domain and '.cloudflareaccess.com' in auth_domain:
    print(auth_domain.replace('.cloudflareaccess.com', ''))
else:
    print(auth_domain)
" 2>/dev/null || echo "")
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
# Create or update Access application
# ---------------------------------------------------------------------------

log "Checking for existing Access application for $APP_DOMAIN..."

# List existing Access apps
APPS_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "$AUTH_HEADER")

# Find an app matching our domain
APP_ID=$(echo "$APPS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for app in data.get('result', []):
    domain = app.get('domain', '') or app.get('self_hosted_domains', [''])[0] if app.get('self_hosted_domains') else ''
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

# ---------------------------------------------------------------------------
# Enable Managed OAuth (if not already enabled)
# ---------------------------------------------------------------------------

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

# Get the AUD (audience) tag from the app
APP_AUD=$(echo "$OAUTH_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
result = data.get('result', {})
aud = result.get('aud', '') or ''
print(aud)
" 2>/dev/null || echo "")

if [ -z "$APP_AUD" ]; then
  # Fetch the full app to get the AUD
  APP_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID" \
    -H "$AUTH_HEADER")
  APP_AUD=$(echo "$APP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('aud',''))" 2>/dev/null || echo "")
fi

if [ -z "$APP_AUD" ]; then
  err "Warning: Could not retrieve AUD tag. You'll need to set POLICY_AUD manually."
  APP_AUD="<set-manually>"
else
  ok "Application AUD: $APP_AUD"
fi

# ---------------------------------------------------------------------------
# Set Worker secrets
# ---------------------------------------------------------------------------

log "Setting Worker secrets..."

# Set TEAM_DOMAIN
echo "$TEAM_DOMAIN" | npx wrangler secret put TEAM_DOMAIN 2>&1 | grep -v "^$" || true
ok "Set TEAM_DOMAIN secret: $TEAM_DOMAIN"

# Set POLICY_AUD
if [ "$APP_AUD" != "<set-manually>" ]; then
  echo "$APP_AUD" | npx wrangler secret put POLICY_AUD 2>&1 | grep -v "^$" || true
  ok "Set POLICY_AUD secret: $APP_AUD"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════════════"
ok "Cloudflare Access with Managed OAuth is set up!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Application domain : $APP_DOMAIN"
echo "  Access app ID      : $APP_ID"
echo "  AUD tag            : $APP_AUD"
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
echo "  To test with curl through a browser OAuth flow:"
echo "    curl -v https://$APP_DOMAIN/cmd/list"
echo "  → Returns 401 with WWW-Authenticate header pointing to OAuth"
echo ""
