import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"])


class StaticAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.main = (ROOT / "js/main.js").read_text(encoding="utf-8")
        cls.ai = (ROOT / "js/ai.js").read_text(encoding="utf-8")
        cls.render = (ROOT / "js/render.js").read_text(encoding="utf-8")
        cls.intro = (ROOT / "js/intro.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "css/style.css").read_text(encoding="utf-8")
        cls.engine = (ROOT / "js/engine.js").read_text(encoding="utf-8")
        cls.mapgen = (ROOT / "js/mapgen.js").read_text(encoding="utf-8")
        cls.saltkin_prompt = (ROOT / "ai/prompts/saltkin.md").read_text(encoding="utf-8")
        cls.parser = IndexParser()
        cls.parser.feed(cls.html)

    def test_html_ids_are_unique(self):
        self.assertEqual(len(self.parser.ids), len(set(self.parser.ids)))

    def test_main_dom_references_exist(self):
        references = set(re.findall(r"\$\(['\"]([^'\"]+)['\"]\)", self.main))
        missing = sorted(references - set(self.parser.ids))
        self.assertEqual(missing, [])

    def test_all_script_assets_exist_and_ai_order_is_safe(self):
        for source in self.parser.scripts:
            self.assertTrue((ROOT / source).is_file(), source)
        order = self.parser.scripts
        self.assertLess(order.index("js/engine.js"), order.index("js/profile.js"))
        self.assertLess(order.index("js/events.js"), order.index("js/bot.js"))
        self.assertLess(order.index("js/bot.js"), order.index("js/director.js"))
        self.assertLess(order.index("js/ai.js"), order.index("js/main.js"))

    def test_repository_has_no_embedded_key_shape(self):
        secret = re.compile(r"sk-[A-Za-z0-9]{12,}")
        for path in list(ROOT.glob("*.py")) + list((ROOT / "js").glob("*.js")) + list((ROOT / "ai").rglob("*")):
            if path.is_file():
                self.assertIsNone(secret.search(path.read_text(encoding="utf-8")), str(path))

    def test_real_and_simulated_ai_timeouts_are_separate(self):
        self.assertIn("var FAILURE_TIMEOUT_MS = 3000;", self.ai)
        self.assertIn("REQUEST_TIMEOUT_MS = Math.ceil(serverTimeout) + 1500;", self.ai)
        self.assertIn("CF.ai.configure(health);", self.main)

    def test_canvas_hit_testing_tracks_visual_size(self):
        self.assertIn("new ResizeObserver(queueResize)", self.render)
        self.assertIn("pointFromClient: pointFromClient", self.render)
        self.assertIn("R.pointFromClient(e.clientX, e.clientY)", self.main)

    def test_intro_navigation_remains_inside_viewport(self):
        self.assertIn("grid-template-rows:minmax(0,1fr) auto", self.css)
        self.assertIn("overflow-y:auto", self.css)

    def test_tutorial_uses_short_animated_rule_scenes(self):
        self.assertEqual(self.html.count('class="slide'), 4)
        self.assertIn('id="intro-back"', self.html)
        self.assertIn('id="intro-progress"', self.html)
        self.assertIn('id="btn-tutorial"', self.html)
        self.assertIn("GOAL &amp; RING MAP", self.html)
        self.assertIn("TWO SECRET COMMANDS", self.html)
        self.assertIn("ATTACK &amp; DEFENCE", self.html)
        self.assertIn("TWO AIs, EVENTS &amp; VICTORY", self.html)
        self.assertIn("about 30 seconds", self.html)
        self.assertIn("setScene: setScene", self.intro)
        self.assertIn("@keyframes command-commit", self.css)
        self.assertIn("@keyframes attack-dash", self.css)
        self.assertIn("prefers-reduced-motion", self.css)

    def test_ai_thinking_locks_mutating_controls_and_invalidates_old_runs(self):
        self.assertIn('id="ai-thinking"', self.html)
        self.assertIn('aria-live="polite"', self.html)
        self.assertIn("function interactionLocked()", self.main)
        self.assertIn("function beginAIWait(", self.main)
        self.assertIn("function syncControls()", self.main)
        self.assertIn("function isCurrentRun(run)", self.main)
        self.assertIn("invalidateTurnFlow();", self.main)
        self.assertIn("if (interactionLocked() || game.over) return;", self.main)
        self.assertIn("position:fixed", self.css)

    def test_map_previews_legal_targets_and_flashes_invalid_clicks(self):
        self.assertIn("setLegalTargets: setLegalTargets", self.render)
        self.assertIn("function legalTargetsForTool()", self.main)
        self.assertIn("case 'invalid':", self.render)
        self.assertIn('class="order-remove"', self.main)

    def test_two_free_expand_raid_guard_commands_are_visible(self):
        self.assertIn("COMMANDS_PER_TURN = 2", self.engine)
        self.assertIn("type === 'expand' || type === 'raid' || type === 'guard'", self.engine)
        self.assertIn("commandPreview:commandPreview", self.engine)
        self.assertIn("canGuard:canGuard", self.engine)
        self.assertIn('data-tool="guard"', self.html)
        self.assertIn('class="boost-btn hidden"', self.html)
        self.assertIn("orders.length !== E.FIELD_COMMANDS", self.main)

    def test_supply_and_permanent_fortification_are_removed(self):
        self.assertIn("TOKEN_CAP:0", self.engine)
        self.assertIn("t.fertileSite = 0", self.engine)
        self.assertIn("t.relay = null", self.engine)
        self.assertIn("block one Raid this turn", self.html)
        self.assertNotIn('data-tool="fortify"', self.html)

    def test_v02_limits_are_public(self):
        self.assertIn("MAX_TURNS = 10", self.engine)
        self.assertIn("BEACON_TO_WIN = 4", self.engine)
        self.assertIn("/ 10 turns", self.html)
        self.assertIn("0 / 4", self.html)
        self.assertNotIn("game.pressure", self.main)

    def test_endgame_uses_staged_settlement_animation(self):
        for element_id in ("go-kicker", "go-a-bp", "go-b-bp", "go-a-land", "go-b-land", "go-verdict"):
            self.assertIn(f'id="{element_id}"', self.html)
            self.assertIn(f"$('{element_id}')", self.main)
        self.assertIn("settlement-scores", self.html)
        self.assertIn("settlement-rise", self.css)
        self.assertIn("settlement-side-left", self.css)
        self.assertIn("settlement-ember", self.css)

    def test_bounded_ai_choices_are_explained_and_previewed_exactly(self):
        profile = (ROOT / "js/profile.js").read_text(encoding="utf-8")
        events = (ROOT / "js/events.js").read_text(encoding="utf-8")
        self.assertIn("resolveStrategyCard", profile)
        self.assertIn("selected_candidate", self.main)
        self.assertIn("evidence_used", self.main)
        self.assertIn("function drawPendingWarning", self.render)
        self.assertIn("pending.affected", self.render)
        self.assertIn("beacon_moves", events)
        for removed_event in ("ground_breaks", "land_rises", "bloom", "forts_crack"):
            self.assertNotIn(removed_event, events)


if __name__ == "__main__":
    unittest.main()
