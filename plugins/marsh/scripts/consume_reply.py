#!/usr/bin/env python3
"""Workbench reply-zone surgery. String-scoped: touches only the "Your reply"
zone and the Log section, never Marsh-owned state.

Usage:
  consume_reply.py --list [cards-dir]          # JSON list of pending replies
  consume_reply.py --archive <card.md>         # clear reply zone, append to Log

--archive prints the consumed reply text (the caller acts on it, mirrors to
the ledger, then relies on the Log line as the archive).
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPLY_RE = re.compile(r"(^## Your reply\n)([\s\S]*?)(?=^## )", re.M)
LOG_RE = re.compile(r"(^## Log\n)", re.M)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
PLACEHOLDER = (
    "<!-- YOURS. Write or dictate a decision, changes, or instructions here.\n"
    "     Marsh consumes this zone on its next wake. -->\n\n"
)


def pending(path: Path):
    m = REPLY_RE.search(path.read_text())
    if not m:
        return None
    text = COMMENT_RE.sub("", m.group(2)).strip()
    return text or None


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--list"]:
        cards_dir = Path(args[1] if len(args) > 1 else "workbench/cards")
        out = []
        for f in sorted(cards_dir.glob("*.md")):
            text = pending(f)
            if text:
                out.append({"card": str(f), "issue": f.stem, "reply": text})
        print(json.dumps(out, indent=1))
        return 0
    if args[:1] == ["--archive"] and len(args) == 2:
        path = Path(args[1])
        body = path.read_text()
        m = REPLY_RE.search(body)
        text = COMMENT_RE.sub("", m.group(2)).strip() if m else ""
        if not text:
            print(json.dumps({"error": "no pending reply"}))
            return 1
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = REPLY_RE.sub(lambda mm: mm.group(1) + PLACEHOLDER, body, count=1)
        excerpt = " ".join(text.split())[:120]
        body = LOG_RE.sub(lambda mm: mm.group(1) + f"- {now} reply consumed: {excerpt}\n", body, count=1)
        path.write_text(body)
        print(json.dumps({"issue": path.stem, "reply": text}))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
