import json
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

from ai_service import AIService, AIServiceError, validate_director, validate_saltkin
from server import CinderfallHandler, make_server


SALT_PAYLOAD = {
    "matchId": "ring-test-1",
    "snapshotTurn": 4,
    "profile": {"preferred_arc": "NORTH"},
    "evidence": {"north_order_share": 0.75, "resolved_turns": 3},
    "recentMatches": [],
    "publicState": {"turn": 4},
}

SALT_DECISION = {
    "stance": "ASSAULT",
    "objective": "SUPPLY",
    "target_region": "NORTH",
    "risk": "MEDIUM",
    "player_model": ["preferred_arc"],
    "intent": "Pressure the exposed northern supply line.",
    "evidence_used": ["north_order_share"],
}

DIRECTOR_PAYLOAD = {
    "report": {"quiet": 4, "landGap": 1, "season": 2},
    "candidates": [{"id": "C1", "event": {"template": "rock_cools"}}],
}

DIRECTOR_DECISION = {
    "selected_candidate": "C1",
    "goal": "BREAK_STALEMATE",
    "evidence_used": ["quiet"],
    "prediction": {"metric": "raids_per_turn", "direction": "increase", "horizon": 3},
    "player_explanation": "Four quiet turns make lower defensive value the clearest intervention.",
    "confidence": 0.78,
}


class FakeCompletions:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.outputs.pop(0)
        if isinstance(content, Exception):
            raise content
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(content)))],
            _request_id="req-test",
        )


class FakeClient:
    def __init__(self, outputs):
        self.completions = FakeCompletions(outputs)
        self.chat = SimpleNamespace(completions=self.completions)


class AIServiceTests(unittest.TestCase):
    def test_saltkin_uses_chat_completions_and_echoes_snapshot(self):
        client = FakeClient([SALT_DECISION])
        service = AIService(client=client, model="openai/gpt-oss-120b")
        result = service.saltkin(SALT_PAYLOAD)
        self.assertEqual(result["decision"], SALT_DECISION)
        self.assertEqual(result["matchId"], "ring-test-1")
        self.assertEqual(result["snapshotTurn"], 4)
        self.assertEqual(result["meta"]["requestId"], "req-test")
        self.assertEqual(client.completions.calls[0]["model"], "openai/gpt-oss-120b")
        self.assertEqual(client.completions.calls[0]["messages"][0]["role"], "system")

    def test_director_rejects_unknown_candidate(self):
        invalid = dict(DIRECTOR_DECISION, selected_candidate="C99")
        with self.assertRaises(AIServiceError) as caught:
            validate_director(invalid, DIRECTOR_PAYLOAD)
        self.assertEqual(caught.exception.code, "unknown_candidate")

    def test_director_uses_chat_completions(self):
        client = FakeClient([DIRECTOR_DECISION])
        service = AIService(client=client, model="openai/gpt-oss-120b")
        result = service.director(DIRECTOR_PAYLOAD)
        self.assertEqual(result["decision"], DIRECTOR_DECISION)
        self.assertEqual(result["season"], 2)
        self.assertEqual(client.completions.calls[0]["model"], "openai/gpt-oss-120b")

    def test_timeout_is_an_explicit_failure(self):
        service = AIService(client=FakeClient([TimeoutError("too slow")]))
        with self.assertRaises(AIServiceError) as caught:
            service.saltkin(SALT_PAYLOAD)
        self.assertEqual(caught.exception.code, "timeout")
        self.assertEqual(caught.exception.status, 504)

    def test_invalid_schema_is_rejected(self):
        invalid = dict(SALT_DECISION, extra="not allowed")
        service = AIService(client=FakeClient([invalid]))
        with self.assertRaises(AIServiceError) as caught:
            service.saltkin(SALT_PAYLOAD)
        self.assertEqual(caught.exception.code, "invalid_model_output")

    def test_empty_model_response_is_rejected(self):
        service = AIService(client=FakeClient([None]))
        with self.assertRaises(AIServiceError) as caught:
            service.saltkin(SALT_PAYLOAD)
        self.assertEqual(caught.exception.code, "invalid_model_output")

    def test_saltkin_rejects_evidence_not_in_request(self):
        invalid = dict(SALT_DECISION, evidence_used=["secret_current_orders"])
        with self.assertRaises(AIServiceError) as caught:
            validate_saltkin(invalid, SALT_PAYLOAD)
        self.assertEqual(caught.exception.code, "invalid_model_output")

    def test_saltkin_request_rejects_private_order_queue(self):
        service = AIService(client=FakeClient([SALT_DECISION]))
        private = dict(SALT_PAYLOAD, currentOrders=[{"type": "raid", "to": 9}])
        with self.assertRaises(AIServiceError) as caught:
            service.saltkin(private)
        self.assertEqual(caught.exception.code, "private_orders_forbidden")

    def test_missing_key_is_explicit_fallback(self):
        service = AIService(api_key="")
        self.assertFalse(service.health()["ready"])
        self.assertEqual(service.health()["source"], "FALLBACK")
        self.assertEqual(service.health()["timeoutMs"], 15000)
        with self.assertRaises(AIServiceError) as caught:
            service.saltkin(SALT_PAYLOAD)
        self.assertEqual(caught.exception.code, "missing_api_key")

    def test_prompt_and_schema_assets_are_present(self):
        root = Path(__file__).resolve().parents[1]
        for relative in (
            "ai/prompts/saltkin.md",
            "ai/prompts/director.md",
            "ai/schemas/saltkin.json",
            "ai/schemas/director.json",
        ):
            self.assertTrue((root / relative).is_file(), relative)


class HTTPBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server("127.0.0.1", 0, AIService(api_key=""))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_health_and_static_allowlist(self):
        with urllib.request.urlopen(self.base + "/api/ai/health") as response:
            body = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertFalse(body["ready"])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.base + "/.env")
        self.assertEqual(caught.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as traversal:
            urllib.request.urlopen(self.base + "/js/%2e%2e/server.py")
        self.assertEqual(traversal.exception.code, 404)

    def test_missing_key_api_response_is_sanitized(self):
        request = urllib.request.Request(
            self.base + "/api/ai/saltkin",
            data=json.dumps(SALT_PAYLOAD).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request)
        body = json.loads(caught.exception.read())
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(body["source"], "FALLBACK")
        serialized = json.dumps(body).lower()
        self.assertNotIn('"api_key":', serialized)
        self.assertNotIn("sk-", serialized)


class ClientDisconnectTests(unittest.TestCase):
    def test_json_response_suppresses_expected_client_disconnect(self):
        class DisconnectedWriter:
            def write(self, _body):
                raise ConnectionAbortedError(10053, "client disconnected")

        handler = object.__new__(CinderfallHandler)
        handler.wfile = DisconnectedWriter()
        handler.send_response = lambda _status: None
        handler.send_header = lambda _name, _value: None
        handler.end_headers = lambda: None

        self.assertFalse(handler._json(504, {"error": {"code": "timeout"}}))


if __name__ == "__main__":
    unittest.main()
