"""Local application server, repository JSON store, and optional LLM proxy."""

from __future__ import annotations

import argparse
import asyncio
import ast
import base64
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import struct
import tempfile
from threading import Timer
from urllib.parse import urlparse
import webbrowser

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask


ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = ROOT / "web"
DATA_ROOT = Path(os.getenv("PPTGEN_DATA_DIR", ROOT / "customs")).resolve()
CONSTRAINTS = json.loads((ROOT / "config" / "repository_constraints.json").read_text(encoding="utf-8"))
MAX_JSON_BYTES = CONSTRAINTS["maxJsonBytes"]
MAX_PROXY_BYTES = CONSTRAINTS["maxProxyBytes"]
MAX_STORE_BYTES = CONSTRAINTS["maxStoreBytes"]
MAX_IMAGE_SIDE = CONSTRAINTS["maxImageSide"]
MAX_IMAGE_PIXELS = CONSTRAINTS["maxImagePixels"]
LLM_BASE = os.getenv("LLM_BASE", "http://localhost:8080").rstrip("/")
# Cloud deployment: when PPTGEN_LLM_API_KEY is set, the /v1/* proxy swaps
# the incoming Authorization for that key whenever the browser presents
# PPTGEN_PROXY_TOKEN (the UI "API Key" field) — the key never leaves the
# server. Any other Authorization is forwarded untouched, so visitors can
# also bring their own provider API key.
LLM_API_KEY = os.getenv("PPTGEN_LLM_API_KEY", "")
PROXY_TOKEN = os.getenv("PPTGEN_PROXY_TOKEN", "")

COLLECTIONS = {
    "layouts": "layouts",
    "icons": "icons",
    "photos": "photos",
    "history": "history",
}
COLLECTION_CAPS = CONSTRAINTS["collectionCaps"]
DOCUMENTS = {"settings": "settings.json", "gallery": "gallery.json"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
CUSTOM_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
IMAGE_RE = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$")
ZONE_TYPES = {"title", "subtitle", "text", "text_block", "bullets", "kpi", "image"}
CATEGORIES = set(CONSTRAINTS["categories"])
ALIGNS = {"left", "center", "right"}
ANALYSIS_STATUSES = set(CONSTRAINTS["analysisStatuses"])
LOCAL_CONFIG_LIMITS = {"baseUrl": 2048, "model": 200, "visionModel": 200, "apiKey": 4096}
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]


def _same_origin_host(origin: str | None, host: str) -> bool:
    if not origin:
        return True
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    return parsed.netloc.lower() == host.lower()


class BodyTooLarge(ValueError):
    pass


class StoreCapacityError(OSError):
    pass


def _record(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("objet JSON attendu")
    return value


def _only(value: dict, allowed: set[str]) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"champ(s) inconnu(s) : {', '.join(sorted(unknown))}")


def _string(value: object, name: str, maximum: int, *, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    result = value.strip()
    if (required and not result) or len(value) > maximum:
        raise ValueError(f"{name} invalide")
    return value


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    offset = 2
    while offset + 9 < len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if offset + 2 > len(data):
            break
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            return int.from_bytes(data[offset + 5:offset + 7], "big"), int.from_bytes(data[offset + 3:offset + 5], "big")
        offset += length
    return None


def _image_dimensions(mime: str, data: bytes) -> tuple[int, int] | None:
    if mime == "png" and data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if mime == "gif" and data[:6] in {b"GIF87a", b"GIF89a"} and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if mime == "jpeg" and data.startswith(b"\xff\xd8\xff"):
        return _jpeg_dimensions(data)
    if mime == "webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP" and len(data) >= 30:
        kind = data[12:16]
        if kind == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if kind == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
            return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
        if kind == b"VP8L" and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def _data_url(value: object, maximum: int = 4 * 1024 * 1024) -> str:
    if not isinstance(value, str):
        raise ValueError("Data URL image attendue")
    match = IMAGE_RE.fullmatch(value)
    if not match or len(match.group(2)) % 4:
        raise ValueError("Data URL image invalide")
    try:
        decoded = base64.b64decode(match.group(2), validate=True)
    except Exception as error:
        raise ValueError("base64 image invalide") from error
    if not decoded or len(decoded) > maximum:
        raise ValueError("image vide ou trop volumineuse")
    dimensions = _image_dimensions(match.group(1), decoded)
    if not dimensions:
        raise ValueError("signature ou format d'image invalide")
    width, height = dimensions
    if width < 1 or height < 1 or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
        raise ValueError("dimensions d'image hors limites")
    return value


def _validate_analysis(value: object, *, classification: bool) -> None:
    analysis = _record(value)
    allowed = {"descriptionStatus", "updatedAt", "errorCode", "errorMessage"}
    if classification:
        allowed.add("classificationStatus")
    _only(analysis, allowed)
    for key in ("descriptionStatus", "classificationStatus"):
        if key in analysis and analysis[key] not in ANALYSIS_STATUSES:
            raise ValueError(f"{key} invalide")
    if "updatedAt" in analysis:
        _string(analysis["updatedAt"], "updatedAt", 64)
    if "errorCode" in analysis:
        code = _string(analysis["errorCode"], "errorCode", 40)
        if code and not re.fullmatch(r"[a-z0-9_-]{1,40}", code):
            raise ValueError("errorCode invalide")
    if "errorMessage" in analysis:
        _string(analysis["errorMessage"], "errorMessage", 500)


def _percent(value: object, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    number = float(value)
    if number < 0 or number > 100 or (positive and number == 0):
        raise ValueError(f"{name} hors limites")
    return value


def _validate_style(value: object) -> None:
    style = _record(value)
    _only(style, {"fontSize", "color", "fontFace", "bold", "italic", "align"})
    if "fontSize" in style and (isinstance(style["fontSize"], bool) or not isinstance(style["fontSize"], (int, float))):
        raise ValueError("fontSize invalide")
    for key, maximum in (("color", 32), ("fontFace", 80)):
        if key in style:
            _string(style[key], key, maximum)
    for key in ("bold", "italic"):
        if key in style and not isinstance(style[key], bool):
            raise ValueError(f"{key} must be a boolean")
    if "align" in style and style["align"] not in ALIGNS:
        raise ValueError("align invalide")


def _validate_zone(value: object) -> None:
    zone = _record(value)
    _only(zone, {"id", "label", "type", "x_pct", "y_pct", "w_pct", "h_pct", "align", "color", "style"})
    _string(zone.get("label"), "label", 80, required=True)
    if zone.get("type") not in ZONE_TYPES:
        raise ValueError("type de zone invalide")
    for key in ("x_pct", "y_pct"):
        _percent(zone.get(key), key)
    for key in ("w_pct", "h_pct"):
        _percent(zone.get(key), key, positive=True)
    if "id" in zone and not re.fullmatch(r"z[A-Za-z0-9_-]*", str(zone["id"])):
        raise ValueError("id de zone invalide")
    if "align" in zone and zone["align"] not in ALIGNS:
        raise ValueError("align de zone invalide")
    if "color" in zone:
        _string(zone["color"], "color", 32)
    if "style" in zone:
        _validate_style(zone["style"])


def _validate_background_shape(value: object) -> None:
    shape = _record(value)
    _only(shape, {"kind", "x_pct", "y_pct", "w_pct", "h_pct", "dataUrl", "fill", "color", "fontFace", "text", "fontSize", "bold", "italic", "align"})
    if shape.get("kind") not in {"image", "shape", "oval", "text"}:
        raise ValueError("forme de fond invalide")
    for key in ("x_pct", "y_pct"):
        _percent(shape.get(key), key)
    for key in ("w_pct", "h_pct"):
        _percent(shape.get(key), key, positive=True)
    if shape["kind"] == "image":
        _data_url(shape.get("dataUrl"))
    elif "dataUrl" in shape:
        raise ValueError("dataUrl interdit pour cette forme")
    for key, maximum in (("fill", 32), ("color", 32), ("fontFace", 80), ("text", 5000)):
        if key in shape:
            _string(shape[key], key, maximum)
    if "align" in shape and shape["align"] not in ALIGNS:
        raise ValueError("align invalide")
    for key in ("bold", "italic"):
        if key in shape and not isinstance(shape[key], bool):
            raise ValueError(f"{key} must be a boolean")


def validate_layout(value: object, identifier: str) -> dict:
    item = _record(value)
    _only(item, {"id", "name", "description", "category", "structural_role", "source", "createdAt", "imageDataUrl", "thumbnailDataUrl", "background", "zones", "analysis"})
    if item.get("id") != identifier or not CUSTOM_ID_RE.fullmatch(identifier):
        raise ValueError("id de layout invalide")
    _string(item.get("name"), "name", 200, required=True)
    _string(item.get("description"), "description", 2000)
    if item.get("category", "custom") not in CATEGORIES:
        raise ValueError("invalid category")
    if item.get("category", "custom") == "structural" and item.get("structural_role") not in {"title", "closing"}:
        raise ValueError("structural role required")
    if item.get("category", "custom") != "structural" and "structural_role" in item:
        raise ValueError("structural role not allowed")
    if "structural_role" in item and item["structural_role"] not in {"title", "closing"}:
        raise ValueError("invalid structural role")
    if "source" in item and item["source"] != "pptx":
        raise ValueError("source invalide")
    _string(item.get("createdAt"), "createdAt", 64)
    zones = item.get("zones")
    if not isinstance(zones, list) or len(zones) > 64:
        raise ValueError("zones invalides")
    for zone in zones:
        _validate_zone(zone)
    for key in ("imageDataUrl", "thumbnailDataUrl"):
        if key in item:
            _data_url(item[key])
    if "background" in item:
        background = _record(item["background"])
        _only(background, {"shapes"})
        shapes = background.get("shapes")
        if not isinstance(shapes, list) or len(shapes) > 500:
            raise ValueError("formes de fond invalides")
        for shape in shapes:
            _validate_background_shape(shape)
    if "analysis" in item:
        _validate_analysis(item["analysis"], classification=True)
    return item


def validate_icon(value: object, identifier: str) -> dict:
    item = _record(value)
    _only(item, {"id", "name", "description", "dataUrl", "addedAt", "analysis"})
    if item.get("id") != identifier or not CUSTOM_ID_RE.fullmatch(identifier):
        raise ValueError("invalid icon id")
    _string(item.get("name"), "name", 200, required=True)
    _string(item.get("description"), "description", 1000)
    _string(item.get("addedAt"), "addedAt", 64)
    _data_url(item.get("dataUrl"))
    if "analysis" in item:
        _validate_analysis(item["analysis"], classification=False)
    return item


def validate_photo(value: object, identifier: str) -> dict:
    item = _record(value)
    _only(item, {"id", "name", "description", "dataUrl", "addedAt"})
    if item.get("id") != identifier or not ID_RE.fullmatch(identifier):
        raise ValueError("id de photo invalide")
    _string(item.get("name"), "name", 300, required=True)
    _string(item.get("description", ""), "description", 5000)
    _string(item.get("addedAt", ""), "addedAt", 64)
    _data_url(item.get("dataUrl"), 8 * 1024 * 1024)
    return item


def validate_history(value: object, identifier: str) -> dict:
    item = _record(value)
    _only(item, {"id", "savedAt", "topic", "slideCount", "plan", "display", "warnings"})
    if item.get("id") != identifier or not ID_RE.fullmatch(identifier):
        raise ValueError("id d’historique invalide")
    _string(item.get("savedAt", ""), "savedAt", 64)
    _string(item.get("topic"), "topic", 500, required=True)
    plan = item.get("plan")
    if not isinstance(plan, list) or not plan or len(plan) > 100:
        raise ValueError("plan invalide")
    if item.get("slideCount") != len(plan):
        raise ValueError("inconsistent slideCount")
    _string(item.get("display", ""), "display", 1024 * 1024)
    warnings = item.get("warnings", [])
    if not isinstance(warnings, list) or len(warnings) > 100 or any(not isinstance(v, str) or len(v) > 2000 for v in warnings):
        raise ValueError("warnings invalides")
    return item


def validate_settings(value: object) -> dict:
    item = _record(value)
    _only(item, {"baseUrl", "model", "visionModel", "rememberKey", "debugLogs", "confirmedProviderHost"})
    for key, maximum in (("baseUrl", 2048), ("model", 200), ("visionModel", 200), ("confirmedProviderHost", 255)):
        if key in item:
            _string(item[key], key, maximum)
    for key in ("rememberKey", "debugLogs"):
        if key in item and not isinstance(item[key], bool):
            raise ValueError(f"{key} must be a boolean")
    return item


def validate_gallery(value: object) -> dict:
    item = _record(value)
    _only(item, {"disabledIcons", "disabledLayouts"})
    for key in ("disabledIcons", "disabledLayouts"):
        values = item.get(key, [])
        if not isinstance(values, list) or len(values) > 500:
            raise ValueError(f"{key} invalide")
        if any(not isinstance(entry, str) or not re.fullmatch(r"(?:custom:)?[a-z0-9_]{1,64}", entry) for entry in values):
            raise ValueError(f"{key} contient un id invalide")
    return item


VALIDATORS = {
    "layouts": validate_layout,
    "icons": validate_icon,
    "photos": validate_photo,
    "history": validate_history,
}
DOCUMENT_VALIDATORS = {"settings": validate_settings, "gallery": validate_gallery}


class RepositoryStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.lock = asyncio.Lock()

    def _collection_path(self, collection: str, identifier: str) -> Path:
        if collection not in COLLECTIONS or not ID_RE.fullmatch(identifier):
            raise ValueError("collection ou id invalide")
        path = (self.root / COLLECTIONS[collection] / f"{identifier}.json").resolve()
        if self.root not in path.parents:
            raise ValueError("chemin interdit")
        return path

    def _document_path(self, name: str) -> Path:
        if name not in DOCUMENTS:
            raise ValueError("document invalide")
        return (self.root / DOCUMENTS[name]).resolve()

    @staticmethod
    def _decode(raw: bytes) -> object:
        if len(raw) > MAX_JSON_BYTES:
            raise ValueError("JSON larger than 4 MiB")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON invalide") from error

    @staticmethod
    def _encode(value: object) -> bytes:
        raw = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        if len(raw) > MAX_JSON_BYTES:
            raise ValueError("JSON larger than 4 MiB")
        return raw

    @staticmethod
    def _atomic_write(path: Path, raw: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _store_size(self, *, replacing: Path | None = None) -> int:
        total = 0
        if not self.root.exists():
            return 0
        for path in self.root.rglob("*.json"):
            if replacing is not None and path.resolve() == replacing.resolve():
                continue
            try:
                total += path.stat().st_size
            except OSError:
                continue
            if total > MAX_STORE_BYTES:
                break
        return total

    def _check_capacity(self, collection: str, path: Path, raw: bytes) -> None:
        folder = path.parent
        if not path.exists() and folder.exists():
            count = sum(1 for candidate in folder.glob("*.json") if candidate.is_file())
            if count >= COLLECTION_CAPS[collection]:
                raise StoreCapacityError(f"{collection} capacity reached ({COLLECTION_CAPS[collection]})")
        if self._store_size(replacing=path) + len(raw) > MAX_STORE_BYTES:
            raise StoreCapacityError("total store capacity reached (128 MiB)")

    def state(self) -> dict:
        result: dict[str, object] = {name: [] for name in COLLECTIONS}
        result.update({"settings": {}, "gallery": {}, "warnings": []})
        for collection, directory in COLLECTIONS.items():
            folder = self.root / directory
            if not folder.exists():
                continue
            paths = sorted(folder.glob("*.json"), key=lambda item: item.name)
            if len(paths) > COLLECTION_CAPS[collection]:
                result["warnings"].append(f"{directory} exceeds the capacity of {COLLECTION_CAPS[collection]} entries")
                paths = paths[:COLLECTION_CAPS[collection]]
            for path in paths:
                try:
                    value = self._decode(path.read_bytes())
                    identifier = path.stem
                    normalized = VALIDATORS[collection](value, identifier)
                    result[collection].append(normalized)
                except (OSError, ValueError) as error:
                    if len(result["warnings"]) < 100:
                        result["warnings"].append(f"{path.relative_to(self.root)} skipped: {error}")
        for name, filename in DOCUMENTS.items():
            path = self.root / filename
            if not path.exists():
                continue
            try:
                value = self._decode(path.read_bytes())
                result[name] = DOCUMENT_VALIDATORS[name](value)
            except (OSError, ValueError) as error:
                if len(result["warnings"]) < 100:
                    result["warnings"].append(f"{filename} skipped: {error}")
        return result

    async def put(self, collection: str, identifier: str, value: object) -> dict:
        validator = VALIDATORS.get(collection)
        if not validator:
            raise ValueError("collection invalide")
        normalized = validator(value, identifier)
        raw = self._encode(normalized)
        path = self._collection_path(collection, identifier)
        async with self.lock:
            await asyncio.to_thread(self._check_capacity, collection, path, raw)
            await asyncio.to_thread(self._atomic_write, path, raw)
        return normalized

    async def delete(self, collection: str, identifier: str) -> None:
        path = self._collection_path(collection, identifier)
        async with self.lock:
            try:
                await asyncio.to_thread(path.unlink)
            except FileNotFoundError:
                pass

    async def put_document(self, name: str, value: object) -> dict:
        validator = DOCUMENT_VALIDATORS.get(name)
        if not validator:
            raise ValueError("document invalide")
        normalized = validator(value)
        raw = self._encode(normalized)
        path = self._document_path(name)
        async with self.lock:
            current_size = await asyncio.to_thread(self._store_size, replacing=path)
            if current_size + len(raw) > MAX_STORE_BYTES:
                raise StoreCapacityError("total store capacity reached (128 MiB)")
            await asyncio.to_thread(self._atomic_write, path, raw)
        return normalized


store = RepositoryStore(DATA_ROOT)


def local_config_path() -> Path:
    return Path(os.getenv("PPTGEN_LOCAL_CONFIG", ROOT / "config" / "config.local.js")).resolve()


def read_local_config() -> dict:
    path = local_config_path()
    if not path.is_file():
        return {}
    try:
        source = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    result = {}
    for key, maximum in LOCAL_CONFIG_LIMITS.items():
        match = re.search(rf"\b{key}\s*:\s*(?P<value>\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*')", source)
        if not match:
            continue
        try:
            value = ast.literal_eval(match.group("value"))
        except (SyntaxError, ValueError):
            continue
        if isinstance(value, str) and len(value) <= maximum:
            result[key] = value
    return result


def normalize_local_config(value: object) -> dict:
    item = _record(value)
    _only(item, set(LOCAL_CONFIG_LIMITS))
    normalized = {}
    for key, maximum in LOCAL_CONFIG_LIMITS.items():
        if key not in item:
            normalized[key] = ""
            continue
        result = _string(item[key], key, maximum)
        normalized[key] = result or ""
    return normalized


def write_local_config(value: object) -> dict:
    config = normalize_local_config(value)
    lines = [
        "// Auto-generated by ADAY local server.",
        "// Contains local secrets. Do not commit this file.",
        "window.LLM_CONFIG_DEFAULTS = {",
    ]
    for key in ("baseUrl", "model", "visionModel", "apiKey"):
        lines.append(f"  {key}: {json.dumps(config[key], ensure_ascii=False)},")
    lines.extend(["};", ""])
    RepositoryStore._atomic_write(local_config_path(), "\n".join(lines).encode("utf-8"))
    return {"ok": True, "hasApiKey": bool(config["apiKey"])}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0))
    try:
        yield
    finally:
        await app.state.client.aclose()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=ALLOWED_HOSTS,
)


@app.middleware("http")
async def secure_local_requests(request: Request, call_next):
    if request.url.path.startswith(("/api/", "/v1/")) or request.url.path == "/api/state":
        origin = request.headers.get("origin")
        host = request.headers.get("host", "")
        if not _same_origin_host(origin, host):
            return JSONResponse({"detail": "origine interdite"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self' data: blob:; script-src 'self'; style-src 'self'; "
        "style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src http: https:; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    )
    return response


async def _limited_body(request: Request, maximum: int) -> bytes:
    length = request.headers.get("content-length")
    if length:
        try:
            declared = int(length)
        except ValueError as error:
            raise ValueError("Content-Length invalide") from error
        if declared > maximum:
            raise BodyTooLarge(f"body larger than {maximum // (1024 * 1024)} MiB")
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > maximum:
            raise BodyTooLarge(f"body larger than {maximum // (1024 * 1024)} MiB")
        chunks.append(chunk)
    return b"".join(chunks)


async def _json_body(request: Request) -> object:
    raw = await _limited_body(request, MAX_JSON_BYTES)
    return store._decode(raw)


@app.get("/api/state")
async def get_state():
    return await asyncio.to_thread(store.state)


@app.get("/api/local-config")
async def get_local_config():
    return await asyncio.to_thread(read_local_config)


@app.put("/api/local-config")
async def put_local_config(request: Request):
    try:
        value = await _json_body(request)
        return await asyncio.to_thread(write_local_config, value)
    except BodyTooLarge as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        raise HTTPException(507, f"write failed: {error}") from error


@app.put("/api/{collection}/{identifier}")
async def put_entry(collection: str, identifier: str, request: Request):
    if collection not in COLLECTIONS:
        raise HTTPException(404, "collection inconnue")
    try:
        value = await _json_body(request)
        return await store.put(collection, identifier, value)
    except BodyTooLarge as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        raise HTTPException(507, f"write failed: {error}") from error


@app.delete("/api/{collection}/{identifier}", status_code=204)
async def delete_entry(collection: str, identifier: str):
    if collection not in COLLECTIONS:
        raise HTTPException(404, "collection inconnue")
    try:
        await store.delete(collection, identifier)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        raise HTTPException(507, f"suppression impossible : {error}") from error


@app.put("/api/{document}")
async def put_document(document: str, request: Request):
    if document not in DOCUMENTS:
        raise HTTPException(404, "document inconnu")
    try:
        value = await _json_body(request)
        return await store.put_document(document, value)
    except BodyTooLarge as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        raise HTTPException(507, f"write failed: {error}") from error


@app.post("/v1/{path:path}")
async def proxy(path: str, request: Request):
    try:
        content = await _limited_body(request, MAX_PROXY_BYTES)
    except BodyTooLarge as error:
        raise HTTPException(413, str(error)) from error
    headers = {
        "content-type": request.headers.get("content-type", "application/json"),
        "accept": request.headers.get("accept", "application/json"),
    }
    authorization = request.headers.get("authorization")
    if LLM_API_KEY and PROXY_TOKEN and authorization == f"Bearer {PROXY_TOKEN}":
        headers["authorization"] = f"Bearer {LLM_API_KEY}"
    elif authorization:
        headers["authorization"] = authorization
    upstream_request = app.state.client.build_request(
        "POST", f"{LLM_BASE}/v1/{path}", content=content, headers=headers,
    )
    upstream = await app.state.client.send(upstream_request, stream=True)
    response_headers = {}
    if upstream.headers.get("cache-control"):
        response_headers["cache-control"] = upstream.headers["cache-control"]
    # The stream relays raw bytes: if upstream compressed them, the client
    # must know, otherwise the response is unreadable.
    if upstream.headers.get("content-encoding"):
        response_headers["content-encoding"] = upstream.headers["content-encoding"]
    return StreamingResponse(
        upstream.aiter_raw(), status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"), headers=response_headers,
        background=BackgroundTask(upstream.aclose),
    )


ALLOWED_STATIC_SUFFIXES = {".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".woff", ".woff2", ".map"}
DENIED_STATIC_PARTS = {".git", ".github", "customs", "tests", "tools", "packs", "node_modules", "__pycache__"}


@app.get("/{resource_path:path}")
async def static_file(resource_path: str):
    relative = resource_path or "index.html"
    if relative.replace("\\", "/") == "config.local.js":
        raise HTTPException(404)
    parts = Path(relative).parts
    if any(part.startswith(".") or part in DENIED_STATIC_PARTS for part in parts):
        raise HTTPException(404)
    path = (WEB_ROOT / relative).resolve()
    if WEB_ROOT not in path.parents or not path.is_file() or path.suffix.lower() not in ALLOWED_STATIC_SUFFIXES:
        raise HTTPException(404)
    return FileResponse(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve ADAY locally")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    if not args.no_open:
        Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}")).start()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
