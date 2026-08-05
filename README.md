# CINDERFALL

**A strategy game where the rival learns you—and the map is a player too.**

Two peoples fight over a procedurally generated ring of islands. The adaptive
Saltkin studies only resolved public play and chooses a three-turn Doctrine. The
neutral Cinder Director compares safe world interventions through deterministic
counterfactual simulations, warns the player, acts, then scores its prediction.

Built for the Garena AI Build Challenge 2026 and the build specification in this
repository.

## Run the full AI prototype

Requirements: Python 3.9+ and an API key for the configured OpenAI-compatible
gateway. Node.js is needed only for offline simulations.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` with a newly issued key:

```dotenv
CINDERFALL_API_KEY=your-new-key
CINDERFALL_AI_BASE_URL=https://api.aiand.com/v1
CINDERFALL_AI_MODEL=openai/gpt-oss-120b
CINDERFALL_AI_TIMEOUT_SECONDS=15
```

Then run:

```powershell
python server.py
```

Open <http://127.0.0.1:8000>. The API key remains in the Python process and is
never sent to the browser. If the key, SDK, network, provider, or model output
fails, the game remains playable and labels the decision `FALLBACK`.

Opening `index.html` directly still provides the deterministic offline game, but
browser security prevents the live AI endpoints from working under `file://`.

## What is here

| Component | Behaviour |
|---|---|
| Playable game | 25 actionable turns, one player versus Saltkin |
| Saltkin Strategic AI | Privacy-preserving player profile → three-turn Doctrine → legal deterministic orders |
| Cinder Director | Up to ten safe candidates, three counterfactual rollouts each, candidate-ID-only LLM selection |
| Shadow baseline | Original scored heuristic remains visible without controlling an LLM decision |
| Guardrails | Six hard rules plus a 40% player-choice preservation limit and live revalidation |
| Chronicle | Decision evidence, source, prediction, measured result, refusal and recovery history |
| Designer audit console | Doctrine, player profile, candidates, latency, request ID, model, override and failure controls |
| Offline simulator | Balance, privacy, legality, purity, fairness and regression checks without API cost |

## AI authority and workflow

Saltkin's model may choose only:

- stance: `ASSAULT`, `GROWTH`, or `FORTRESS`;
- objective, target region, and risk level;
- observable player-profile and evidence fields;
- a short player-facing intent.

It cannot see the player's current unsubmitted order queue, choose a tile, exceed
the budget, make an illegal order, or force the deterministic Bot to launch a
raid that cannot succeed.

Every three turns, Cinder:

1. Enumerates template × intensity × region combinations.
2. Rejects candidates that fail Guardrails or remove over 40% of either side's
   available Expand/Raid choices.
3. Deduplicates resulting maps and retains at most ten diverse candidates.
4. Runs three deterministic three-turn rollouts per candidate.
5. Sends aggregate outcomes to the LLM.
6. Accepts only an offered candidate ID with schema-valid evidence and prediction.
7. Revalidates against the live board before execution, tries the next safe
   candidate if necessary, and finally uses a deterministic safe default.

See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) for the data and authority boundaries.

## API

The local Python service exposes:

- `GET /api/ai/health`
- `POST /api/ai/saltkin`
- `POST /api/ai/director`

It uses the official Python SDK interface:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.aiand.com/v1",
    api_key=os.environ["CINDERFALL_API_KEY"],
)
response = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=messages,
)
```

Prompts and JSON Schemas are version-controlled under `ai/`. Strict trusted-code
validation rejects additional fields, invalid enums, unknown evidence,
out-of-range confidence, malformed JSON, and Director candidate IDs that were not
offered. Raw model output and private chain-of-thought are not displayed.

## Deterministic game rules

You earn the fertility of every supplied square you hold and spend it on:

| Order | Cost | Effect |
|---|---:|---|
| Expand | 2 | Claim adjacent empty land at strength 1 |
| Fortify | 1 | Add 2 strength to a held square |
| Raid | 3 | Attack an adjacent enemy square |

Attack is attacker strength + 3. Defence is target strength + height. Supply must
trace through owned land to the capital; cut-off squares earn nothing and starve.
Win with 10 Beacon Points or the most land after 25 completed turns.

## Guardrails

Cinder proposes. Plain code decides. No event may:

1. Take more than 25% of either side's land at once.
2. Push a side below three squares.
3. Target the same side for three consecutive seasons.
4. Repeat the previous template.
5. Destroy a capital.
6. Cut the ring so the peoples can never reach one another.

Designer overrides pass the same checks. Paused events remain due. Earthquake
selection, damage, warning, message, and animation all use the same region.

## Privacy

The player profile contains aggregate game behaviours only: Beacon proximity,
high-ground Fortify share, preferred arc, supply neglect, warning response, and
the previous match's dominant tactic. A versioned `localStorage` record keeps at
most five summaries and can be cleared in the audit console. There are no
accounts, identity fields, analytics, or external datasets.

See [THIRD_PARTY.md](THIRD_PARTY.md) for dependencies, gateway/model disclosure,
licenses, and transmitted data.

## Project layout

```text
ai/prompts/          Saltkin and Director system prompts
ai/schemas/          strict decision schemas
ai_service.py        SDK client, parsing and trusted validation
server.py            static allowlist and same-origin API
js/engine.js         pure turn rules
js/events.js         ten fixed world-event templates
js/validator.js      hard event guardrails
js/profile.js        resolved-history player profile and five-match memory
js/bot.js            legal order generator with optional Doctrine weights
js/director.js       heuristic baseline, candidates, rollouts and LLM mapping
js/ai.js             server-synchronized API timeout and three-second failure simulation
js/main.js           lifecycle, late-response checks, audit UI and fallback
tools/simulate.js    offline balance and invariant suite
tools/online_eval.py explicit-cost, opt-in remote evaluation
tests/               Python service and security-boundary tests
```

## Verification

Offline tests make no model calls and incur no API cost:

```powershell
node tools/simulate.js 400
python -m unittest discover -s tests -v
```

The invariant suite covers deterministic replay, pure state transitions, all
event templates, 25 actionable turns, override safety, overdue events,
Earthquake regions, Saltkin request privacy, Doctrine lifecycle and all 180 enum
combinations, candidate safety, rollout purity, the 40% agency cap, and side-bias
sampling.

Remote evaluation is deliberately opt-in:

```powershell
python tools/online_eval.py --runs-per-scenario 4 --confirm-cost
```

That runs five fixed scenarios for each AI, producing 20 validated decisions per
role. It refuses to start without both `CINDERFALL_API_KEY` and `--confirm-cost`.

## Controls and demo path

`1`, `2`, `3` select a tool; click the map to queue; `Enter` ends the turn;
right-click or click a queued order to remove it; `Esc` clears the queue.

For a five-minute demo, open the CINDER tab and show:

1. Saltkin Doctrine and resolved-history player evidence.
2. A Director candidate set and its shadow baseline.
3. A prediction later marked held or wrong.
4. A rejected unsafe override or live recovery.
5. `simulate AI failure`, which waits three seconds and visibly uses `FALLBACK`.

The prototype intentionally omits accounts, human multiplayer and production
deployment infrastructure.
