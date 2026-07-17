"""Generate the file:// compatible repository constraints artifact."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def render(source: Path) -> str:
    value = json.loads(source.read_text(encoding="utf-8"))
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return (
        "// Generated from config/repository_constraints.json. Run `npm run build:constraints`.\n"
        "window.PPTGen = window.PPTGen || {};\n"
        f"window.PPTGen.constraints = {compact};\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render(args.source)
    if args.check:
        if not args.out.is_file() or args.out.read_text(encoding="utf-8") != expected:
            raise SystemExit(f"Constraints artifact is missing or stale: {args.out.resolve()}")
        print(f"Constraints artifact is up to date: {args.out.resolve()}")
        return
    args.out.write_text(expected, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
