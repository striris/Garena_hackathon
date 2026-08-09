"""CINDERFALL's server-side LLM boundary.

The compatible provider is deliberately isolated here. Browser code never sees
credentials, raw model output, or an unvalidated decision.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_BASE_URL = "https://api.aiand.com/v1"
DEFAULT_MODEL = "openai/gpt-oss-120b"
DEFAULT_TIMEOUT_SECONDS = 15.0

STRATEGY_INTENTS = {"EXPAND", "RAID", "DEFEND", "BEACON"}
STRATEGY_REGIONS = {"NORTH", "SOUTH", "BEACON", "CAPITAL"}
EVENT_TEMPLATES = {"beacon_moves"}
EVENT_REGIONS = {"north", "south", "east", "west", "centre"}


class AIServiceError(RuntimeError):
    """A safe, typed failure that the HTTP layer may return to the browser."""

    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code = code
        self.status = status


def _read_text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8").strip()


def _require_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AIServiceError("invalid_request", f"{name} must be a JSON object", 400)
    return value


def _string(value: Any, name: str, limit: int = 240) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AIServiceError("invalid_model_output", f"{name} must be a non-empty string")
    result = value.strip()
    if len(result) > limit:
        raise AIServiceError("invalid_model_output", f"{name} exceeds {limit} characters")
    return result


def _enum(value: Any, allowed: set[str], name: str, upper: bool = True) -> str:
    if not isinstance(value, str):
        raise AIServiceError("invalid_model_output", f"{name} must be a string")
    result = value.strip().upper() if upper else value.strip().lower()
    if result not in allowed:
        raise AIServiceError("invalid_model_output", f"{name} has an unsupported value")
    return result


def _string_list(value: Any, name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise AIServiceError("invalid_model_output", f"{name} must be an array of strings")
    result: list[str] = []
    for item in value:
        item = item.strip()
        if item and item not in result:
            result.append(item)
    return result


def _parse_json(content: Any) -> dict[str, Any]:
    if not isinstance(content, str) or not content.strip():
        raise AIServiceError("empty_model_output", "model returned no text")
    text = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIServiceError("invalid_json", "model output was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise AIServiceError("invalid_model_output", "model output must be a JSON object")
    return parsed


def _contains_private_order_queue(value: Any) -> bool:
    forbidden = {"orders", "currentorders", "queuedorders", "orderqueue"}
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z]", "", str(key).lower())
            if normalized in forbidden or _contains_private_order_queue(child):
                return True
    elif isinstance(value, list):
        return any(_contains_private_order_queue(item) for item in value)
    return False


def _candidate_ids(payload: dict[str, Any]) -> set[str]:
    return {
        item.get("id")
        for item in payload.get("candidates", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def _validate_candidate_decision(raw: Any, payload: dict[str, Any], role: str) -> dict[str, Any]:
    """Validate the deliberately tiny decision shared by both AI roles.

    Models choose an offered ID and cite public report keys. They never return
    executable strategy fields, map operations, combat numbers, or rules.
    """
    data = _require_object(raw, "model output")
    required = {"selected_candidate", "evidence_used", "explanation"}
    if set(data) != required:
        raise AIServiceError("invalid_model_output", f"{role} output fields do not match the schema")

    selected = _string(data["selected_candidate"], "selected_candidate", 32)
    if selected not in _candidate_ids(payload):
        raise AIServiceError("unknown_candidate", f"{role} selected a candidate that was not offered")

    evidence = _string_list(data["evidence_used"], "evidence_used")
    evidence_source = payload.get("evidence", {}) if role == "Saltkin" else payload.get("report", {})
    allowed_evidence = set(_require_object(evidence_source, "evidence" if role == "Saltkin" else "report"))
    if any(item not in allowed_evidence for item in evidence):
        raise AIServiceError("invalid_model_output", "evidence_used cites data absent from the request")

    return {
        "selected_candidate": selected,
        "evidence_used": evidence,
        "explanation": _string(data["explanation"], "explanation"),
    }


def validate_saltkin(raw: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return _validate_candidate_decision(raw, payload, "Saltkin")


def validate_director(raw: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return _validate_candidate_decision(raw, payload, "Director")


class AIService:
    def __init__(
        self,
        *,
        client: Any | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("CINDERFALL_API_KEY", "")
        self.base_url = base_url or os.getenv("CINDERFALL_AI_BASE_URL", DEFAULT_BASE_URL)
        self.model = model or os.getenv("CINDERFALL_AI_MODEL", DEFAULT_MODEL)
        self.timeout = timeout if timeout is not None else float(
            os.getenv("CINDERFALL_AI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
        )
        self.client = client
        self.init_error: str | None = None

        if self.client is None and self.api_key:
            try:
                from openai import OpenAI

                self.client = OpenAI(
                    base_url=self.base_url,
                    api_key=self.api_key,
                    timeout=self.timeout,
                    max_retries=0,
                )
            except Exception as exc:  # import/config errors become explicit fallback
                self.init_error = type(exc).__name__

    def health(self) -> dict[str, Any]:
        ready = self.client is not None
        return {
            "configured": bool(self.api_key or ready),
            "ready": ready,
            "source": "LLM" if ready else "FALLBACK",
            "model": self.model,
            "baseUrl": self.base_url,
            "timeoutMs": round(self.timeout * 1000),
            "reason": self.init_error or (None if ready else "missing_api_key"),
        }

    def _complete(self, prompt_file: str, schema_file: str, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        if self.client is None:
            reason = "sdk_unavailable" if self.init_error else "missing_api_key"
            raise AIServiceError(reason, "LLM service is not configured", 503)

        messages = [
            {"role": "system", "content": _read_text(prompt_file) + "\n\nJSON SCHEMA:\n" + _read_text(schema_file)},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))},
        ]
        started = time.perf_counter()
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
        except Exception as exc:
            name = type(exc).__name__
            code = "timeout" if "timeout" in name.lower() else "provider_error"
            raise AIServiceError(code, f"LLM request failed ({name})", 504 if code == "timeout" else 502) from exc

        latency_ms = round((time.perf_counter() - started) * 1000)
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError) as exc:
            raise AIServiceError("invalid_provider_response", "provider response contained no completion") from exc

        return _parse_json(content), {
            "source": "LLM",
            "model": self.model,
            "latencyMs": latency_ms,
            "requestId": getattr(response, "_request_id", None),
        }

    def saltkin(self, payload: Any) -> dict[str, Any]:
        request = _require_object(payload, "request")
        if _contains_private_order_queue(request):
            raise AIServiceError("private_orders_forbidden", "Saltkin requests cannot contain the current order queue", 400)
        if not isinstance(request.get("matchId"), str) or not isinstance(request.get("snapshotTurn"), int):
            raise AIServiceError("invalid_request", "matchId and integer snapshotTurn are required", 400)
        candidates = request.get("candidates")
        if not isinstance(candidates, list) or len(candidates) != 3:
            raise AIServiceError("invalid_request", "Saltkin requires exactly three strategy candidates", 400)
        candidate_ids = [item.get("id") for item in candidates if isinstance(item, dict)]
        if len(candidate_ids) != 3 or set(candidate_ids) != {"S1", "S2", "S3"}:
            raise AIServiceError("invalid_request", "Saltkin candidate IDs must be present and unique", 400)
        for candidate in candidates:
            if set(candidate) != {"id", "intent", "region"}:
                raise AIServiceError("invalid_request", "Saltkin candidate fields do not match the trusted card shape", 400)
            if candidate["intent"] not in STRATEGY_INTENTS or candidate["region"] not in STRATEGY_REGIONS:
                raise AIServiceError("invalid_request", "Saltkin candidate contains an unsupported strategy value", 400)
        raw, meta = self._complete("ai/prompts/saltkin.md", "ai/schemas/saltkin.json", request)
        return {
            "decision": validate_saltkin(raw, request),
            "meta": meta,
            "matchId": request.get("matchId"),
            "snapshotTurn": request.get("snapshotTurn"),
        }

    def director(self, payload: Any) -> dict[str, Any]:
        request = _require_object(payload, "request")
        candidates = request.get("candidates")
        if not isinstance(candidates, list) or not 3 <= len(candidates) <= 5:
            raise AIServiceError("invalid_request", "Director requires three to five candidates", 400)
        candidate_ids = [item.get("id") for item in candidates if isinstance(item, dict)]
        if len(candidate_ids) != len(candidates) or any(not isinstance(item, str) for item in candidate_ids) or len(set(candidate_ids)) != len(candidate_ids):
            raise AIServiceError("invalid_request", "Director candidate IDs must be present and unique", 400)
        if candidate_ids != [f"C{index}" for index in range(1, len(candidates) + 1)]:
            raise AIServiceError("invalid_request", "Director candidate IDs must be sequential C1-C5 IDs", 400)
        for candidate in candidates:
            event = candidate.get("event") if isinstance(candidate, dict) else None
            if not isinstance(event, dict) or event.get("template") not in EVENT_TEMPLATES:
                raise AIServiceError("invalid_request", "Director candidates must use a trusted Lite event", 400)
            affected = event.get("affected")
            if event.get("region") not in EVENT_REGIONS or not isinstance(affected, list) or not affected:
                raise AIServiceError("invalid_request", "Director candidates require a region and exact affected tiles", 400)
            if any(isinstance(item, bool) or not isinstance(item, int) or item < 0 for item in affected) or len(set(affected)) != len(affected):
                raise AIServiceError("invalid_request", "Director affected tiles must be unique non-negative integers", 400)
        raw, meta = self._complete("ai/prompts/director.md", "ai/schemas/director.json", request)
        return {
            "decision": validate_director(raw, request),
            "meta": meta,
            "season": _require_object(request.get("report", {}), "report").get("season"),
        }
