#!/usr/bin/env python3
"""PTC-style prefetch shaping: turn one batched raw issues dump into compact
per-issue briefs + an open-titles index, so workflow agents receive ~500-token
briefs instead of raw API payloads (and the fetch happens once, in one call).

Usage: build_briefs.py <raw-issues.json> [-o var/briefs.json]
Input: JSON array of Linear issues (any superset of fields).
Output: {"briefs": [...trimmed...], "openTitles": {team: ["ID Title", ...]},
         "stats": {...}} — feed `briefs` to workflow `issues` args and
         `openTitles` straight through.
"""
import json
import sys
from pathlib import Path

KEEP = ("identifier", "title", "team", "url", "status", "priority", "createdAt")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    raw = json.loads(Path(sys.argv[1]).read_text())
    out_path = Path(sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "-o" else "var/briefs.json")
    briefs, titles = [], {}
    raw_chars = len(json.dumps(raw))
    for i in raw:
        b = {k: i.get(k) for k in KEEP if i.get(k) is not None}
        b["labels"] = [l["name"] if isinstance(l, dict) else l for l in (i.get("labels") or [])]
        desc = (i.get("description") or "").strip()
        if desc:
            b["description"] = desc[:1200] + (" …[truncated]" if len(desc) > 1200 else "")
        briefs.append(b)
        titles.setdefault(i.get("team") or "?", []).append(f"{i.get('identifier')} {i.get('title', '')}"[:110])
    out = {"briefs": briefs, "openTitles": titles,
           "stats": {"issues": len(briefs), "rawChars": raw_chars,
                     "briefChars": len(json.dumps(briefs)),
                     "reduction": round(1 - len(json.dumps(briefs)) / max(1, raw_chars), 2)}}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=1))
    print(json.dumps(out["stats"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
