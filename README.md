# CINDERFALL Lite

**A short simultaneous-turn strategy game where the rival reads your habits and the world moves the objective.**

CINDERFALL Lite was built for the Garena AI Build Challenge 2026. The current
version deliberately uses a small ruleset so judges can see the strategic and
AI decisions instead of decoding combat arithmetic.

> Two secret commands. Two fronts. One moving Beacon.

## Judge quick links

- [3-minute judging guide](JUDGES_GUIDE.md)
- [Visual vision deck](vision.html)
- [Current game rules](RULES_REDESIGN_SPEC.md)
- [AI authority and data flow](AI_ARCHITECTURE.md)
- [Third-party and data disclosure](THIRD_PARTY.md)

## Run the game

Requirements: Python 3.9+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python server.py
```

Open <http://127.0.0.1:8000>.

The game remains playable without an API key: both AI roles visibly switch to
`FALLBACK`, and deterministic code completes the match. For live model choices,
put a newly issued key in the ignored `.env` file. The key stays in the Python
process and is never sent to the browser.

## The game in one minute

Ashfarers (player, west) and Saltkin (AI, east) advance around a north/south
ring connected by two cross-caldera bridges.

Each side secretly selects exactly **two commands** per turn:

| Command | Result |
|---|---|
| `Expand` | Claim adjacent neutral land |
| `Raid` | Directly capture adjacent enemy land |
| `Guard` | Cancel one Raid against a chosen tile this turn |

The central calculation is intentionally visible:

```text
1 Raid − 1 Guard = defended
2 Raids − 1 Guard = captured
```

There is no supply graph, tile strength, resource currency, permanent fortress,
or hidden combat modifier. A successful Raid flips ownership directly; it does
not create a neutral tile that can simply be Expanded back.

### Win conditions

- Own the Beacon at the scoring step: **+1 point**.
- First to **4 Beacon points** wins.
- The enemy capital requires **2 effective Raids in one turn** and wins the
  match immediately.
- A match lasts at most **10 turns**; then compare Beacon score, followed by
  territory.

### Resolution order

```text
Guard → simultaneous Raid → layered Expand → Beacon scores → Beacon moves
```

Two Expands may chain through the first newly claimed tile. If both sides
Expand into the same neutral tile, both commands cancel and it stays neutral.

## What makes it strategic

The two-command limit creates a readable opportunity cost every turn:

- split between north and south, or concentrate on one front;
- spend a command on temporary defence, or accept risk and advance;
- use two Raids to break one Guard, or exploit the opponent's investment
  somewhere else;
- follow the current Beacon, or prepare for Cinder's announced destination;
- trust Saltkin's public intent, or anticipate its undisclosed second command.

The ring no longer depends on rare supply cut-offs for drama. Temporary Guard,
direct capture, continuous Beacon scoring, scheduled Beacon movement and the
10-turn limit keep both fronts relevant without a special anti-stalemate rule.

## Two bounded AI roles

AI is part of the decisions players read, not an unrestricted rules engine.

### 1. Saltkin — adaptive rival intent

Every two resolved turns, trusted code offers exactly three strategy cards such
as:

```json
{ "id": "S1", "intent": "RAID", "region": "NORTH" }
```

Allowed intents are `EXPAND`, `RAID`, `DEFEND`, and `BEACON`; allowed regions
are `NORTH`, `SOUTH`, `BEACON`, and `CAPITAL`.

The model may select only an offered ID and cite named evidence from resolved
public history. A deterministic planner converts that intent into two legal
commands. At least one command follows the displayed intent. The model never
sees the player's current secret queue and never chooses a tile directly.

This creates fair imperfect information: the player can respond to a credible
AI plan without knowing Saltkin's exact targets or second command.

### 2. Cinder — moving-objective director

Cinder now has one clear power: **choose where the Beacon moves**.

Every two turns:

1. deterministic code generates three exact, fair destinations;
2. the model selects one offered candidate ID;
3. the destination is marked before players commit commands;
4. the current Beacon scores, then it moves to the announced tile;
5. the new position begins scoring next turn.

Cinder cannot destroy land, weaken a player, change ownership, edit combat or
invent an event. Its AI choice changes strategic attention while remaining
fully understandable and auditable.

## Why the AI is safe and judgeable

```text
resolved public state
        │
        ├── trusted Saltkin cards ──> LLM selects ID ──> legal bot commands
        │
        └── fair Beacon candidates ─> LLM selects ID ──> exact preview/move

both command envelopes ─────────────> deterministic engine ──> game state
```

- JSON Schemas restrict model output to candidate selection, evidence keys and
  a short explanation.
- Python validates request shape, candidate IDs and evidence fields.
- Browser code rehydrates the selected ID from the trusted candidate list.
- Unknown IDs, malformed JSON, missing credentials, timeout or provider failure
  become explicit `FALLBACK` states.
- Only `js/engine.js` resolves commands, scoring and victory.

See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) for the complete authority model.

## New player experience

The opening tutorial uses four short animations built from the same square
visual language as the board:

1. the ring, two fronts and Beacon scoring;
2. Expand, Raid and Guard;
3. two Raids overcoming one Guard;
4. Saltkin's public intent and Cinder's next Beacon.

It takes about 30 seconds and can be reopened with `HOW TO PLAY`.

## Controls

- `1`: Expand
- `2`: Guard
- `3`: Raid
- click a highlighted tile: queue the selected command
- right-click a preview or use `×`: remove a command
- `Esc`: clear the queue
- `Enter`: resolve when exactly two commands are sealed

## Repository structure

```text
index.html              game HUD, audit console and animated tutorial
css/style.css           board, responsive UI and tutorial-square animations
js/engine.js            authoritative Expand/Raid/Guard and victory rules
js/mapgen.js            symmetric north/south ring and cross-bridges
js/bot.js               deterministic Saltkin two-command executor
js/profile.js           resolved-history features and trusted intent cards
js/director.js          three fair Beacon candidates and model-ID mapping
js/events.js            exact Beacon-move application
js/validator.js         live Beacon destination validation
js/main.js              lifecycle, input locking, preview and fallback UI
ai_service.py           server-side SDK calls and strict request validation
ai/prompts/             role instructions
ai/schemas/             strict model-output schemas
tests/                  API boundary and static integration tests
tools/rules_v02_smoke.js deterministic rule behaviour checks
tools/browser_v02_smoke.js runtime and compact-screen browser checks
```

## Verification

Offline verification makes no model calls and incurs no API cost:

```powershell
node tools/rules_v02_smoke.js
python -m unittest discover -s tests -v
```

The rule smoke test covers Guard cancellation, two-Raid breakthrough, direct
ownership flips, 4-point victory, 10-turn configuration and Beacon movement.
The Python suite covers the API trust boundary, candidate validation, key
isolation, static integration and tutorial structure.

With a headless Edge debugging session available, the compact-screen runtime
check is:

```powershell
node tools/browser_v02_smoke.js 9224 http://127.0.0.1:8000/
```

## API endpoints

- `GET /api/ai/health`
- `POST /api/ai/saltkin`
- `POST /api/ai/director`

The service uses the OpenAI Python SDK through the configured compatible
endpoint. No account, identity, chat text or current secret command queue is
sent to either AI role.
