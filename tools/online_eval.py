"""Opt-in paid/remote evaluation for both CINDERFALL AI roles.

Nothing runs without an environment key and --confirm-cost. Decisions and error
codes are counted; prompts, raw payloads, and credentials are not logged.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_service import AIService, AIServiceError  # noqa: E402
from server import load_env_file  # noqa: E402


SALT_SCENARIOS = [
    ("beacon_lock", {"beacon_order_share": 0.82, "resolved_turns": 8}),
    ("north_arc", {"north_order_share": 0.78, "resolved_turns": 8}),
    ("supply_neglect", {"cut_off_tile_turns": 17, "owned_tile_turns": 80}),
    ("high_ground", {"high_ground_fortify_spend": 12, "total_fortify_spend": 15}),
    ("warning_push", {"warning_press_orders": 7, "warning_avoid_orders": 1}),
]

DIRECTOR_SCENARIOS = [
    ("stalemate", {"quiet": 6, "landGap": 0, "beaconStill": 5}),
    ("runaway", {"quiet": 0, "landGap": 8, "incomeGap": 11}),
    ("beacon_lock", {"quiet": 2, "landGap": 2, "beaconStill": 9}),
    ("fragile_supply", {"quiet": 1, "landGap": 3, "cutOff": 7}),
    ("low_variety", {"quiet": 3, "landGap": 1, "emptyLand": 2}),
]


def salt_payload(name: str, evidence: dict, run: int) -> dict:
    return {
        "matchId": f"eval-{name}-{run}",
        "snapshotTurn": 7,
        "trigger": name,
        "profile": {
            "beacon_chase": 0.5,
            "high_ground_turtle": 0.5,
            "preferred_arc": "MIXED",
            "supply_neglect": 0.1,
            "warning_response": "UNKNOWN",
            "last_match_tactic": "EXPAND",
        },
        "evidence": evidence,
        "recentMatches": [],
        "publicState": {"turn": 7, "land": {"ashfarers": 13, "saltkin": 13}},
    }


def director_payload(name: str, report: dict, run: int) -> dict:
    report = dict(report, season=run + 1, turn=6)
    return {
        "report": report,
        "recentMemory": {},
        "saltkinDoctrine": None,
        "shadowBaseline": {"template": "rock_cools", "intensity": 2, "region": "centre"},
        "candidates": [
            {"id": "C1", "event": {"template": "rock_cools", "intensity": 2, "region": "centre"}, "counterfactual": {"raids_per_turn": {"median": 1.3}}},
            {"id": "C2", "event": {"template": "storm", "intensity": 2, "region": "north"}, "counterfactual": {"land_gap": {"median": 2}}},
            {"id": "C3", "event": {"template": "new_island", "intensity": 2, "region": "centre"}, "counterfactual": {"beacon_contest": {"median": 1}}},
        ],
        "scenario": name,
    }


def main() -> int:
    load_env_file(Path(__file__).resolve().parents[1] / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs-per-scenario", type=int, default=4)
    parser.add_argument("--confirm-cost", action="store_true")
    args = parser.parse_args()
    if not args.confirm_cost:
        print("Refusing remote evaluation without --confirm-cost.")
        return 2
    if not os.getenv("CINDERFALL_API_KEY"):
        print("CINDERFALL_API_KEY is missing. No requests were sent.")
        return 2

    service = AIService()
    summary = {"saltkin": {"ok": 0, "errors": {}}, "director": {"ok": 0, "errors": {}}}
    for role, scenarios, builder, call in (
        ("saltkin", SALT_SCENARIOS, salt_payload, service.saltkin),
        ("director", DIRECTOR_SCENARIOS, director_payload, service.director),
    ):
        for name, evidence in scenarios:
            for run in range(args.runs_per_scenario):
                try:
                    call(builder(name, evidence, run))
                    summary[role]["ok"] += 1
                except AIServiceError as exc:
                    errors = summary[role]["errors"]
                    errors[exc.code] = errors.get(exc.code, 0) + 1
    print(json.dumps(summary, indent=2))
    return 0 if not summary["saltkin"]["errors"] and not summary["director"]["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
