#!/usr/bin/env python3
"""Project a ledger snapshot into workbench cards.

Usage: project_cards.py <snapshot.json> [--cards-dir workbench/cards] [--prune-done-days N]
       project_cards.py --set ISSUE key=value [key=value ...]   # incremental update

The canonical snapshot home is var/board-snapshot.json (hub-durable, not job
tmp). --set mutates one issue's entry there (dotted keys ok: refs.pr=URL,
gate=null, statusType=completed) and reprojects the board — no more ad hoc
heredoc mutations.

Reconciliation contract (stale-card guard): the snapshot for a full-board
refresh MUST include every issue that already has a card (read the cards dir
first and fetch those issues too) plus all active issues — a card whose issue
closed since the last projection is otherwise never re-projected.
--prune-done-days N deletes cards in the done column whose `updated` is older
than N days (their canonical state lives in Linear; the card is just a view).

The snapshot is produced by a Marsh command from Linear state:
  [{"identifier","title","team","statusName","statusType","url","labels":[],
    "updatedAt","blocked":false,"lane":null,"gate":null,"summary":"",
    "decision":"","refs":{"branch":null,"pr":null,"artifacts":[]}}, ...]

Cards are projections: everything is regenerated EXCEPT the human-owned
"## Your reply" zone and the existing "## Log" body, which are preserved.
Unconsumed replies are reported on stdout so the caller can act on them.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Hub-anchored defaults: workbench/ and var/ are gitignored hub state, so
# cwd-relative defaults silently miss them when run from a worktree.
HUB = Path(os.environ.get("MARSH_HUB") or Path(__file__).resolve().parents[3])

# Reply zone ends at "## Log" specifically (not any "## ") so replies may
# contain their own markdown headings without being truncated or lost.
REPLY_RE = re.compile(r"^## Your reply\n(.*?)(?=^## Log$)", re.M | re.S)
LOG_RE = re.compile(r"^## Log\n(.*?)(?=^## |\Z)", re.M | re.S)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

SHAPE_GLYPHS = {"bug": "🐛", "feature": "✨", "debt": "🔧", "spike": "🔬", "epic": "🏔",
                "docs": "📚", "gap": "🧭", "security": "🔒", "layup": "🏀"}
TEAM_ICONS = {"MobilePhone": "📱", "Database": "🗄️", "Cube": "📦", "Lock": "🔒"}
PRIORITY_BY_NUM = {1: "urgent", 2: "high", 3: "medium", 4: "low"}
SEVERITY_MAP = {"Critical": "urgent", "High": "high", "Medium": "medium", "Low": "low"}


def load_taxonomy():
    try:
        return json.loads((HUB / "config" / "taxonomy.json").read_text())
    except (OSError, ValueError):
        return {}


TAXONOMY = load_taxonomy()
SHAPE_MAP = TAXONOMY.get("labelGroups", {}).get("Scope", {}).get("shapeMap", {})
TEAM_META = TAXONOMY.get("teams", {})


def derive_shape(issue: dict):
    if issue.get("shape"):
        return issue["shape"]
    for lab in issue.get("labels") or []:
        if lab in SHAPE_MAP:
            return SHAPE_MAP[lab]
        if lab.startswith("is-"):
            return lab[3:]
    return None


def derive_priority(issue: dict):
    p = issue.get("priority")
    if isinstance(p, int) and p in PRIORITY_BY_NUM:
        return PRIORITY_BY_NUM[p]
    for lab in issue.get("labels") or []:
        if lab in SEVERITY_MAP:
            return SEVERITY_MAP[lab]
    return None

REPLY_PLACEHOLDER = (
    "<!-- YOURS. Write or dictate a decision, changes, or instructions here.\n"
    "     Marsh consumes this zone on its next wake. -->\n"
)


def column_for(issue: dict) -> str:
    if issue.get("gate"):
        return "awaiting-decision"
    st = issue.get("statusType")
    if st == "triage":
        return "inbox"
    if st == "unstarted":
        return "ready" if not issue.get("blocked") else "inbox"
    if st == "started":
        name = (issue.get("statusName") or "").lower()
        return "in-review" if "review" in name else "in-progress"
    if st == "completed":
        return "done"
    return "inbox"


def lane_for(issue: dict) -> str:
    if issue.get("lane"):
        return issue["lane"]
    return "dev" if issue.get("statusType") == "started" else "planning"


def zone_text(body: str, pattern: re.Pattern) -> str:
    m = pattern.search(body)
    return m.group(1).strip() if m else ""


def is_real_reply(text: str) -> bool:
    return bool(COMMENT_RE.sub("", text).strip())


def render(issue: dict, reply: str, log: str, now: str, gate_since: str = "") -> str:
    refs = issue.get("refs") or {}
    artifacts = refs.get("artifacts") or []
    shape = derive_shape(issue)
    priority = derive_priority(issue)
    team_icon = TEAM_ICONS.get((TEAM_META.get(issue.get("team", "")) or {}).get("icon", ""), "")
    fm = [
        "---",
        f"issue: {issue['identifier']}",
        f"title: {json.dumps(issue.get('title', ''))}",
        f"lane: {lane_for(issue)}",
        f"column: {column_for(issue)}",
        f"gate: {issue.get('gate') or 'null'}",
        f"gateSince: {gate_since or 'null'}",
        f"shape: {shape or 'null'}",
        f"teamIcon: {team_icon or 'null'}",
        f"priority: {priority or 'null'}",
        f"updated: {now}",
        f"url: {issue.get('url', '')}",
        "refs:",
        f"  branch: {refs.get('branch') or 'null'}",
        f"  pr: {refs.get('pr') or 'null'}",
        "  artifacts:" + ("" if artifacts else " []"),
        *[f"    - {a}" for a in artifacts],
        "---",
    ]
    decision = issue.get("decision") or ""
    body = [
        "",
        "## Summary",
        issue.get("summary") or f"{issue.get('title', '')} — {issue.get('statusName', '?')} ({issue.get('team', '?')}).",
        "",
        "## Decision needed",
        decision if decision else "<!-- none pending -->",
        "",
        "## Your reply",
        reply if reply else REPLY_PLACEHOLDER.rstrip("\n"),
        "",
        "## Log",
        log if log else f"- {now} projected from ledger",
        "",
    ]
    return "\n".join(fm + body)


SNAPSHOT = HUB / "var" / "board-snapshot.json"


def set_mode(argv) -> int:
    ident = argv[0]
    snap = json.loads(SNAPSHOT.read_text()) if SNAPSHOT.exists() else []
    entry = next((i for i in snap if i["identifier"] == ident), None)
    if entry is None:
        entry = {"identifier": ident}
        snap.append(entry)
    for kv in argv[1:]:
        key, _, val = kv.partition("=")
        parsed = None if val in ("null", "None") else (val.lower() == "true" if val.lower() in ("true", "false") else val)
        obj = entry
        parts = key.split(".")
        for p in parts[:-1]:
            obj = obj.setdefault(p, {})
        obj[parts[-1]] = parsed
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(json.dumps(snap, indent=1))
    sys.argv = [sys.argv[0], str(SNAPSHOT)]
    return main()


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__, file=sys.stderr)
        return 0 if argv else 2
    if argv[:1] == ["--set"]:
        return set_mode(argv[1:])
    prune_days = 0
    if "--prune-done-days" in argv:
        i = argv.index("--prune-done-days")
        prune_days = int(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    if "/jobs/" in argv[0] or "/tmp/" in argv[0]:
        print(f"WARN: snapshot {argv[0]} is in ephemeral storage — canonical home is {SNAPSHOT} "
              f"(use --set for incremental updates)", file=sys.stderr)
    snapshot = json.loads(Path(argv[0]).read_text())
    cards_dir = Path(argv[2]) if len(argv) > 2 and argv[1] == "--cards-dir" else HUB / "workbench" / "cards"
    cards_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pruned = []
    if prune_days:
        cutoff = datetime.now(timezone.utc).timestamp() - prune_days * 86400
        in_snapshot = {i["identifier"] for i in snapshot}
        for card in cards_dir.glob("*.md"):
            body = card.read_text()
            if card.stem in in_snapshot or "column: done" not in body:
                continue
            m = re.search(r"^updated: (\S+)", body, re.M)
            try:
                ts = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
            except (AttributeError, ValueError):
                continue
            if ts < cutoff and not is_real_reply(zone_text(body, REPLY_RE)):
                card.unlink()
                pruned.append(card.stem)

    pending_replies, written = [], 0
    for issue in snapshot:
        path = cards_dir / f"{issue['identifier']}.md"
        reply, log, gate_since = "", "", ""
        if path.exists():
            body = path.read_text()
            reply = zone_text(body, REPLY_RE)
            log = zone_text(body, LOG_RE)
            if is_real_reply(reply):
                pending_replies.append(issue["identifier"])
            m_gate = re.search(r"^gate: (.+)$", body, re.M)
            m_since = re.search(r"^gateSince: (.+)$", body, re.M)
            prev_gate = m_gate.group(1) if m_gate else "null"
            prev_since = m_since.group(1) if m_since and m_since.group(1) != "null" else ""
            # same gate persists -> keep its start; new gate -> stamp now
            if issue.get("gate"):
                gate_since = prev_since if prev_gate == issue["gate"] and prev_since else now
        elif issue.get("gate"):
            gate_since = now
        path.write_text(render(issue, reply, log, now, gate_since))
        written += 1

    print(json.dumps({"written": written, "pendingReplies": pending_replies, "pruned": pruned}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
