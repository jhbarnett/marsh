#!/usr/bin/env python3
"""Project a ledger snapshot into workbench cards.

Usage: project_cards.py <snapshot.json> [--cards-dir workbench/cards]

The snapshot is produced by a Marsh command from Linear state:
  [{"identifier","title","team","statusName","statusType","url","labels":[],
    "updatedAt","blocked":false,"lane":null,"gate":null,"summary":"",
    "decision":"","refs":{"branch":null,"pr":null,"artifacts":[]}}, ...]

Cards are projections: everything is regenerated EXCEPT the human-owned
"## Your reply" zone and the existing "## Log" body, which are preserved.
Unconsumed replies are reported on stdout so the caller can act on them.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPLY_RE = re.compile(r"^## Your reply\n(.*?)(?=^## |\Z)", re.M | re.S)
LOG_RE = re.compile(r"^## Log\n(.*?)(?=^## |\Z)", re.M | re.S)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

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


def render(issue: dict, reply: str, log: str, now: str) -> str:
    refs = issue.get("refs") or {}
    artifacts = refs.get("artifacts") or []
    fm = [
        "---",
        f"issue: {issue['identifier']}",
        f"title: {json.dumps(issue.get('title', ''))}",
        f"lane: {lane_for(issue)}",
        f"column: {column_for(issue)}",
        f"gate: {issue.get('gate') or 'null'}",
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


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    snapshot = json.loads(Path(sys.argv[1]).read_text())
    cards_dir = Path(sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--cards-dir" else "workbench/cards")
    cards_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pending_replies, written = [], 0
    for issue in snapshot:
        path = cards_dir / f"{issue['identifier']}.md"
        reply, log = "", ""
        if path.exists():
            body = path.read_text()
            reply = zone_text(body, REPLY_RE)
            log = zone_text(body, LOG_RE)
            if is_real_reply(reply):
                pending_replies.append(issue["identifier"])
        path.write_text(render(issue, reply, log, now))
        written += 1

    print(json.dumps({"written": written, "pendingReplies": pending_replies}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
