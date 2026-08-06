"""Local static server and same-origin AI API for CINDERFALL."""

from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from ai_service import AIService, AIServiceError


ROOT = Path(__file__).resolve().parent
MAX_BODY = 512 * 1024
PUBLIC_FILES = {"/", "/index.html"}
PUBLIC_PREFIXES = ("/css/", "/js/", "/assets/")


def load_env_file(path: Path) -> None:
    """Load a small local .env without ever printing or overwriting real env."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


class CinderfallHandler(SimpleHTTPRequestHandler):
    server_version = "Cinderfall/1.0"

    def __init__(self, *args: Any, service: AIService, **kwargs: Any) -> None:
        self.ai_service = service
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status: int, payload: dict[str, Any]) -> bool:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # The browser may time out, navigate away, or close while the
            # synchronous provider call is still finishing. That disconnect is
            # expected and must not become a noisy server traceback.
            return False
        return True

    def _path(self) -> str:
        return unquote(urlparse(self.path).path)

    def _is_public_static(self, path: str) -> bool:
        parts = Path(path.lstrip("/")).parts
        if ".." in parts or "." in parts:
            return False
        if path in PUBLIC_FILES:
            return True
        return (path.startswith("/js/") and path.endswith(".js")) or (
            path.startswith("/css/") and path.endswith(".css")
        ) or path.startswith("/assets/")

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        path = self._path()
        if path == "/api/ai/health":
            self._json(HTTPStatus.OK, self.ai_service.health())
            return
        if not self._is_public_static(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = self._path()
        if path not in {"/api/ai/saltkin", "/api/ai/director"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": {"code": "invalid_length", "message": "Invalid Content-Length"}})
            return
        if length <= 0 or length > MAX_BODY:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": {"code": "invalid_body_size", "message": "JSON body is empty or too large"}})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = self.ai_service.saltkin(payload) if path.endswith("/saltkin") else self.ai_service.director(payload)
            self._json(HTTPStatus.OK, result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": {"code": "invalid_json", "message": "Request body must be valid UTF-8 JSON"}})
        except AIServiceError as exc:
            self._json(exc.status, {"error": {"code": exc.code, "message": str(exc)}, "source": "FALLBACK"})
        except Exception as exc:  # never expose prompts, payloads, keys, or traces
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": {"code": "internal_error", "message": f"Unexpected server error ({type(exc).__name__})"}, "source": "FALLBACK"})

    def log_message(self, fmt: str, *args: Any) -> None:
        # The default request line is safe; request bodies and credentials are
        # deliberately never logged.
        super().log_message(fmt, *args)


def make_server(host: str, port: int, service: AIService | None = None) -> ThreadingHTTPServer:
    active_service = service or AIService()

    def handler(*args: Any, **kwargs: Any) -> CinderfallHandler:
        return CinderfallHandler(*args, service=active_service, **kwargs)

    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main() -> None:
    load_env_file(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Serve CINDERFALL and its private AI endpoints")
    parser.add_argument("--host", default=os.getenv("CINDERFALL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("CINDERFALL_PORT", "8000")))
    args = parser.parse_args()

    server = make_server(args.host, args.port)
    print(f"CINDERFALL running at http://{args.host}:{args.port}")
    print("AI key: configured in server environment only" if os.getenv("CINDERFALL_API_KEY") else "AI key: missing — explicit heuristic fallback enabled")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
