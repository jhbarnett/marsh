#!/usr/bin/env python3
"""Render a triage-sweep digest deterministically from the workflow payload + results.

Usage: render_digest.py <payload.json> <results.json> [-o digest.md]

payload.json = the args passed to triage-sweep.js ({"issues":[...], ...})
results.json = the workflow return ({"proposals":[...], "crosscheck":{...}, "swept":N})

Integrity guard: every issue in the payload MUST be accounted for. Issues with
no proposal are listed in a loud UNCLASSIFIED section — silent drops from the
approval artifact are the failure class this script exists to kill.
"""
import json
import sys
from collections import Counter
from pathlib import Path


def main() -> int:
    argv = sys.argv[1:]
    out = None
    if "-o" in argv:
        i = argv.index("-o")
        out = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    payload = json.loads(Path(argv[0]).read_text())
    results = json.loads(Path(argv[1]).read_text())

    issues = {i["identifier"]: i for i in payload.get("issues", [])}
    proposals = {p["identifier"]: p for p in (results.get("proposals") or []) if p}
    cross = results.get("crosscheck") or {}
    unclassified = sorted(set(issues) - set(proposals))
    orphans = sorted(set(proposals) - set(issues))

    lines = ["# Triage sweep digest", ""]
    lines.append(
        f"**Integrity:** {len(issues)} swept · {len(proposals)} classified · "
        f"{len(unclassified)} UNCLASSIFIED · {len(orphans)} orphan proposals"
    )
    if unclassified:
        lines += ["", "## ⚠️ UNCLASSIFIED — swept but no proposal (re-run these before approving)", ""]
        lines += [f"- {ident}: {issues[ident].get('title', '?')}" for ident in unclassified]
    if orphans:
        lines += ["", f"## ⚠️ Orphan proposals (not in payload): {', '.join(orphans)}"]

    shapes = Counter(p.get("shape", "?") for p in proposals.values())
    teams = Counter(p.get("team", "?") for p in proposals.values())
    lines += ["", "## Summary", ""]
    lines.append("Shapes: " + ", ".join(f"{k}={v}" for k, v in shapes.most_common()))
    lines.append("Routing: " + ", ".join(f"{k}={v}" for k, v in teams.most_common()))

    lines += ["", "## Proposals", ""]
    for ident in sorted(proposals):
        p = proposals[ident]
        issue = issues.get(ident, {})
        r = p.get("readiness", {})
        lines.append(f"### {ident} — {issue.get('title', '?')}")
        lines.append(
            f"- shape `{p.get('shape')}` · domains {p.get('domains')} · team **{p.get('team')}**"
            f" · size {p.get('size')}"
            + (f" · risk {p['riskClasses']}" if p.get("riskClasses") else "")
        )
        lines.append(f"- ready: {r.get('ready')}" + (f" · gaps: {'; '.join(r.get('gaps', []))}" if r.get("gaps") else ""))
        if p.get("suspectedDuplicates"):
            lines.append(f"- suspected duplicates: {', '.join(p['suspectedDuplicates'])}")
        lines.append(f"- changes: {'; '.join(p.get('proposedChanges', [])) or '(none)'}")
        lines.append(f"- why: {p.get('rationale', '')}")
        lines.append("")

    if cross.get("conflicts") or cross.get("duplicateClusters"):
        lines += ["## Cross-check", ""]
        for c in cross.get("conflicts", []):
            lines.append(f"- conflict: {c}")
        for cluster in cross.get("duplicateClusters", []):
            lines.append(f"- duplicate cluster: {', '.join(cluster)}")

    text = "\n".join(lines) + "\n"
    if out:
        out.write_text(text)
        print(json.dumps({"written": str(out), "classified": len(proposals), "unclassified": unclassified}))
    else:
        print(text)
    return 1 if unclassified else 0


if __name__ == "__main__":
    sys.exit(main())
