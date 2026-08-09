# CINDERFALL Lite — 3-Minute Judging Guide

This page is the fastest path through the current submission.

## 0:00–0:30 — Understand the game

Open <http://127.0.0.1:8000> and let the four tutorial scenes play.

The whole ruleset is:

- each side secretly queues two commands;
- Expand claims neutral land;
- Raid directly captures enemy land;
- Guard cancels one Raid for this turn;
- two Raids overcome one Guard;
- owning the Beacon scores one point; first to four wins;
- two effective Raids capture a capital;
- the match ends by turn ten.

There are no hidden combat numbers or resource economies.

## 0:30–1:15 — See the strategic decision

On the first playable turn, compare the north and south fronts.

Try one of these plans:

- two chained Expands for maximum speed;
- one Expand on each front to conceal commitment;
- later, one Guard plus one Raid for balanced play;
- two Raids on one target to defeat an expected Guard.

The strategic cost is always visible: every defensive command is one fewer
command available for expansion or attack.

## 1:15–2:00 — See Saltkin AI

Point out the public Saltkin intent above the order controls, for example:

```text
SALTKIN AI · RAID · NORTH · FOR 2 TURNS
```

This is a credible signal, not the complete enemy plan. At least one Saltkin
command follows it, while the exact target and second command remain secret.

Open the Cinder audit tab to show:

- the three trusted intent cards;
- the selected candidate ID;
- evidence from resolved public history;
- source, model, latency and fallback status.

The model selects strategy; deterministic code selects legal commands and
resolves outcomes.

## 2:00–2:35 — See Cinder AI

On even turns, Cinder evaluates three exact, fair Beacon destinations. The
selected destination is highlighted before the move occurs.

Emphasize that Cinder does not randomly damage the board. It changes where the
next conflict matters while preserving player planning and a clear response
window.

In the audit tab, show the three offered coordinates and selected source.

## 2:35–3:00 — Show trust and fallback

The two AI calls return only candidate IDs, evidence keys and short
explanations. Models cannot author commands, coordinates, rules or outcomes.

Enable simulated AI failure in the audit controls or run without a key. The UI
shows `FALLBACK`, and the deterministic planner keeps the match playable.

## What changed and why

The earlier prototype used supply paths, Relay cut-offs, tile strength,
resource tokens, permanent Fortify and five world-event families. On the ring
map those systems were hard to explain and often produced reversible front-line
loops.

The current version replaces them with direct capture and temporary Guard:

```text
old: attack → neutral tile → Expand back → repeated border
new: Raid → direct ownership flip; Guard must be recommitted each turn
```

AI was simplified at the same time:

- Saltkin exposes a short, actionable two-turn intent;
- Cinder only chooses the Beacon's next fair location;
- deterministic code remains the sole game authority.

The result is easier to learn, easier to judge and still strategically rich.

## Verification evidence

```powershell
node tools/rules_v02_smoke.js
python -m unittest discover -s tests -v
```

Expected result: rule smoke passes and all Python tests pass without making a
paid model call.
