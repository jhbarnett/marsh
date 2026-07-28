#!/bin/sh
# Sync the portable base from this instance repo to the public repo checkout.
# Usage: scripts/publish-base.sh [path-to-public-checkout]   (default ~/Code/marsh)
#
# Copies the portable set, re-applies the known genericization transforms
# (idempotent — fails loudly if local drift breaks a pattern), then runs a
# sanitization grep gate. Review the diff in the public checkout and commit
# there manually. Never syncs: config/*.json (real), reports/, runbooks
# content, workbench/cards/, var/, artifacts/.
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:-$HOME/Code/marsh-meta}"
[ -d "$DST/.git" ] || {
  echo "public base checkout missing — cloning to $DST"
  git clone -q https://github.com/jhbarnett/marsh.git "$DST" || { echo "clone failed" >&2; exit 1; }
}

rsync -a --delete "$SRC/plugins/" "$DST/plugins/"
rsync -a "$SRC/protocol.md" "$SRC/DESIGN.md" "$SRC/CLAUDE.md" "$DST/"
rsync -a "$SRC/workbench/README.md" "$DST/workbench/README.md"
rsync -a "$SRC/runbooks/README.md" "$DST/runbooks/README.md"
cp "$SRC/config/policy.json" "$DST/config/policy.example.json"
cp "$SRC/.claude-plugin/marketplace.json" "$DST/.claude-plugin/marketplace.json"
rsync -a "$SRC/install.sh" "$SRC/TEAM_SETUP.md" "$DST/"
mkdir -p "$DST/scripts" "$DST/runbooks/internal"
rsync -a "$SRC/scripts/publish-base.sh" "$SRC/scripts/com.marsh.serve.plist.template" "$SRC/scripts/com.marsh.shift.plist.template" "$DST/scripts/"
rsync -a "$SRC/config/"*.example.json "$DST/config/"
rsync -a "$SRC/runbooks/internal/linear-work-on-issue.md" "$SRC/runbooks/internal/scheduled-shifts.md" "$DST/runbooks/internal/"
find "$DST" -name .gitkeep -delete

python3 - "$DST" <<'EOF'
import sys, pathlib
dst = pathlib.Path(sys.argv[1])
# (file, local-pattern, public-replacement, required)
transforms = [
    ("DESIGN.md", "(provisioned by Jason)", "(provisioned by the operator)", True),
    ("DESIGN.md", "The FitRankings mapping (Agents", "The reference mapping (Agents", True),
    ("plugins/marsh/commands/triage.md",
     "Security intake is an open question)",
     "their intake path comes from `taxonomy.intake`)", False),
    ("TEAM_SETUP.md",
     "Checkouts of the target repos (`fitrankings-core`, `fitrankings-apps`, \u2026)",
     "Checkouts of your target repos (as named in `config/registry.json`)", False),
    ("TEAM_SETUP.md",
     "https://github.com/FitRankings/marsh-agent.git",
     "https://github.com/YOUR-ORG/YOUR-marsh-instance.git", False),
    ("TEAM_SETUP.md",
     "FitRankings' **private Marsh instance**",
     "your team's **private Marsh instance**", False),
    ("CLAUDE.md",
     "the **private team remote**\n(github.com/FitRankings/marsh-agent)",
     "your instance's team remote\n(if configured — the public base has none)", False),
    ("plugins/marsh/workflows/triage-sweep.js",
     "`Proposed statuses are limited to: Triage, Backlog, Icebox. NEVER propose Todo — Todo means committed-to-cycle-plan, which is the human's cycle-planning authority, not triage's. Never remove plan-* labels.`,",
     "args?.statusRules ?? `Only propose statuses that appear in the provided taxonomy. Never promote an issue to an unstarted/committed status — cycle commitment is the human's authority, not triage's. Never remove plan-* labels.`,", False),
]
failed = False
for rel, old, new, required in transforms:
    p = dst / rel
    s = p.read_text()
    if old in s:
        p.write_text(s.replace(old, new))
        print(f"transformed: {rel}")
    elif new in s:
        print(f"already generic: {rel}")
    elif required:
        print(f"DRIFT: pattern missing in {rel} — reconcile by hand", file=sys.stderr)
        failed = True
sys.exit(1 if failed else 0)
EOF

# Sanitization gate: no instance references outside authorship metadata.
if grep -rn "fitrankings\|FitRankings\|Jason\|jason@" "$DST" \
     --include="*.md" --include="*.js" --include="*.sql" --include="*.sh" --include="*.py" \
     --exclude-dir=.git | grep -v "LICENSE" | grep -v "scripts/publish-base.sh"; then
  echo "SANITIZATION GATE FAILED: instance references above — fix before committing" >&2
  exit 1
fi

echo "--- synced; review and commit in $DST ---"
git -C "$DST" status --short
