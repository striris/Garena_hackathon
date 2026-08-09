# CINDERFALL Lite — AI Architecture

This document describes the current v0.2 implementation. It is written around
one question important to evaluation: **what may the models decide, and what
remains under deterministic game authority?**

## 1. Authority boundary

Both models are bounded selectors. Neither model writes game state.

```text
                         ┌─────────────────────────────────┐
resolved public history ─┤ 3 trusted Saltkin intent cards ├─> Saltkin LLM
                         └─────────────────────────────────┘       │ ID only
                                                                  v
                                                     deterministic command bot

                         ┌─────────────────────────────────┐
settled board state ─────┤ 3 exact fair Beacon positions  ├─> Cinder LLM
                         └─────────────────────────────────┘       │ ID only
                                                                  v
                                                       exact announced move

player envelope + Saltkin envelope ──> deterministic engine ──> next state
```

Only `js/engine.js` can:

- accept or reject Expand, Raid and Guard;
- resolve simultaneous command envelopes;
- apply Guard cancellation and direct ownership flips;
- award Beacon points;
- detect capital loss and match victory;
- apply the 10-turn tie-break.

## 2. Saltkin role

### Trusted input

`js/profile.js` derives aggregate features from commands already accepted and
resolved by the engine. It produces exactly three cards containing:

```json
{
  "id": "S1",
  "intent": "RAID",
  "region": "NORTH"
}
```

The current player's unsubmitted command array remains inside `js/main.js` and
is forbidden by the Python request validator.

Allowed intent values:

- `EXPAND`
- `RAID`
- `DEFEND`
- `BEACON`

Allowed region values:

- `NORTH`
- `SOUTH`
- `BEACON`
- `CAPITAL`

### Model output

The model returns only:

```json
{
  "selected_candidate": "S1",
  "evidence_used": ["north_order_share"],
  "explanation": "The player has repeatedly committed to the north arc."
}
```

`ai_service.py` validates the exact card shape, enums, IDs and evidence keys.
`js/profile.js` then resolves the returned ID against the same offered list.
`js/bot.js` converts the trusted intent into at most two legal tile commands.

The intent normally lasts two resolved uses. At least one generated command is
scored toward that public intent. The second command remains uncertain, giving
the player useful information without revealing the whole enemy envelope.

## 3. Cinder role

Cinder has one capability: select the Beacon's next exact position.

`js/director.js` generates three candidate land tiles. Candidates:

- exclude capitals and the current Beacon;
- keep both capitals' approach distances within one action;
- prefer the opposite north/south arc;
- are spatially separated when the map offers enough choices.

All candidates use the single trusted event family `beacon_moves` and include
their exact `affected` tile before the model call.

The model selects one offered `C1`–`C3` ID and cites public report evidence.
The browser maps the ID back to the trusted event, displays the destination,
and `js/validator.js` checks it again against the live board before
`js/events.js` moves the Beacon.

Cinder cannot:

- create, sink or alter land;
- change tile ownership;
- weaken Guard or Raid;
- move a capital;
- change the score or victory threshold;
- substitute an unannounced destination.

## 4. Timing

Saltkin intent is refreshed every two resolved uses or when no valid card is
available. Cinder selection is requested on even turns; the resulting exact
destination remains visible through the following command phase. The current
Beacon scores before the announced move is applied, and the destination begins
scoring on the next turn.

This timing gives the player a full strategic response window.

## 5. Server and schema boundary

`server.py` owns three same-origin endpoints:

- `GET /api/ai/health`
- `POST /api/ai/saltkin`
- `POST /api/ai/director`

`ai_service.py` creates the OpenAI Python SDK client from server-side
environment variables. The browser never receives the API key. Prompts live in
`ai/prompts/`, and model responses must match the JSON Schemas in
`ai/schemas/`.

Trusted Python validation additionally rejects:

- unknown or duplicate candidate IDs;
- unsupported card values or event families;
- extra candidate fields;
- evidence keys absent from the request;
- any Saltkin request containing a current or queued order array;
- malformed, empty or oversized model output.

## 6. Failure behaviour

The following all become explicit fallback states:

- missing credentials;
- request timeout;
- provider or gateway error;
- malformed JSON;
- invalid schema;
- unknown candidate ID;
- stale response for an old match or turn.

Fallback does not weaken the rules. The deterministic Saltkin planner selects a
local intent, and the deterministic Cinder baseline selects the first validated
Beacon destination. The match remains playable and reproducible.

## 7. Privacy

Saltkin receives only resolved public state and aggregate play tendencies. It
does not receive identity information, accounts, chat text or the current
secret order queue.

Local player memory is versioned, stores at most five aggregate match
summaries, and can be cleared from the audit console. API keys remain in an
ignored `.env` or process environment.

## 8. Judge-visible evidence

The normal game view exposes:

- Saltkin's current intent and region;
- Cinder's exact next Beacon tile;
- the result of both simultaneous command envelopes;
- an explicit `LLM` or `FALLBACK` source.

The audit console additionally shows model, latency, request ID, selected card,
named evidence and all offered Cinder destinations. No private chain-of-thought
is requested or displayed.

## 9. Verification

```powershell
node tools/rules_v02_smoke.js
python -m unittest discover -s tests -v
```

These checks cover the deterministic rule boundary, strict AI candidate
validation, secret-order exclusion, API-key isolation, fallback behaviour,
static integration and the animated tutorial structure.
