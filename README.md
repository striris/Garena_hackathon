# CINDERFALL

**A compact strategy game set on a volcanic ring that never stays the same.**

You command the Ashfarers against the Saltkin. Expand through the North or
South route, cut an enemy supply line at a Relay, and keep the Beacon connected
to your capital long enough to win.

CINDERFALL is designed as a short, readable match rather than a large strategy
game. The battlefield has two clear fronts, a small action set, visible legal
targets, and simultaneous turns. As the match develops, Cinder observes only
what has already happened and creates a new, fair opportunity on the map.

> 中文概览：这是一个围绕北路与南路展开的轻策略对抗游戏。扩张领地、守住补给线、
> 争夺 Relay，并让 Beacon 保持补给即可得分。火山 Cinder 会根据已结算的局势改变
> 后续地图机会，但不会替任何一方直接决定胜负。

## Play the game

Requirements: **Python 3.9+**. Node.js is optional and is only used for local
simulation. The complete rules game works without an LLM key.

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env

python server.py
```

Open <http://127.0.0.1:8000>.

### Optional LLM configuration

LLM calls enrich the Saltkin's strategic intent, Cinder's event selection, and
the optional Mock Player tool. They are never required to execute a legal turn:
the deterministic rules and bot always remain available as fallback.

```dotenv
CINDERFALL_API_KEY=your-key
CINDERFALL_AI_BASE_URL=https://api.siliconflow.cn/v1
CINDERFALL_AI_MODEL=moonshotai/Kimi-K2.7-Code
CINDERFALL_AI_TIMEOUT_SECONDS=12
CINDERFALL_HOST=127.0.0.1
CINDERFALL_PORT=8000
```

The key stays in the local Python service and is never exposed to the browser.
Do not commit `.env`.

## First match in one minute

Open **Settings → How to Play** for the short visual guide. The practical loop
is deliberately simple:

1. **Choose a route.** Select `Claim`, then click a glowing empty tile on North
   or South. The first route action is your focus for this turn; next turn you
   can choose either front again.
2. **Use the three core actions.** Claim grows into empty land, Hold strengthens
   a supplied friendly tile, and Attack contests an adjacent enemy tile. The
   fourth button, Combo, is an optional bonus that lights only after linked
   actions.
3. **End the turn.** Both sides' queued orders resolve together. The fixed task
   line above the battle log always states the most useful next move.

Keyboard controls: `1–4` select an action, `Enter` ends the turn, and `Esc`
clears the current queue.

## Read the battlefield

| Map element | What it means |
|---|---|
| **North / South** | The two normal fronts. Neither is a special third route, and you may switch on the next turn. |
| **Glowing border** | Your selected action is legal on this tile. |
| **◇ Relay pair** | Taking both squares can sever the enemy territory beyond it from its capital. |
| **★ Beacon** | Scores only while it is connected to your capital by supplied land. |
| **Cinder warning** | A visible, upcoming world change. It gives both sides time to react. |

Supply is the core strategic rule: connected land produces resources and can be
held; cut-off land weakens. A supplied Beacon earns points. Capture and defend
with one clear combat comparison, while a coordinated attack from two supplied
tiles is stronger.

Win by earning enough supplied Beacon points, or by holding more land when the
match limit is reached.

## Cinder: a living but fair battlefield

Cinder is the world, not a hidden referee. It looks at resolved public state—
territory, supply pressure, route use, and recent combat—and selects from safe
map opportunities prepared by trusted game code. The result may create a new
resource focus, shift terrain pressure, or encourage movement on a quieter
front.

The game enforces these guarantees:

- Current player orders are never sent to the opponent or world model.
- Capitals and Relay infrastructure are protected.
- A world change cannot remove every route between both sides or erase a side
  from the map.
- Every event is announced before it happens and checked again at execution.
- A failed or slow model call produces an explicit deterministic fallback,
  rather than blocking the match indefinitely.

The **Cinder** panel is optional for play. It shows the current world reading,
pending event, safe candidate context, testing controls, optional Mock Player,
and the resolved-history player profile.

## Mock Player

`Mock LLM Move` is a development/demo tool. It asks the configured model for a
high-level Ashfarer plan, then lets the same deterministic legal-order bot turn
that plan into a visible queue. It never bypasses the rules and has no effect
on ordinary turns unless you press the button.

## Project layout

```text
ai/prompts/          Versioned Saltkin, Cinder, and Mock Player prompts
ai/schemas/          Strict model response schemas
ai_service.py        OpenAI-compatible client and trusted validation
server.py            Same-origin static files and local API endpoints
js/engine.js         Deterministic turns, supply, combat, and victory rules
js/mapgen.js         Symmetric North/South map, Relay pairs, Beacon, opening focus
js/events.js         Cinder world-event templates
js/validator.js      Fairness guardrails for world changes
js/profile.js        Resolved-history player profile
js/bot.js            Deterministic legal order generator
js/director.js       Safe candidates, rollouts, and event selection
js/main.js           UI, guide, turn flow, and fallbacks
tools/simulate.js    Offline balance and invariant checks
tests/               Service, security, UI, and rule tests
```

## Verify locally

These checks do not call an LLM or consume API credits:

```bash
node tools/simulate.js 10
python -m unittest discover -s tests -v
```

The simulator validates symmetric map generation, North/South route behaviour,
Relay cut-offs, supply, combat coordination, Beacon scoring, Cinder safeguards,
and deterministic replay. The test suite covers API boundaries, failure
handling, UI controls, and static assets.

## Privacy and third-party components

Only aggregate, resolved gameplay behaviour is kept in browser `localStorage`;
there are no accounts, personal identifiers, analytics, or hidden player-order
collection. See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) for the authority
boundary and [THIRD_PARTY.md](THIRD_PARTY.md) for model, gateway, and license
disclosure.
