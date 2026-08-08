# CINDERFALL

**A living-map strategy game about reading the battlefield, committing to a
front, and turning a changing world into your next opportunity.**

You lead the **Ashfarers** against the rival **Saltkin** on a ring of islands
around the Cinderfall caldera. Every match begins with the same fair geography,
but its terrain, shared opening focus, and later opportunities are shaped by the
state of play. The goal is simple: expand your foothold, keep your territory
supplied, break the opposing line, and control the Beacon.

> 中文概览：你将带领 Ashfarers 与 Saltkin 在环形火山群岛上对抗。游戏的重点
> 是读懂地图、选择主攻方向、保持补给并争夺 Beacon。山脉会根据已经发生的战局
> 改变资源与通路，但不会替任何一方直接赢下比赛。

## Start the game

The game runs locally. Live adaptive decisions use an OpenAI-compatible API;
without a key, the game remains playable with its built-in deterministic logic.

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

To enable live AI decisions, place a newly issued key in `.env`. The provided
example uses SiliconFlow and `moonshotai/Kimi-K2.7-Code`; both may be replaced
with any compatible endpoint and model. The key stays on the local Python
server and is never sent to the browser.

```dotenv
CINDERFALL_API_KEY=your-new-key
CINDERFALL_AI_BASE_URL=https://api.siliconflow.cn/v1
CINDERFALL_AI_MODEL=moonshotai/Kimi-K2.7-Code
```

## Your first match

The game is designed to be readable from the board itself. The first line of
the message panel stays fixed as your current task; the battle record below it
can be scrolled independently.

1. **Follow the glow.** A highlighted dashed outline marks a square that the
   selected action can currently affect. Start by claiming a nearby square on
   the route you want to develop.
2. **Commit with intent.** Your early territorial actions establish a main
   front. Building a strong line first is usually clearer than scattering
   isolated pieces across the map.
3. **Keep the line connected.** Territory linked to your capital is supplied.
   Cut-off territory cannot support your plan, so look for the opponent’s weak
   connection as carefully as you protect your own.
4. **Turn momentum into an objective.** Push toward the Beacon, a Relay, or a
   bridge that lets you attack the rear of the other route.
5. **React to the world.** When Cinder warns of a new opportunity, both sides
   receive the same chance to use it. Decide whether it is worth changing your
   plan.

### Operations

| Operation | What it is for |
|---|---|
| `1 · Expand` | Claim an adjacent empty square and extend your line. |
| `2 · Fortify` | Reinforce a supplied friendly square that is likely to be attacked. |
| `3 · Raid` | Attack an adjacent enemy square; coordinated pressure from more than one direction is stronger. |
| `4 · Combo` | Enable a special follow-through when the displayed requirements are met. |

Use keyboard `1–4` to select an operation, click the map to queue it, press
`Enter` to resolve the turn, and press `Esc` to clear the current queue.

## Read the map

| Map feature | Meaning |
|---|---|
| **North / South routes** | The two main fronts. Choosing one gives your early plan a clear direction. |
| **Cross-caldera bridges** | Permanent flank paths. A breakthrough can turn through a bridge and threaten the rear of the other front. |
| **◇ Relay** | A paired supply junction. Controlling the full junction can isolate territory beyond it. |
| **★ Beacon** | The central scoring objective. It matters only while your line can supply it. |
| **Temporary crossing** | A short-lived world opportunity that both sides may contest. |
| **Glow / dashed outline** | A legal target for the currently selected operation. |

The map is rotationally symmetric: neither faction receives a closer route,
richer opening, or privileged world event. Terrain may vary between seeds, but
the same map logic applies to both sides.

## A world that responds without taking control away

Cinderfall’s world reacts to **settled** play, not to hidden player input. It
may expose a contested resource, open a new approach, or change the value of a
region when the match needs a fresh decision. These interventions are not
random rewards and do not directly grant ownership, damage a chosen player, or
decide the winner.

Before a world change appears, the system compares possible outcomes and keeps
only those that preserve a fair, reachable game. The player sees a warning and
then chooses how to respond. In practice, the world’s role is to create a new
question—*hold this front, exploit the opening, or counterattack elsewhere?*

## The adaptive opponent

Saltkin adapts to your established style rather than reading your current
intention. It may learn that you favor a route, chase the Beacon, overextend
Supply, or build defensive high ground. That observation changes its strategic
priority; trusted game rules still generate every order, check every target,
and enforce the same limits that apply to you.

The **CINDER** panel is optional for normal play. It shows the technical audit
trail: what evidence was considered, whether a live model or fallback was used,
and why a candidate world change passed its safety checks. The ordinary game
presentation remains entirely in-world.

## Test an AI-controlled player

The CINDER panel also contains **Mock LLM Move**. It asks the configured model
to propose a high-level Ashfarer strategy, then uses the same legal order
generator as the player. This makes it easy to observe different play styles
and inspect balance without letting the model bypass the game rules.

## Project guide

```text
ai/prompts/          LLM prompts for Saltkin, Cinder, and Mock Player
ai/schemas/          strict response schemas
ai_service.py        server-side API client and response validation
server.py            local game server and API boundary
js/engine.js         deterministic rules for turns, Supply, combat, and victory
js/mapgen.js         map generation, routes, bridges, Relays, and Beacon
js/events.js         world-change templates
js/validator.js      safety and fairness guardrails
js/profile.js        resolved-history player profile
js/bot.js            legal deterministic order generator
js/director.js       candidate comparison and world-change selection
js/main.js           game UI, guidance, lifecycle, and fallbacks
tools/simulate.js    offline simulation and invariant checks
tests/               service and interaction tests
```

For the implementation boundary and safeguards, see
[AI_ARCHITECTURE.md](AI_ARCHITECTURE.md). For API, model, licence, and data
disclosure, see [THIRD_PARTY.md](THIRD_PARTY.md).

## Verify locally

```bash
node tools/simulate.js 100
python -m unittest discover -s tests -v
```

These checks run without model calls. They cover repeatable map generation,
Supply links, legal actions, combat interactions, world-event safety, AI
fallbacks, and privacy boundaries.

## Privacy and scope

CINDERFALL is a playable demo, not a production multiplayer service. It has no
accounts, analytics, advertising, or persistent personal identity data. The
optional adaptation memory stores only aggregate gameplay tendencies in the
browser and can be cleared from the CINDER panel. No API key is stored in this
repository.
