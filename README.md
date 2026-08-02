# CINDERFALL

**A strategy game where the map is a player too.**

Two peoples fight over a ring of islands. Underneath them, the mountain that made
those islands is still working — and what it cannot stand is a quiet map. When the
border settles, the mountain sinks the safe ground, cracks open the pass, or moves
the fire that both sides are fighting over.

Built to the `Cinderfall_Build_Spec.docx` in this repo.

---

## Running it

No build step, no server, no dependencies.

```
open index.html
```

Double-click the file. It runs from `file://` in any modern browser.

---

## What is here

| | |
|---|---|
| **Playable** | 25 turns, ~5 minutes, one player against a rule-based rival |
| **The ring** | 14 × 10 grid, procedurally generated, provably fair (see below) |
| **The Director** | Reads the match every 3 turns, picks one of 10 event templates, warns you, explains itself, and predicts what will happen |
| **Guardrails** | 6 hard rules in plain code that every proposal must pass |
| **Chronicle** | Every season's reasoning, and whether its prediction turned out right |
| **Designer console** | Read the reasoning, override the event, pause the mountain, force a stalemate |
| **Headless simulator** | `node tools/simulate.js 400` — balance runs with no interface |

### The Director runs as a heuristic, not a language model

The spec calls for an LLM behind the Director. **This build does not use one.** It
runs the same five-output interface — event, warning, message, reasoning,
prediction — as a scored heuristic in [`js/director.js`](js/director.js), with no
network call and no API key.

Everything around that slot is real and is the part that would survive the swap:
the plain-language report, the fixed template library, the memory of what has been
tried and whether it worked, the prediction-and-scoring loop, the validator, and
the human override. To put a model in, replace `decide()` — feed `brief(state, r)`
as the prompt, parse `{template, intensity, region, prediction}` back, and hand it
to `CF.validator.gate()` exactly as the heuristic does now.

---

## How a turn works

You earn the **fertility** of every square you hold and can still reach. Spend it:

| Order | Cost | Effect |
|---|---|---|
| **Expand** | 2 | Claim empty land next to yours, at strength 1 |
| **Fortify** | 1 | Add 2 strength to a square you hold |
| **Raid** | 3 | Attack an enemy square next to yours |

**Combat is one comparison.** Attack = attacker's strength + 3. Defence = target's
strength + its height. Higher attack takes the square at strength 1 and the
attacker loses 2; otherwise the attack fails and the defender loses 1. No dice.

**Supply.** A square only counts if you can trace your own land back to your
capital. Cut-off squares earn nothing and starve. This is why splitting a
territory hurts more than shrinking it.

**Winning.** 10 Beacon Points (one per turn ending on the Beacon), or the most
land after 25 turns.

---

## The architecture

The rule the whole thing hangs on: **the engine is pure functions.**

```js
CF.engine.resolveTurn(state, ordersA, ordersB) -> { state, fx }
CF.events.apply(state, event)                  -> { state, fx }
```

Same input, same output, no hidden state, no side effects. That buys three things
almost free: a thousand headless matches to check balance, exact replay from a
seed, and a validator that can *simulate* an event and inspect the wreckage before
allowing it to touch the screen.

```
js/
  util.js        seeded RNG, helpers          (no deps)
  mapgen.js      the ring generator
  engine.js      rules only — no AI in it at all
  events.js      the 10 templates
  validator.js   the guardrails, plain code
  bot.js         the Saltkin — 3 moods, no model
  director.js    Cinder: read, score, remember, predict
  render.js      canvas war table
  intro.js       the cold open
  main.js        turn flow and UI wiring
tools/
  simulate.js    headless balance runs + invariant tests
```

---

## Cinder

Every 3 turns the Director wakes, writes itself a plain report, and acts:

> Season 2, turn 6. The Ashfarers hold 14 squares, the Saltkin 17. Nobody has
> attacked for 6 turns. Both sides are stacking defence on high ground. The Beacon
> is held by the Saltkin and has not changed hands in 9 turns. Last season we
> caused an eruption and the fighting moved the way we said.

Ten templates, each with an intensity 1–3 and a target region: **eruption, the tide
answers, earthquake, new island, ashfall, bloom, the fire moves, the rock cools,
settlers, storm season.**

It cannot invent anything. It picks from the library, and it always:

- **warns one turn early** — never surprise a player with a disaster they had no
  chance to prepare for;
- **names the cause** — "nobody has fought in six turns; the mountain has grown
  impatient";
- **logs its reasoning**, including the runners-up and their scores;
- **predicts** what should happen, and gets marked right or wrong next season.

That last one matters. Predictions feed back into per-template memory, so a
template that keeps being wrong gets picked less. A rule engine never finds out it
was wrong. Across 400 simulated matches roughly **38%** of predictions hold, which
is exactly the kind of honest number the chronicle is there to show.

### Guardrails

Cinder proposes. Plain code decides. Nothing reaches the map without passing all of:

1. No event may take more than 25% of a side's land at once
2. No side may be pushed below 3 squares
3. The same side cannot be the main target three seasons running
4. The same template cannot run twice in a row
5. A capital can never be destroyed
6. **No event may cut the ring in two**

Rule 6 is not in the spec. It was added because playtesting found the failure: on a
ring the two peoples meet at two narrow arcs, and one eruption across the wrong
square walls them apart for the rest of the match. A mountain that wants a fight
must never make fighting impossible.

If a proposal fails, it is asked again once — a gentler version of the same idea if
the objection was about damage, otherwise the runner-up. If that fails too, a safe
default fires. The game never stalls. Across 400 matches the safe default is needed
about **12 times in 2,270 seasons**.

---

## Fairness

The ring is generated with **180° rotational symmetry** about the caldera: tile
`(x, y)` is the exact twin of `(W-1-x, H-1-y)`, and only the western half chooses —
the east is handed the twins. Both capitals are equidistant from the Beacon by
walked land distance, in every generated map. `tools/simulate.js` asserts a
perfectly mirrored start.

Two bugs found this way, both worth recording:

- **Contested expansion deadlocked the map.** The original rule was "both peoples
  reach for the same square, neither gets it." On a ring the chokepoints are one
  square wide, so both bots reached for the same square every turn forever and the
  two sides never touched at all. Now the side that brought more strength to its
  edge takes it.
- **Simultaneous resolution was not simultaneous.** Raids were applied in ascending
  target index, so the side whose territory sat at low indices always had its
  losses applied first and could invalidate the other side's attacks. It handed the
  Saltkin **three matches in four**. Now every raid is judged against one frozen
  snapshot and applied only afterwards.

After both fixes, bot against bot over 400 matches:

```
Ashfarers won  210   52.5%
Saltkin won    178   44.5%
Drawn           12    3.0%
```

The residual edge is the intended flavour difference: the Ashfarers farm the ash
fields, the Saltkin took the high ground, and they weight squares accordingly.

---

## The simulator

```
node tools/simulate.js            200 matches
node tools/simulate.js 1000       more
node tools/simulate.js 50 verbose per-match lines
```

Prints win rates, match length, raids and silent turns, template usage, prediction
accuracy, how often guardrails bit — then runs invariant tests:

```
PASS  same seed builds the same ring
PASS  same seed replays exactly
PASS  resolveTurn does not mutate its input
PASS  applyEvent does not mutate its input
PASS  no match ends with both sides wiped out
PASS  all ten templates apply to a fresh board
PASS  validator has teeth
```

---

## Controls

`1` `2` `3` pick a tool, then click the map. Click a queued order to remove it, or
right-click the square. `⏎` ends the turn. `Esc` clears the queue.

The intro is skippable with the button or `Esc`; arrow keys page through it.

**To show the stalemate-breaker:** open the **CINDER** tab, tick *force stalemate*,
and end turns without giving orders. Both sides sit still, and you can watch the
mountain decide to do something about it — the reasoning appears in the console
before the event fires.

---

## Deliberately not built

No human multiplayer. No art, no sound, no animation rigs — coloured squares on a
war table. No accounts, no server. No language model driving the rival: it stays a
simple three-mood bot on purpose, so the demo is fast, cheap and repeatable, and so
a dead-quiet stalemate can be forced on command.
