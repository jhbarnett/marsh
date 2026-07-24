#!/usr/bin/env python3
"""Regression evals for Marsh station prompts.

No prompt amendment ships without a replay: harvest ground truth from
human-approved outcomes, replay the EXACT production prompt template per
case via `claude -p`, and report per-field / per-class accuracy. Put the
before/after diff in the weakness-mining PR body.

Usage:
  eval_station.py harvest-triage [--args evals/triage/raw/triage-args.json]
                                 [--apply evals/triage/raw/apply-plan.json ...]
      → evals/triage/cases.jsonl  (expected = the approved apply outcomes)

  eval_station.py run-triage [--cases evals/triage/cases.jsonl] [--limit N]
                             [--model MODEL] [--template plugins/marsh/prompts/triage-classify.txt]
                             [-o results.json] [--dry]
      --dry renders the first prompt and exits (no API call).
"""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

TAX = {}
try:
    TAX = json.loads(Path("config/taxonomy.json").read_text())
except (OSError, ValueError):
    pass
SHAPE_MAP = TAX.get("labelGroups", {}).get("Scope", {}).get("shapeMap", {})


def opt(argv, name, dflt=None):
    if name in argv:
        i = argv.index(name)
        v = argv[i + 1]
        del argv[i:i + 2]
        return v
    return dflt


def harvest(argv) -> int:
    args_file = Path(opt(argv, "--args", "evals/triage/raw/triage-args.json"))
    apply_files = [Path(a) for a in (argv or ["evals/triage/raw/apply-plan.json"])]
    payload = json.loads(args_file.read_text())
    issues = {i["identifier"]: i for i in payload["issues"]}
    cases = []
    for af in apply_files:
        if not af.exists():
            continue
        for entry in json.loads(af.read_text()):
            ident = entry.get("id")
            if ident not in issues:
                continue
            labels = entry.get("labels") or []
            shape = next((SHAPE_MAP[l] for l in labels if l in SHAPE_MAP),
                         next((l[3:] for l in labels if l.startswith("is-")), None))
            expected = {
                "shape": shape,
                "team": entry.get("team") or issues[ident].get("team"),
                "terminal": "duplicate" if entry.get("duplicateOf") else (
                    "canceled" if entry.get("state") == "Canceled" else None),
            }
            src = issues[ident]
            cases.append({
                "id": ident,
                "input": {k: src.get(k) for k in ("identifier", "title", "description", "labels", "team", "url")},
                "expected": expected,
                "context": {"shapes": payload.get("shapes"), "domains": payload.get("domains"),
                            "teamDomainHints": payload.get("teamDomainHints")},
            })
    out = Path("evals/triage/cases.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(json.dumps(c) for c in cases) + "\n")
    print(json.dumps({"written": str(out), "cases": len(cases)}))
    return 0


def fill(template: str, case: dict, valid_labels) -> str:
    i, ctx = case["input"], case.get("context", {})
    reps = {
        "{{IDENTIFIER}}": i.get("identifier", ""), "{{TEAM}}": i.get("team", ""),
        "{{TITLE}}": i.get("title", ""), "{{URL}}": i.get("url", ""),
        "{{LABELS}}": json.dumps(i.get("labels") or []),
        "{{DESCRIPTION}}": (i.get("description") or "(empty)")[:1500],
        "{{SHAPES}}": ", ".join(ctx.get("shapes") or []),
        "{{DOMAINS}}": ", ".join(ctx.get("domains") or []),
        "{{HINTS}}": json.dumps(ctx.get("teamDomainHints") or {}),
        "{{OPEN_TITLES}}": "(not provided in eval — do not propose duplicates)",
        "{{VALID_LABELS_RULE}}": f"Valid labels — proposedChanges may ONLY add/remove labels from this exact list: {', '.join(valid_labels)}. Never invent labels." if valid_labels else "",
        "{{STATUS_RULES}}": "Proposed statuses are limited to: Triage, Backlog, Icebox. NEVER propose Todo — Todo means committed-to-cycle-plan, which is the human's cycle-planning authority, not triage's. Never remove plan-* labels.",
        "{{GUIDANCE}}": "",
    }
    for k, v in reps.items():
        template = template.replace(k, v)
    return template + '\n\nReturn ONLY a JSON object: {"shape": "...", "team": "...", "domains": [...], "size": "xs|s|m|l|xl", "readiness": {"ready": bool, "gaps": [...]}}'


def run(argv) -> int:
    cases_f = Path(opt(argv, "--cases", "evals/triage/cases.jsonl"))
    limit = int(opt(argv, "--limit", "999"))
    model = opt(argv, "--model", "haiku")
    template = Path(opt(argv, "--template", "plugins/marsh/prompts/triage-classify.txt")).read_text()
    out_f = opt(argv, "-o", None)
    dry = "--dry" in argv
    valid_labels = []
    for g in TAX.get("labelGroups", {}).values():
        valid_labels += list(g.get("shapeMap", {}).keys()) + list(g.get("map", {}).keys()) + g.get("labels", [])
    cases = [json.loads(l) for l in cases_f.read_text().splitlines() if l.strip()][:limit]
    if dry:
        print(fill(template, cases[0], valid_labels))
        return 0
    results, shape_conf = [], Counter()
    hit = {"shape": 0, "team": 0}
    scored = 0
    for c in cases:
        prompt = fill(template, c, valid_labels)
        try:
            r = subprocess.run(["claude", "-p", prompt, "--model", model, "--output-format", "json"],
                               capture_output=True, text=True, timeout=180)
            text = json.loads(r.stdout).get("result", "")
            m = re.search(r"\{[\s\S]*\}", text)
            got = json.loads(m.group(0)) if m else {}
        except Exception as e:  # noqa: BLE001 — a failed case scores as a miss, run continues
            got = {"error": str(e)[:120]}
        exp = c["expected"]
        row = {"id": c["id"], "got": {k: got.get(k) for k in ("shape", "team")}, "expected": exp}
        if exp.get("shape"):
            scored += 1
            ok = got.get("shape") == exp["shape"]
            hit["shape"] += ok
            shape_conf[f"{exp['shape']}→{got.get('shape')}"] += 0 if ok else 1
        if exp.get("team"):
            hit["team"] += got.get("team") == exp["team"]
        results.append(row)
        print(f"{c['id']}: shape {got.get('shape')} vs {exp.get('shape')} | team {got.get('team')} vs {exp.get('team')}", file=sys.stderr)
    summary = {
        "cases": len(cases), "shapeScored": scored,
        "shapeAccuracy": round(hit["shape"] / max(1, scored), 3),
        "teamAccuracy": round(hit["team"] / max(1, len(cases)), 3),
        "topConfusions": shape_conf.most_common(6),
        "model": model,
    }
    if out_f:
        Path(out_f).write_text(json.dumps({"summary": summary, "results": results}, indent=1))
    print(json.dumps(summary))
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if argv[:1] == ["harvest-triage"]:
        return harvest(argv[1:])
    if argv[:1] == ["run-triage"]:
        return run(argv[1:])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
