import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient
from backend import server as server_module
from backend.server import MAX_JSON_BYTES, RepositoryStore


PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII="


def layout(identifier="demo"):
    return {
        "id": identifier,
        "name": "Demo",
        "category": "custom",
        "imageDataUrl": PIXEL,
        "zones": [{
            "id": "z0", "label": "title", "type": "title",
            "x_pct": 10, "y_pct": 10, "w_pct": 80, "h_pct": 20,
        }],
    }


class RepositoryStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = RepositoryStore(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def run_async(self, awaitable):
        return asyncio.run(awaitable)

    def test_empty_data_directory_is_ready_on_first_start(self):
        self.assertEqual(self.store.state(), {
            "layouts": [],
            "icons": [],
            "photos": [],
            "history": [],
            "settings": {},
            "gallery": {},
            "warnings": [],
        })
        self.run_async(self.store.put("layouts", "first", layout("first")))
        self.assertTrue((self.root / "layouts").is_dir())
        self.assertEqual(self.store.state()["layouts"][0]["id"], "first")

    def test_writes_reads_and_deletes_every_collection(self):
        entries = {
            "layouts": layout("demo"),
            "icons": {"id": "icon", "name": "Icon", "dataUrl": PIXEL},
            "photos": {"id": "photo-1", "name": "Photo", "description": "", "dataUrl": PIXEL, "addedAt": ""},
            "history": {"id": "plan-1", "savedAt": "2026-01-01", "topic": "Demo", "slideCount": 1, "plan": [{}], "display": "", "warnings": []},
        }
        for collection, entry in entries.items():
            self.run_async(self.store.put(collection, entry["id"], entry))
        self.run_async(self.store.put_document("settings", {"model": "demo", "rememberKey": False}))
        self.run_async(self.store.put_document("gallery", {"disabledIcons": [], "disabledLayouts": []}))
        state = self.store.state()
        for collection, entry in entries.items():
            self.assertEqual(state[collection][0]["id"], entry["id"])
        self.assertEqual(state["settings"]["model"], "demo")
        self.assertEqual(state["settings"]["rememberKey"], False)
        for collection, entry in entries.items():
            self.run_async(self.store.delete(collection, entry["id"]))
        self.assertTrue(all(not self.store.state()[name] for name in entries))

    def test_rejects_ids_unknown_fields_data_urls_and_api_keys(self):
        with self.assertRaisesRegex(ValueError, "id"):
            self.run_async(self.store.put("layouts", "../escape", layout("../escape")))
        invalid = layout("demo")
        invalid["script"] = "alert(1)"
        with self.assertRaisesRegex(ValueError, "inconnu"):
            self.run_async(self.store.put("layouts", "demo", invalid))
        invalid = layout("demo")
        invalid["imageDataUrl"] = "data:image/png;base64,aA=="
        with self.assertRaisesRegex(ValueError, "signature"):
            self.run_async(self.store.put("layouts", "demo", invalid))
        invalid = layout("demo")
        invalid["imageDataUrl"] = 'data:image/png;base64,aA==" onerror="alert(1)'
        with self.assertRaisesRegex(ValueError, "Data URL"):
            self.run_async(self.store.put("layouts", "demo", invalid))
        with self.assertRaisesRegex(ValueError, "inconnu"):
            self.run_async(self.store.put_document("settings", {"apiKey": "secret"}))

    def test_enforces_json_limit_and_ignores_corrupt_files(self):
        with self.assertRaisesRegex(ValueError, "4 Mio"):
            self.store._encode({"payload": "x" * MAX_JSON_BYTES})
        folder = self.root / "layouts"
        folder.mkdir()
        (folder / "broken.json").write_text("{", encoding="utf-8")
        state = self.store.state()
        self.assertEqual(state["layouts"], [])
        self.assertEqual(len(state["warnings"]), 1)

    def test_failed_replace_preserves_previous_file(self):
        self.run_async(self.store.put("layouts", "demo", layout("demo")))
        path = self.root / "layouts" / "demo.json"
        before = path.read_bytes()
        changed = layout("demo")
        changed["name"] = "Changed"
        with mock.patch("backend.server.os.replace", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.run_async(self.store.put("layouts", "demo", changed))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(json.loads(before)["name"], "Demo")

    def test_enforces_collection_capacity(self):
        with mock.patch.dict(server_module.COLLECTION_CAPS, {"layouts": 1}):
            self.run_async(self.store.put("layouts", "first", layout("first")))
            with self.assertRaisesRegex(OSError, "capacité layouts"):
                self.run_async(self.store.put("layouts", "second", layout("second")))


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.previous = server_module.store
        server_module.store = RepositoryStore(self.root)
        self.client = TestClient(server_module.app, base_url="http://127.0.0.1")

    def tearDown(self):
        self.client.close()
        server_module.store = self.previous
        self.temp.cleanup()

    def test_rejects_null_and_external_origins(self):
        self.assertEqual(self.client.get("/api/state", headers={"origin": "null"}).status_code, 403)
        self.assertEqual(self.client.get("/api/state", headers={"origin": "https://evil.test"}).status_code, 403)
        self.assertEqual(self.client.get("/api/state", headers={"origin": "http://127.0.0.1"}).status_code, 200)
        self.assertEqual(self.client.get("/api/state", headers={"origin": "https://127.0.0.1"}).status_code, 200)
        static = self.client.get("/index.html", headers={"origin": "null"})
        self.assertEqual(static.status_code, 200)
        self.assertNotIn("access-control-allow-origin", static.headers)
        self.assertEqual(self.client.get("/config.local.js").status_code, 404)
        self.assertEqual(self.client.get("/config/config.local.js").status_code, 404)
        self.assertEqual(self.client.get("/api/local-config", headers={"origin": "null"}).status_code, 403)

    def test_server_accepts_only_local_hosts(self):
        self.assertEqual(server_module.ALLOWED_HOSTS, ["127.0.0.1", "localhost"])
        self.assertTrue(server_module._same_origin_host("http://127.0.0.1", "127.0.0.1"))
        self.assertFalse(server_module._same_origin_host("https://evil.example.com", "127.0.0.1"))

        with (
            mock.patch.object(server_module.argparse.ArgumentParser, "parse_args", return_value=mock.Mock(port=8765, no_open=True)),
            mock.patch("uvicorn.run") as run,
        ):
            server_module.main()
            run.assert_called_once_with(server_module.app, host="127.0.0.1", port=8765)

    def test_rejects_untrusted_host_and_oversized_json(self):
        self.assertEqual(self.client.get("/api/state", headers={"host": "evil.test"}).status_code, 400)
        response = self.client.put(
            "/api/layouts/demo",
            content=b"x" * (MAX_JSON_BYTES + 1),
            headers={"content-type": "application/json", "origin": "http://127.0.0.1"},
        )
        self.assertEqual(response.status_code, 413)

    def test_writes_local_config_without_exposing_static_file(self):
        with mock.patch.object(server_module, "ROOT", self.root):
            response = self.client.put(
                "/api/local-config",
                json={
                    "baseUrl": "https://example.test/v1",
                    "model": "demo",
                    "visionModel": "vision-demo",
                    "apiKey": "secret",
                },
                headers={"origin": "http://127.0.0.1"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"ok": True, "hasApiKey": True})
            source = (self.root / "config" / "config.local.js").read_text(encoding="utf-8")
            self.assertIn('"secret"', source)
            self.assertEqual(self.client.get("/config.local.js").status_code, 404)

            cleared = self.client.put(
                "/api/local-config",
                json={"baseUrl": "https://example.test/v1", "model": "demo", "visionModel": "", "apiKey": ""},
                headers={"origin": "http://127.0.0.1"},
            )
            self.assertEqual(cleared.status_code, 200)
            self.assertEqual(cleared.json()["hasApiKey"], False)
            self.assertIn('apiKey: ""', (self.root / "config" / "config.local.js").read_text(encoding="utf-8"))

        forbidden = self.client.put(
            "/api/local-config",
            json={"baseUrl": "", "model": "", "visionModel": "", "apiKey": "secret"},
            headers={"origin": "null"},
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_local_config_path_can_be_isolated_by_env(self):
        repo_root = self.root / "repo-root"
        repo_root.mkdir()
        isolated_config = self.root / "isolated" / "config.local.js"
        with (
            mock.patch.object(server_module, "ROOT", repo_root),
            mock.patch.dict(server_module.os.environ, {"PPTGEN_LOCAL_CONFIG": str(isolated_config)}),
        ):
            response = self.client.put(
                "/api/local-config",
                json={"baseUrl": "", "model": "demo", "visionModel": "", "apiKey": "secret"},
                headers={"origin": "http://127.0.0.1"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertIn('"secret"', isolated_config.read_text(encoding="utf-8"))
            self.assertFalse((repo_root / "config" / "config.local.js").exists())

    def test_accepts_bounded_analysis_metadata(self):
        entry = layout("demo")
        entry["analysis"] = {
            "classificationStatus": "complete",
            "descriptionStatus": "failed",
            "errorCode": "non-vision",
            "errorMessage": "Le modele ne supporte pas les images.",
            "updatedAt": "2026-06-20T10:00:00Z",
        }
        response = self.client.put(
            "/api/layouts/demo", json=entry,
            headers={"origin": "http://127.0.0.1"},
        )
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()


class ProxyCredentialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data_patch = mock.patch.object(
            server_module, "DATA_ROOT", Path(self.temp.name)
        )
        self.data_patch.start()
        self.client = TestClient(server_module.app, base_url="http://127.0.0.1")

    def tearDown(self):
        self.data_patch.stop()
        self.temp.cleanup()

    def test_server_side_key_requires_the_proxy_token(self):
        with mock.patch.object(server_module, "LLM_API_KEY", "sk-secret"), \
                mock.patch.object(server_module, "PROXY_TOKEN", "demo-token"):
            refused = self.client.post(
                "/v1/chat/completions",
                json={},
                headers={"authorization": "Bearer wrong"},
            )
            self.assertEqual(refused.status_code, 401)
            missing = self.client.post("/v1/chat/completions", json={})
            self.assertEqual(missing.status_code, 401)

    def test_server_side_key_replaces_the_browser_authorization(self):
        captured = {}

        class FakeUpstream:
            status_code = 200
            headers = {"content-type": "application/json"}

            async def aiter_raw(self):
                yield b"{}"

            async def aclose(self):
                return None

        class FakeClient:
            def build_request(self, method, url, content=None, headers=None):
                captured["url"] = url
                captured["headers"] = dict(headers or {})
                return object()

            async def send(self, request, stream=False):
                return FakeUpstream()

        with mock.patch.object(server_module, "LLM_API_KEY", "sk-secret"), \
                mock.patch.object(server_module, "PROXY_TOKEN", "demo-token"), \
                mock.patch.object(
                    server_module.app.state, "client", FakeClient(), create=True
                ):
            accepted = self.client.post(
                "/v1/chat/completions",
                json={},
                headers={"authorization": "Bearer demo-token"},
            )
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(captured["headers"]["authorization"], "Bearer sk-secret")
            self.assertNotIn("demo-token", str(captured["headers"]))
