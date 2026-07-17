"""Build a portable JS asset-pack manifest for ADAY.

Expected source shape:

    pack.json
    icons/<stem>.png
    icons/<stem>.json
    logos/<stem>.png
    layouts/<id>/layout.json
    layouts/<id>/thumb.png

Usage:
    python tools/build_asset_pack.py --source ./packs/default --out web/asset_pack.generated.js
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path


ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
ALLOWED_CATEGORIES = {"structural", "content", "smartart", "image", "custom"}


def data_url(path: Path) -> str:
    mime = "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise SystemExit(f"Missing required file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"{path} must contain a JSON object")
    return data


def require_id(value: str, where: str) -> str:
    if not isinstance(value, str) or not ID_RE.match(value):
        raise SystemExit(f"{where}: id must match {ID_RE.pattern}")
    return value


def require_text(data: dict, key: str, where: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"{where}: required non-empty string field '{key}'")
    return value.strip()


def validate_schema(schema: dict, where: str) -> None:
    if not isinstance(schema, dict):
        raise SystemExit(f"{where}: schema must be an object")
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict):
        raise SystemExit(f"{where}: schema.properties must be an object")
    if not isinstance(required, list) or any(not isinstance(key, str) for key in required):
        raise SystemExit(f"{where}: schema.required must be an array of strings")
    if any(key not in properties for key in required):
        raise SystemExit(f"{where}: every required key must exist in properties")
    if schema.get("additionalProperties", False) is not False:
        raise SystemExit(f"{where}: additionalProperties must be false")
    allowed_types = {"string", "number", "integer", "array", "object", "boolean"}
    for key, field in properties.items():
        if not isinstance(field, dict):
            raise SystemExit(f"{where}.{key}: field schema must be an object")
        declared = field.get("type")
        types = declared if isinstance(declared, list) else [declared]
        if not types or any(value not in allowed_types for value in types):
            raise SystemExit(f"{where}.{key}: unsupported type {declared!r}")
        if "pattern" in field:
            try:
                re.compile(field["pattern"])
            except (TypeError, re.error) as exc:
                raise SystemExit(f"{where}.{key}: invalid pattern: {exc}") from exc
        if "object" in types:
            validate_schema(field, f"{where}.{key}")
        if "array" in types and "items" in field:
            item = field["items"]
            if not isinstance(item, dict):
                raise SystemExit(f"{where}.{key}.items must be an object")
            if item.get("type") == "object":
                validate_schema(item, f"{where}.{key}.items")


def read_icons(root: Path) -> tuple[list[str], dict]:
    icons_dir = root / "icons"
    if not icons_dir.exists():
        return [], {}

    order: list[str] = []
    icons: dict = {}
    for png in sorted(icons_dir.glob("*.png")):
        stem = require_id(png.stem, str(png))
        meta_path = png.with_suffix(".json")
        meta = load_json(meta_path)
        icon_id = require_id(meta.get("id", stem), str(meta_path))
        if icon_id != stem:
            raise SystemExit(f"{meta_path}: id must match PNG stem '{stem}'")
        name = require_text(meta, "name", str(meta_path))
        description = require_text(meta, "description", str(meta_path))
        tags = meta.get("tags", [])
        if tags is None:
            tags = []
        if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
            raise SystemExit(f"{meta_path}: 'tags' must be an array of strings")
        order.append(icon_id)
        icons[icon_id] = {
            "id": icon_id,
            "name": name,
            "description": description,
            "tags": tags,
            "dataUrl": data_url(png),
        }
    return order, icons


def read_logos(root: Path) -> tuple[list[str], dict]:
    logos_dir = root / "logos"
    if not logos_dir.exists():
        return [], {}

    order: list[str] = []
    logos: dict = {}
    for png in sorted(logos_dir.glob("*.png")):
        logo_id = require_id(png.stem, str(png))
        order.append(logo_id)
        logos[logo_id] = {
            "id": logo_id,
            "name": logo_id.replace("_", " ").title(),
            "dataUrl": data_url(png),
        }
    return order, logos


def read_layouts(root: Path) -> tuple[list[str], dict]:
    layouts_dir = root / "layouts"
    if not layouts_dir.exists():
        return [], {}

    order: list[str] = []
    layouts: dict = {}
    for layout_dir in sorted(p for p in layouts_dir.iterdir() if p.is_dir()):
        layout_id = require_id(layout_dir.name, str(layout_dir))
        meta_path = layout_dir / "layout.json"
        meta = load_json(meta_path)
        declared_id = require_id(meta.get("id", layout_id), str(meta_path))
        if declared_id != layout_id:
            raise SystemExit(f"{meta_path}: id must match directory '{layout_id}'")
        name = require_text(meta, "name", str(meta_path))
        description = require_text(meta, "description", str(meta_path))
        category = require_text(meta, "category", str(meta_path))
        if category not in ALLOWED_CATEGORIES:
            raise SystemExit(
                f"{meta_path}: category must be one of {sorted(ALLOWED_CATEGORIES)}"
            )
        schema = meta.get("schema")
        validate_schema(schema, f"{meta_path} schema")
        renderer = meta.get("renderer")
        if not isinstance(renderer, dict):
            raise SystemExit(f"{meta_path}: required object field 'renderer'")
        renderer_type = renderer.get("type")
        if renderer_type not in {"registered", "custom"}:
            raise SystemExit(f"{meta_path}: renderer.type must be 'registered' or 'custom'")
        if renderer_type == "registered":
            renderer_name = require_text(renderer, "name", f"{meta_path} renderer")
            if renderer_name != layout_id:
                raise SystemExit(
                    f"{meta_path}: registered renderer.name must match layout id '{layout_id}'"
                )
        if renderer_type == "custom":
            zones = meta.get("zones")
            if not isinstance(zones, list) or not zones:
                raise SystemExit(f"{meta_path}: custom renderer requires non-empty 'zones'")

        thumb = layout_dir / "thumb.png"
        if not thumb.exists():
            raise SystemExit(f"Missing required thumbnail: {thumb}")

        entry = dict(meta)
        entry.update({
            "id": layout_id,
            "name": name,
            "description": description,
            "category": category,
            "renderer": renderer,
            "schema": schema,
            "thumbDataUrl": data_url(thumb),
        })
        order.append(layout_id)
        layouts[layout_id] = entry
    return order, layouts


def build(source: Path) -> dict:
    pack_meta = load_json(source / "pack.json") if (source / "pack.json").exists() else {}
    icon_order, icons = read_icons(source)
    logo_order, logos = read_logos(source)
    layout_order, layouts = read_layouts(source)
    version = pack_meta.get("version", 2)
    if not isinstance(version, int) or version < 2:
        raise SystemExit("pack.json: version must be an integer >= 2")
    return {
        "version": version,
        "name": pack_meta.get("name", source.name),
        "iconOrder": icon_order,
        "logoOrder": logo_order,
        "layoutOrder": layout_order,
        "icons": icons,
        "logos": logos,
        "layouts": layouts,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="Asset pack folder")
    ap.add_argument("--out", required=True, help="Generated JS output path")
    ap.add_argument("--check", action="store_true",
                    help="Fail if the existing output differs; do not write it")
    args = ap.parse_args()

    source = Path(args.source).resolve()
    out = Path(args.out).resolve()
    if not source.exists():
        raise SystemExit(f"Source folder does not exist: {source}")

    pack = build(source)
    payload = json.dumps(
        pack, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    generated = (
        "// Auto-generated by tools/build_asset_pack.py - do not edit by hand.\n"
        f"window.PPT_ASSET_PACK={payload};\n"
    )
    if args.check:
        if not out.exists() or out.read_text(encoding="utf-8") != generated:
            print(f"Asset pack is missing or stale: {out}", file=sys.stderr)
            return 1
        print(f"Asset pack is up to date: {out}")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(generated, encoding="utf-8", newline="\n")
    print(
        f"Wrote {out} with {len(pack['icons'])} icons, "
        f"{len(pack['logos'])} logos and {len(pack['layouts'])} layouts "
        f"from {source}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
