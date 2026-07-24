#!/usr/bin/env python3
"""Extract the operator's terminal theme into workbench/theme.json.

Currently supports Ghostty (config `theme = dark:Name,light:Name` or a single
name; theme files from ~/.config/ghostty/themes/ or the app bundle). Falls
back to a default dark palette. The dashboard and ttyd both consume the
output, so the whole cockpit matches the terminal.

Usage: theme_sync.py [-o workbench/theme.json] [--ttyd dark|light]
  --ttyd prints an xterm.js ITheme JSON (for `ttyd -t theme=...`) and exits.
"""
import json
import re
import sys
from pathlib import Path

GHOSTTY_CONFIG = Path.home() / ".config/ghostty/config"
THEME_DIRS = [
    Path.home() / ".config/ghostty/themes",
    Path("/Applications/Ghostty.app/Contents/Resources/ghostty/themes"),
]
DEFAULT = {
    "background": "#111111", "foreground": "#dddddd", "cursor": "#dddddd",
    "selectionBg": "#333333",
    "palette": ["#111111", "#cc6666", "#4a6", "#f0c674", "#8ab4f8", "#b294bb", "#8abeb7", "#c5c8c6",
                 "#666666", "#d54e53", "#b9ca4a", "#e7c547", "#7aa6da", "#c397d8", "#70c0b1", "#eaeaea"],
}


def parse_theme_file(path: Path) -> dict:
    theme = {"palette": list(DEFAULT["palette"])}
    for line in path.read_text().splitlines():
        line = line.strip()
        m = re.match(r"^palette\s*=\s*(\d+)=(#?[0-9a-fA-F]{6})", line)
        if m:
            i = int(m.group(1))
            if 0 <= i < 16:
                theme["palette"][i] = "#" + m.group(2).lstrip("#")
            continue
        m = re.match(r"^([\w-]+)\s*=\s*(#?[0-9a-fA-F]{6})$", line)
        if m:
            key, val = m.group(1), "#" + m.group(2).lstrip("#")
            theme[{"background": "background", "foreground": "foreground",
                   "cursor-color": "cursor", "selection-background": "selectionBg"}.get(key, key)] = val
    for k, v in DEFAULT.items():
        theme.setdefault(k, v)
    return theme


def find_theme_file(name: str):
    for d in THEME_DIRS:
        p = d / name
        if p.exists():
            return p
    return None


def ghostty_themes() -> dict:
    out = {}
    if not GHOSTTY_CONFIG.exists():
        return out
    for line in GHOSTTY_CONFIG.read_text().splitlines():
        m = re.match(r"^\s*theme\s*=\s*(.+)$", line)
        if not m:
            continue
        spec = m.group(1).strip()
        if ":" in spec and ("dark:" in spec or "light:" in spec):
            for part in spec.split(","):
                mode, _, name = part.strip().partition(":")
                f = find_theme_file(name.strip())
                if f:
                    out[mode] = parse_theme_file(f)
        else:
            f = find_theme_file(spec)
            if f:
                out["dark"] = out["light"] = parse_theme_file(f)
    return out


def main() -> int:
    argv = sys.argv[1:]
    out_path = Path("workbench/theme.json")
    if "-o" in argv:
        i = argv.index("-o")
        out_path = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    themes = ghostty_themes()
    result = {
        "source": "ghostty" if themes else "default",
        "dark": themes.get("dark", DEFAULT),
        "light": themes.get("light", themes.get("dark", DEFAULT)),
    }
    if "--ttyd" in argv:
        mode = argv[argv.index("--ttyd") + 1]
        t = result[mode]
        p = t["palette"]
        names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
                 "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
                 "brightMagenta", "brightCyan", "brightWhite"]
        itheme = {"background": t["background"], "foreground": t["foreground"],
                  "cursor": t["cursor"], **dict(zip(names, p))}
        print(json.dumps(itheme))
        return 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=1))
    print(json.dumps({"written": str(out_path), "source": result["source"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
