# CINDERFALL Lite — Current Build and Evaluation Plan

This file tracks the current v0.2 submission. Historical supply/Relay/token
designs are intentionally superseded by [RULES_REDESIGN_SPEC.md](RULES_REDESIGN_SPEC.md).

## Current playable build

- Symmetric north/south ring with two cross-caldera bridges.
- Exactly two secret commands per side per turn.
- Three commands: Expand, Raid and one-turn Guard.
- Raid directly flips ownership; Guard cancels one Raid.
- Two effective Raids capture a capital.
- Beacon scores one point per turn; first to four wins.
- Cinder announces and moves the Beacon every two turns.
- Ten-turn hard limit with score, then territory tie-break.
- Four-scene animated square tutorial.

## Current AI integration

### Saltkin

- Trusted code creates exactly three `{id, intent, region}` cards.
- The model selects one candidate ID and cites public evidence.
- The displayed intent lasts two resolved uses.
- Deterministic code converts the card into legal commands.
- The current player order queue is forbidden from the request.

### Cinder

- Trusted code creates exactly three fair Beacon destinations.
- The model selects one candidate ID.
- The exact destination is previewed before execution.
- Cinder cannot modify terrain, ownership, combat or scores.

### Authority

- Only `js/engine.js` resolves commands and victory.
- Python validates request/card shapes and model output.
- Invalid, late or unavailable model responses use visible deterministic
  fallback.

## Completed migration

- [x] Removed supply flood fill from gameplay authority.
- [x] Removed Relay and fertile-site mechanics.
- [x] Removed tile strength and high-ground combat modifiers.
- [x] Replaced permanent Fortify with temporary Guard.
- [x] Removed token production and command boosts.
- [x] Replaced five world-event families with one readable Beacon move.
- [x] Updated Saltkin cards to intent/region.
- [x] Updated prompts, validation, tutorial and judge documentation.
- [x] Added deterministic v0.2 rule and browser smoke checks.

## Evaluation checklist

### Correctness

- [x] One Raid captures an unguarded normal tile.
- [x] One Guard cancels one Raid.
- [x] Two Raids overcome one Guard.
- [x] Raid flips ownership directly rather than creating neutral land.
- [x] Four Beacon points end the match.
- [x] Cinder candidates are exact Beacon destinations only.

### Judge comprehension

- [x] README explains the game in one minute.
- [x] `JUDGES_GUIDE.md` supplies a three-minute demo route.
- [x] `AI_ARCHITECTURE.md` distinguishes model choice from game authority.
- [x] Tutorial uses game-like squares instead of abstract diagrams.
- [x] Normal UI shows Saltkin intent and Cinder destination.

### Remaining playtest questions

- [ ] Is four Beacon points the right target, or does five improve comeback
  potential?
- [ ] Does moving the Beacon every two turns create enough north/south shifts?
- [ ] How often is Guard selected by human players and the deterministic bot?
- [ ] What percentage of matches end by Beacon, capital and turn limit?
- [ ] Does either starting side exceed a 55% win rate over a representative
  automated sample?

## Offline verification

```powershell
node tools/rules_v02_smoke.js
python -m unittest discover -s tests -v
```

The browser runtime check requires a local headless Edge debugging endpoint:

```powershell
node tools/browser_v02_smoke.js 9224 http://127.0.0.1:8000/
```

Remote model evaluation remains opt-in because it may incur provider cost.
