#!/bin/sh
# Mint a GitHub App installation token so Marsh pushes/PRs author as
# marsh-agent[bot]. IDs from config/github-app.json (team-shared, non-secret);
# private key per-machine at ~/.config/marsh/github-app.pem (never in repo).
# Prints the token (valid ~1h). Callers: TOKEN=$(gh_app_token.sh) then
#   git push:  https://x-access-token:$TOKEN@github.com/ORG/REPO
#   gh:        GH_TOKEN=$TOKEN gh pr create ...
set -eu
HUB="$(cd "$(dirname "$0")/../../.." && pwd)"
CFG="$HUB/config/github-app.json"
APP_ID=$(python3 -c "import json;print(json.load(open('$CFG'))['appId'])")
INST_ID=$(python3 -c "import json;print(json.load(open('$CFG'))['installationId'])")
KEY="${MARSH_GH_KEY:-$HOME/.config/marsh/github-app.pem}"
[ -f "$KEY" ] || { echo "no private key at $KEY — see config/github-app.json" >&2; exit 1; }
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
NOW=$(date +%s)
HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
PAY=$(printf '{"iat":%d,"exp":%d,"iss":%s}' "$((NOW - 60))" "$((NOW + 540))" "$APP_ID" | b64)
SIG=$(printf '%s.%s' "$HDR" "$PAY" | openssl dgst -sha256 -sign "$KEY" -binary | b64)
curl -sf -X POST -H "Authorization: Bearer $HDR.$PAY.$SIG" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/$INST_ID/access_tokens" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"
