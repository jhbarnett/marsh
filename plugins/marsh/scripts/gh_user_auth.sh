#!/bin/sh
# One-time GitHub device-flow authorization: Marsh acts AS ITS OPERATOR.
# The user-to-server token = intersection(app permissions, YOUR repo access) —
# the agent can never exceed its human dev, and is narrower than a full gh
# token. Stores/refreshes ~/.config/marsh/github-user-token.json.
# Usage: gh_user_auth.sh            # interactive one-time authorize
#        gh_user_auth.sh --token    # print a valid access token (auto-refresh)
set -eu
HUB="$(cd "$(dirname "$0")/../../.." && pwd)"
CLIENT_ID=$(python3 -c "import json;print(json.load(open('$HUB/config/github-app.json')).get('clientId') or '')")
[ -n "$CLIENT_ID" ] || { echo "config/github-app.json needs clientId (app settings page)" >&2; exit 1; }
STORE="$HOME/.config/marsh/github-user-token.json"

if [ "${1:-}" = "--token" ]; then
  python3 - "$STORE" "$CLIENT_ID" <<'EOF'
import json, sys, time, urllib.request, urllib.parse
store, client_id = sys.argv[1], sys.argv[2]
d = json.load(open(store))
if d.get("expires_at", 9e12) > time.time() + 120:
    print(d["access_token"]); sys.exit(0)
body = urllib.parse.urlencode({"client_id": client_id, "grant_type": "refresh_token",
                               "refresh_token": d["refresh_token"]}).encode()
req = urllib.request.Request("https://github.com/login/oauth/access_token", body,
                             {"Accept": "application/json"})
r = json.load(urllib.request.urlopen(req))
if "access_token" not in r: raise SystemExit(f"refresh failed: {r}")
now = time.time()
d = {"access_token": r["access_token"], "refresh_token": r.get("refresh_token", d["refresh_token"]),
     "expires_at": now + int(r.get("expires_in", 28800))}
json.dump(d, open(store, "w")); print(d["access_token"])
EOF
  exit 0
fi

python3 - "$STORE" "$CLIENT_ID" <<'EOF'
import json, sys, time, urllib.request, urllib.parse
store, client_id = sys.argv[1], sys.argv[2]
def post(url, **kw):
    body = urllib.parse.urlencode(kw).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(url, body, {"Accept": "application/json"})))
d = post("https://github.com/login/device/code", client_id=client_id)
print(f"\n  Authorize Marsh as YOU:\n  open {d['verification_uri']}  and enter code:  {d['user_code']}\n", flush=True)
while True:
    time.sleep(d.get("interval", 5) + 1)
    r = post("https://github.com/login/oauth/access_token", client_id=client_id,
             device_code=d["device_code"], grant_type="urn:ietf:params:oauth:grant-type:device_code")
    if "access_token" in r: break
    if r.get("error") not in ("authorization_pending", "slow_down"): raise SystemExit(f"auth failed: {r}")
exp = time.time() + int(r["expires_in"]) if r.get("expires_in") else 9e12  # non-expiring app setting => never refresh
out = {"access_token": r["access_token"], "refresh_token": r.get("refresh_token"), "expires_at": exp}
json.dump(out, open(store, "w"))
print("  authorized — Marsh now acts as you on GitHub (token auto-refreshes)")
EOF
chmod 600 "$STORE" 2>/dev/null || true
